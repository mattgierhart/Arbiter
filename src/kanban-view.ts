import { ItemView, Notice, TFile, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";
import type ArbiterPlugin from "./main";
import type { ActionType, BlockerType, ConfidenceLevel, Priority, ReadinessColor } from "./types";
import { parseTask } from "./task-parser";
import { actionToColor, getDispatchQueue, type QueueTask } from "./dispatch-queue";

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

/**
 * v0.5.0 OQ-013: a file looks like a task when its frontmatter explicitly
 * declares title, type, and status. parseTask falls back to defaults for
 * missing fields, so we check the RAW frontmatter to distinguish "real
 * task" from "incidental .md file in a discovery folder" (READMEs, indexes,
 * Pinch's test fixtures, etc.).
 */
function isLikelyTask(task: import("./types").ParsedTask): boolean {
	const fm = task.rawFrontmatter;
	return (
		typeof fm.title === "string" &&
		typeof fm.type === "string" &&
		typeof fm.status === "string"
	);
}

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

interface KanbanTask extends QueueTask {
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
	// v0.5.0 fields exposed for the Up Next filter + color mapping
	mattApproved?: boolean;
	priority?: Priority;
	taskRevision?: string;
	arbiterAssessedRevision?: string;
	// QueueTask requires arbiterAction + arbiterLastAssessed; mirror them from action/lastAssessed
	arbiterAction?: ActionType;
	arbiterLastAssessed?: string;
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
					// v0.5.0 OQ-013: skip files that don't look like tasks.
					// A "task" here means: has explicit title + type + status frontmatter.
					// This filters out READMEs, indexes, and stub notes that happen to
					// live in a discovery folder. parseTask is lenient and fills in
					// defaults — we check the raw frontmatter to detect intent.
					if (!isLikelyTask(task)) continue;
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
						mattApproved: task.mattApproved,
						priority: task.priority,
						taskRevision: task.taskRevision,
						arbiterAssessedRevision: task.arbiterAssessedRevision,
						// Mirror for QueueTask compatibility
						arbiterAction: task.arbiterAction,
						arbiterLastAssessed: task.arbiterLastAssessed,
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

		// v0.5.0 — "Up Next" strip: dispatchable cards, sorted by priority then urgency.
		// A card is dispatchable when arbiter_action=EXE AND matt_approved=true AND
		// the SYNC-001 revision pin is fresh. See dispatch-queue.ts.
		this.renderUpNext(container);

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
			text: "Click a card to open the task note. Auto-refreshes on file changes. Cards show readiness color (green/yellow/red) on left border.",
			cls: "arbiter-kanban-legend",
		});
	}

	/**
	 * v0.5.0 — Render the "Up Next" strip at the top of the board.
	 *
	 * Shows cards that are READY to dispatch right now: arbiter_action=EXE,
	 * matt_approved=true, SYNC-001 fresh. Sorted by priority (urgent first)
	 * then by urgencyDate. Each card click opens the underlying file.
	 *
	 * Cap at 5 entries to keep the strip a focused dispatch queue, not a
	 * second board. Below 5: "no dispatchable tasks — toggle approval on a
	 * green card to add" hint so the empty state is actionable.
	 */
	private renderUpNext(container: HTMLElement): void {
		const queue = getDispatchQueue(this.tasks).slice(0, 5);

		const strip = container.createDiv({ cls: "arbiter-kanban-upnext" });
		const stripHeader = strip.createDiv({ cls: "arbiter-kanban-upnext-header" });
		stripHeader.createEl("span", {
			text: "▶▶",
			cls: "arbiter-kanban-upnext-icon",
		});
		stripHeader.createEl("span", {
			text: "Up Next",
			cls: "arbiter-kanban-upnext-title",
		});
		stripHeader.createEl("span", {
			text: `${queue.length} ready to dispatch`,
			cls: "arbiter-kanban-upnext-count",
		});

		const cardsRow = strip.createDiv({ cls: "arbiter-kanban-upnext-cards" });
		if (queue.length === 0) {
			cardsRow.createDiv({
				cls: "arbiter-kanban-upnext-empty",
				text:
					"No dispatchable tasks. A card needs arbiter_action: EXE + matt_approved: true + a fresh assessment. Use 'Arbiter: Toggle approved' on a green card.",
			});
			return;
		}
		for (const task of queue) {
			this.renderUpNextCard(cardsRow, task);
		}
	}

	private renderUpNextCard(parent: HTMLElement, task: KanbanTask): void {
		const card = parent.createDiv({ cls: "arbiter-kanban-upnext-card" });
		card.addClass(`arbiter-kanban-card-color-${actionToColor(task.action)}`);
		if (task.priority) {
			card.addClass(`arbiter-kanban-card-priority-${task.priority}`);
		}

		card.addEventListener("click", async () => {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (file instanceof TFile) {
				await this.app.workspace.getLeaf(false).openFile(file);
			}
		});

		const titleEl = card.createDiv({ cls: "arbiter-kanban-upnext-card-title" });
		if (task.priority && task.priority !== "normal") {
			const badge = titleEl.createEl("span", {
				cls: `arbiter-kanban-priority-badge arbiter-kanban-priority-${task.priority}`,
			});
			badge.setText(task.priority === "urgent" ? "🔥" : task.priority === "high" ? "⬆" : "⬇");
		}
		titleEl.appendText(task.title);

		const meta = card.createDiv({ cls: "arbiter-kanban-upnext-card-meta" });
		meta.createEl("span", {
			cls: "arbiter-kanban-chip arbiter-kanban-chip-approved",
			text: "✅ approved",
		});
		if (task.urgencyDate) {
			meta.createEl("span", {
				cls: "arbiter-kanban-chip arbiter-kanban-chip-urgency",
				text: `due ${task.urgencyDate}`,
			});
		}
		if (task.capabilityPrimary) {
			meta.createEl("span", {
				cls: "arbiter-kanban-chip arbiter-kanban-chip-cap",
				text: task.capabilityPrimary,
			});
		}
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
		// v0.5.0 — color border driven by 3-state model (action → red/yellow/green/grey)
		card.addClass(`arbiter-kanban-card-color-${actionToColor(task.action)}`);
		if (task.confidence) {
			card.addClass(`arbiter-kanban-card-conf-${task.confidence}`);
		}
		if (task.needsHuman) {
			card.addClass("arbiter-kanban-card-needs-human");
		}
		if (task.mattApproved) {
			card.addClass("arbiter-kanban-card-approved");
		}
		if (task.priority && task.priority !== "normal") {
			card.addClass(`arbiter-kanban-card-priority-${task.priority}`);
		}

		// Click-to-open
		card.addEventListener("click", async () => {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (file instanceof TFile) {
				await this.app.workspace.getLeaf(false).openFile(file);
			}
		});

		// Title row — priority badge inline with title for scanability
		const titleEl = card.createDiv({ cls: "arbiter-kanban-card-title" });
		if (task.priority && task.priority !== "normal") {
			const badge = titleEl.createEl("span", {
				cls: `arbiter-kanban-priority-badge arbiter-kanban-priority-${task.priority}`,
			});
			badge.setText(
				task.priority === "urgent" ? "🔥" : task.priority === "high" ? "⬆" : "⬇",
			);
			badge.setAttribute("title", `Priority: ${task.priority}`);
		}
		titleEl.appendText(task.title);

		// Meta row
		const meta = card.createDiv({ cls: "arbiter-kanban-card-meta" });

		if (task.mattApproved) {
			const approved = meta.createEl("span", {
				cls: "arbiter-kanban-chip arbiter-kanban-chip-approved",
			});
			approved.setText("✅ approved");
			approved.setAttribute("title", "matt_approved: true — opted in for autonomous dispatch");
		}

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
	 * v0.5.0: silent mode — per-file Notices suppressed, single summary at end.
	 * Resolves the "Assess all errors" issue (see PRD §12.1 / OQ-013).
	 */
	private async assessAll(): Promise<void> {
		let assessed = 0;
		let failed = 0;
		const total = this.tasks.length;
		// One progress notice that we don't dismiss (Obsidian auto-dismisses on next),
		// then a final summary. No per-file spam.
		new Notice(`Arbiter: assessing ${total} task${total === 1 ? "" : "s"}…`, 2000);
		for (const task of this.tasks) {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) continue;
			try {
				const result = await this.plugin.assessFile(file, /* silent */ true);
				if (result === null) {
					failed++;
				} else {
					assessed++;
				}
			} catch {
				failed++;
			}
		}
		await this.refresh();
		new Notice(
			`Arbiter: assessed ${assessed} of ${total}${failed > 0 ? `, ${failed} failed (see console)` : ""}.`,
			6000
		);
	}
}
