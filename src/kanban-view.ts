import { ItemView, Notice, TFile, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";
import type ArbiterPlugin from "./main";
import type { ActionType, BlockerType, ConfidenceLevel } from "./types";
import { parseTask } from "./task-parser";

/**
 * Arbiter Kanban View
 *
 * A visual dashboard for Matt's week of personal testing (pre-community-registry
 * publish). Scans the task discovery folders configured in plugin settings,
 * parses each task note's frontmatter, groups by `arbiter_action`, and renders
 * a column-per-action-type board. Click any card to open its task note.
 *
 * This is primarily for human oversight — the AI agents operate on the
 * frontmatter directly via the `assess-*` commands. The Kanban view is the
 * visual counterpart so Matt can see the state of his task board at a glance.
 *
 * Scope note: originally marked out-of-scope in PRD v0.4 §8.2. Pulled back in
 * on 2026-04-11 after Matt requested a visual for the self-testing week.
 */

export const ARBITER_KANBAN_VIEW_TYPE = "arbiter-kanban";

/** Column order left-to-right on the board. UNASSESSED catches everything without an arbiter_action. */
const COLUMN_ORDER: readonly (ActionType | "UNASSESSED")[] = [
	"UNASSESSED",
	"EXE",
	"ASK",
	"CTX",
	"DEC",
	"WAIT",
	"ESC",
	"DECL",
] as const;

const COLUMN_LABELS: Record<string, string> = {
	UNASSESSED: "Unassessed",
	EXE: "Execute",
	ASK: "Ask",
	CTX: "Context",
	DEC: "Decompose",
	WAIT: "Wait",
	ESC: "Escalate",
	DECL: "Decline",
};

const COLUMN_ICONS: Record<string, string> = {
	UNASSESSED: "◌",
	EXE: "▶",
	ASK: "?",
	CTX: "◇",
	DEC: "✂",
	WAIT: "⏳",
	ESC: "!",
	DECL: "⊘",
};

const COLUMN_DESCRIPTIONS: Record<string, string> = {
	UNASSESSED: "Task notes without any arbiter_action yet",
	EXE: "Ready to execute — all readiness dimensions satisfied",
	ASK: "Waiting on a human decision or clarification",
	CTX: "Missing context the agent can self-serve",
	DEC: "Too broad — needs decomposition into subtasks",
	WAIT: "Blocked by dependency or time constraint",
	ESC: "Exceeds agent authority — routed to human",
	DECL: "Out of scope, infeasible, or terminal",
};

interface KanbanTask {
	title: string;
	path: string;
	action: ActionType | "UNASSESSED";
	confidence?: ConfidenceLevel;
	blockerType?: BlockerType;
	needsHuman?: boolean;
	lastAssessed?: string;
	decDepth?: number;
	urgencyDate?: string;
	capabilityPrimary?: string;
	type?: string;
}

export class ArbiterKanbanView extends ItemView {
	plugin: ArbiterPlugin;
	private tasks: KanbanTask[] = [];
	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ArbiterPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return ARBITER_KANBAN_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Arbiter Kanban";
	}

	getIcon(): string {
		return "layout-grid";
	}

	async onOpen(): Promise<void> {
		await this.refresh();

		// Debounced auto-refresh when any markdown file changes in the vault.
		// The heavy lifting is in collectTasks() which walks the task discovery
		// folders and parses each file's frontmatter; keep the debounce long
		// enough to avoid thrashing during multi-save batches.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				this.scheduleRefresh();
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				this.scheduleRefresh();
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				this.scheduleRefresh();
			})
		);
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 750);
	}

	async refresh(): Promise<void> {
		this.tasks = await this.collectTasks();
		this.render();
	}

	private async collectTasks(): Promise<KanbanTask[]> {
		const out: KanbanTask[] = [];
		for (const folderPath of this.plugin.settings.taskDiscoveryFolders) {
			const folder = this.app.vault.getAbstractFileByPath(normalizePath(folderPath));
			if (folder instanceof TFolder) {
				await this.walkFolder(folder, out);
			}
		}
		// Stable sort: column order first, then by last_assessed desc (newest first),
		// then by title.
		out.sort((a, b) => {
			const aIdx = COLUMN_ORDER.indexOf(a.action);
			const bIdx = COLUMN_ORDER.indexOf(b.action);
			if (aIdx !== bIdx) return aIdx - bIdx;
			if (a.lastAssessed && b.lastAssessed) {
				return b.lastAssessed.localeCompare(a.lastAssessed);
			}
			return a.title.localeCompare(b.title);
		});
		return out;
	}

	private async walkFolder(folder: TFolder, out: KanbanTask[]): Promise<void> {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				await this.walkFolder(child, out);
			} else if (child instanceof TFile && child.extension === "md") {
				try {
					const content = await this.app.vault.read(child);
					const task = parseTask(content, child.path);
					out.push({
						title: task.title || child.basename,
						path: child.path,
						action: task.arbiterAction ?? "UNASSESSED",
						confidence: task.arbiterConfidence,
						blockerType: task.arbiterBlockerType,
						needsHuman: task.arbiterNeedsHuman,
						lastAssessed: task.arbiterLastAssessed,
						decDepth: task.arbiterDecDepth,
						urgencyDate: task.urgencyDate,
						capabilityPrimary: task.capabilityPrimary,
						type: task.type,
					});
				} catch (err) {
					// Skip unreadable files silently; log once to console.
					console.warn(`[arbiter-kanban] failed to parse ${child.path}:`, err);
				}
			}
		}
	}

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("arbiter-kanban-root");

		// Header
		const header = container.createDiv({ cls: "arbiter-kanban-header" });
		const headerLeft = header.createDiv({ cls: "arbiter-kanban-header-left" });
		headerLeft.createEl("h2", { text: "Arbiter Kanban", cls: "arbiter-kanban-title" });
		const subtitle = headerLeft.createDiv({ cls: "arbiter-kanban-subtitle" });
		const folders = this.plugin.settings.taskDiscoveryFolders.join(", ");
		subtitle.setText(
			`${this.tasks.length} task${this.tasks.length === 1 ? "" : "s"} across: ${folders}`
		);

		const headerRight = header.createDiv({ cls: "arbiter-kanban-header-right" });
		const refreshBtn = headerRight.createEl("button", {
			text: "↻ Refresh",
			cls: "arbiter-kanban-btn",
		});
		refreshBtn.addEventListener("click", () => this.refresh());

		const assessAllBtn = headerRight.createEl("button", {
			text: "▶ Assess all",
			cls: "arbiter-kanban-btn arbiter-kanban-btn-primary",
			attr: { title: "Run assessment on every task in the discovery folders" },
		});
		assessAllBtn.addEventListener("click", () => this.assessAll());

		// Group tasks by column
		const grouped: Record<string, KanbanTask[]> = {};
		for (const col of COLUMN_ORDER) grouped[col] = [];
		for (const task of this.tasks) {
			const key = COLUMN_ORDER.includes(task.action) ? task.action : "UNASSESSED";
			grouped[key].push(task);
		}

		// Board
		const board = container.createDiv({ cls: "arbiter-kanban-board" });
		for (const col of COLUMN_ORDER) {
			this.renderColumn(board, col, grouped[col]);
		}

		// Footer with legend
		const footer = container.createDiv({ cls: "arbiter-kanban-footer" });
		footer.createEl("span", {
			text: "Click a card to open the task note. Auto-refreshes on file changes.",
			cls: "arbiter-kanban-legend",
		});
	}

	private renderColumn(
		parent: HTMLElement,
		col: ActionType | "UNASSESSED",
		tasks: KanbanTask[]
	): void {
		const colEl = parent.createDiv({
			cls: `arbiter-kanban-col arbiter-kanban-col-${col.toLowerCase()}`,
		});

		// Column header
		const headerEl = colEl.createDiv({ cls: "arbiter-kanban-col-header" });
		const labelEl = headerEl.createDiv({ cls: "arbiter-kanban-col-label" });
		labelEl.createEl("span", {
			text: COLUMN_ICONS[col] ?? "·",
			cls: "arbiter-kanban-col-icon",
		});
		labelEl.createEl("span", {
			text: COLUMN_LABELS[col] ?? col,
			cls: "arbiter-kanban-col-name",
		});
		labelEl.createEl("span", {
			text: String(tasks.length),
			cls: "arbiter-kanban-col-count",
		});
		headerEl.setAttribute("title", COLUMN_DESCRIPTIONS[col] ?? "");

		// Cards
		const cardsEl = colEl.createDiv({ cls: "arbiter-kanban-cards" });
		if (tasks.length === 0) {
			cardsEl.createDiv({
				text: "No tasks",
				cls: "arbiter-kanban-empty",
			});
		} else {
			for (const task of tasks) {
				this.renderCard(cardsEl, task);
			}
		}
	}

	private renderCard(parent: HTMLElement, task: KanbanTask): void {
		const card = parent.createDiv({ cls: "arbiter-kanban-card" });
		if (task.confidence) {
			card.addClass(`arbiter-kanban-card-conf-${task.confidence}`);
		}
		if (task.needsHuman) {
			card.addClass("arbiter-kanban-card-needs-human");
		}

		// Click-to-open
		card.addEventListener("click", async () => {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (file instanceof TFile) {
				await this.app.workspace.getLeaf(false).openFile(file);
			}
		});

		// Title row
		const titleEl = card.createDiv({ cls: "arbiter-kanban-card-title" });
		titleEl.setText(task.title);

		// Meta row
		const meta = card.createDiv({ cls: "arbiter-kanban-card-meta" });

		if (task.confidence) {
			const conf = meta.createEl("span", {
				cls: `arbiter-kanban-chip arbiter-kanban-chip-conf arbiter-kanban-chip-conf-${task.confidence}`,
			});
			conf.setText(task.confidence);
			conf.setAttribute("title", `Confidence: ${task.confidence}`);
		}

		if (task.blockerType && task.blockerType !== "none") {
			const blocker = meta.createEl("span", { cls: "arbiter-kanban-chip arbiter-kanban-chip-blocker" });
			blocker.setText(task.blockerType);
			blocker.setAttribute("title", `Blocker type: ${task.blockerType}`);
		}

		if (task.needsHuman) {
			const human = meta.createEl("span", { cls: "arbiter-kanban-chip arbiter-kanban-chip-human" });
			human.setText("👤 needs human");
		}

		if (task.decDepth !== undefined && task.decDepth > 0) {
			const depth = meta.createEl("span", { cls: "arbiter-kanban-chip arbiter-kanban-chip-depth" });
			depth.setText(`depth ${task.decDepth}`);
			depth.setAttribute("title", "DEC-012 decomposition depth");
		}

		if (task.urgencyDate) {
			const urgency = meta.createEl("span", { cls: "arbiter-kanban-chip arbiter-kanban-chip-urgency" });
			urgency.setText(`due ${task.urgencyDate}`);
		}

		if (task.capabilityPrimary) {
			const cap = meta.createEl("span", { cls: "arbiter-kanban-chip arbiter-kanban-chip-cap" });
			cap.setText(task.capabilityPrimary);
		}

		// Footer: last assessed + file path
		const footer = card.createDiv({ cls: "arbiter-kanban-card-footer" });
		if (task.lastAssessed) {
			const last = footer.createEl("span", { cls: "arbiter-kanban-card-last" });
			// Trim to date portion if ISO string
			const datePart = task.lastAssessed.length >= 10 ? task.lastAssessed.slice(0, 10) : task.lastAssessed;
			last.setText(`assessed ${datePart}`);
		}
		const pathEl = footer.createEl("span", { cls: "arbiter-kanban-card-path" });
		pathEl.setText(task.path);
	}

	/**
	 * Run Arbiter assessment on every task currently listed in the view.
	 * Used for a batch pass — e.g., after editing multiple task notes by hand.
	 */
	private async assessAll(): Promise<void> {
		let assessed = 0;
		let failed = 0;
		for (const task of this.tasks) {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) continue;
			try {
				await this.plugin.assessFile(file);
				assessed++;
			} catch {
				failed++;
			}
		}
		// Refresh the view to show new assessments
		await this.refresh();
		new Notice(
			`Arbiter: assessed ${assessed} task${assessed === 1 ? "" : "s"}${
				failed > 0 ? `, ${failed} failed` : ""
			}.`
		);
	}
}
