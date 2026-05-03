import { Notice, Plugin, TFile, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";
import type { ActionRecord, ArbiterSettings, PolicyRule } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { parseTask } from "./task-parser";
import { assessReadiness } from "./readiness";
import { selectAction } from "./action-selector";
import { parsePolicy } from "./policy-parser";
import { updateTaskContent, formatLogEntry, formatAssessmentBlock } from "./action-recorder";
import { ArbiterSettingTab } from "./settings";
import { ArbiterKanbanView, ARBITER_KANBAN_VIEW_TYPE } from "./kanban-view";

export default class ArbiterPlugin extends Plugin {
	settings: ArbiterSettings = DEFAULT_SETTINGS;
	private statusBarEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Command: Assess current note
		this.addCommand({
			id: "assess-current-note",
			name: "Assess current note",
			callback: () => this.assessCurrentNote(),
		});

		// Command: Assess task by path (for CLI/agent use)
		this.addCommand({
			id: "assess-task-by-path",
			name: "Assess task by path",
			callback: () => this.assessTaskByPathPrompt(),
		});

		// Command: Show assessment for current note (read-only)
		this.addCommand({
			id: "show-assessment",
			name: "Show current assessment",
			callback: () => this.showCurrentAssessment(),
		});

		// Command: Create policy from template
		this.addCommand({
			id: "create-policy",
			name: "Create new policy",
			callback: () => this.createPolicyFromTemplate(),
		});

		// Command: Validate all policies
		this.addCommand({
			id: "validate-policies",
			name: "Validate all policies",
			callback: () => this.validatePolicies(),
		});

		// Register the Kanban view (visual counterpart to the assess-* commands)
		this.registerView(
			ARBITER_KANBAN_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new ArbiterKanbanView(leaf, this)
		);

		// Command: Open Kanban view
		this.addCommand({
			id: "open-kanban-view",
			name: "Open Kanban view",
			callback: () => this.activateKanbanView(),
		});

		// Add a ribbon icon for one-click access to the Kanban
		this.addRibbonIcon("layout-grid", "Arbiter Kanban", () => this.activateKanbanView());

		// Settings tab
		this.addSettingTab(new ArbiterSettingTab(this.app, this));

		// Auto-assess on file change (if enabled)
		if (this.settings.autoAssessOnChange) {
			this.registerEvent(
				this.app.vault.on("modify", (file) => {
					if (file instanceof TFile && file.extension === "md") {
						this.handleFileChange(file);
					}
				})
			);
		}

		// Status bar
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.setText("Arbiter ready");

		console.log("Arbiter plugin loaded");
	}

	onunload() {
		console.log("Arbiter plugin unloaded");
	}

	async loadSettings() {
		const raw = await this.loadData();
		const candidate = Object.assign({}, DEFAULT_SETTINGS, raw);
		const { applyWithFallback } = await import("./settings-validator");
		const result = applyWithFallback(this.settings, candidate);
		this.settings = result.effective;
		if (result.status === "rejected") {
			console.error("Arbiter:", result.message);
			// Surface to user via Notice on next interactive load — done in the settings tab
			// rather than here to avoid spamming notices during plugin boot.
		}
	}

	async saveSettings() {
		const { applyWithFallback } = await import("./settings-validator");
		const result = applyWithFallback(this.settings, this.settings);
		if (result.status === "rejected") {
			console.error("Arbiter: refusing to save invalid settings:", result.message);
			return;
		}
		await this.saveData(this.settings);
	}

	/**
	 * Assess the currently active note.
	 */
	async assessCurrentNote() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("Arbiter: No active file to assess.");
			return;
		}
		await this.assessFile(file);
	}

	/**
	 * Prompt for a file path and assess that task.
	 */
	async assessTaskByPathPrompt() {
		// For agent use, this would be invoked with a path parameter.
		// In the UI, we assess the current note as a fallback.
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("Arbiter: No active file. Open a task note first.");
			return;
		}
		await this.assessFile(file);
	}

	/**
	 * Core assessment logic: parse task, check readiness, select action, record result.
	 */
	async assessFile(file: TFile): Promise<ActionRecord | null> {
		try {
			const content = await this.app.vault.read(file);
			const task = parseTask(content, file.path);

			// Load policies
			const policies = await this.loadPolicies();

			// Run readiness assessment
			const readiness = assessReadiness(task);

			// Select action
			const record = selectAction(task, readiness, policies);

			// Update the task note
			const updatedContent = updateTaskContent(content, record, {
				frontmatterPrefix: this.settings.frontmatterPrefix,
				assessmentHeading: this.settings.assessmentHeading,
			});

			await this.app.vault.modify(file, updatedContent);

			// Write to machine log if enabled
			if (this.settings.enableMachineLog) {
				await this.writeToMachineLog(record, file.path);
			}

			// Show notice
			const actionLabel = record.action;
			const icon =
				record.action === "EXE"
					? "✓"
					: record.action === "WAIT"
						? "⏳"
						: record.action === "ASK"
							? "❓"
							: "⚠";
			new Notice(`Arbiter: ${icon} ${actionLabel} — ${record.nextAction.slice(0, 80)}`);

			// Update status bar
			if (this.statusBarEl) {
				this.statusBarEl.setText(`Arbiter: ${icon} ${actionLabel}`);
			}

			return record;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Arbiter error: ${message}`);
			console.error("Arbiter assessment failed:", err);
			return null;
		}
	}

	/**
	 * Programmatic assessment for agent use — accepts a file path string.
	 */
	async assessTaskByPath(path: string): Promise<ActionRecord | null> {
		const normalizedPath = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!(file instanceof TFile)) {
			new Notice(`Arbiter: File not found: ${path}`);
			return null;
		}
		return this.assessFile(file);
	}

	/**
	 * Show the current assessment for the active note without re-running.
	 */
	async showCurrentAssessment() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("Arbiter: No active file.");
			return;
		}

		const content = await this.app.vault.read(file);
		const task = parseTask(content, file.path);

		if (task.arbiterAction) {
			new Notice(
				`Arbiter: ${task.arbiterAction} (${task.arbiterConfidence ?? "?"})\n` +
					`Last: ${task.arbiterLastAssessed ?? "never"}`,
				8000
			);
		} else {
			new Notice("Arbiter: No assessment found for this note. Run 'Assess current note' first.");
		}
	}

	/**
	 * Load all policy files from the policy folder.
	 */
	async loadPolicies(): Promise<PolicyRule[]> {
		const policies: PolicyRule[] = [];
		const policyPath = normalizePath(this.settings.policyFolderPath);
		const folder = this.app.vault.getAbstractFileByPath(policyPath);

		if (!(folder instanceof TFolder)) return policies;

		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				try {
					const content = await this.app.vault.read(child);
					const policy = parsePolicy(content);
					if (policy) policies.push(policy);
				} catch {
					console.warn(`Arbiter: Failed to parse policy ${child.path}`);
				}
			}
		}

		return policies;
	}

	/**
	 * Write an assessment event to the machine log.
	 */
	async writeToMachineLog(record: ActionRecord, taskPath: string) {
		const logFolder = normalizePath(this.settings.logFolderPath);
		const logPath = normalizePath(`${logFolder}/assessment-log.md`);

		// Ensure folder exists
		const folder = this.app.vault.getAbstractFileByPath(logFolder);
		if (!folder) {
			await this.app.vault.createFolder(logFolder);
		}

		const entry = formatLogEntry(record, taskPath);

		const existing = this.app.vault.getAbstractFileByPath(logPath);
		if (existing instanceof TFile) {
			const current = await this.app.vault.read(existing);
			await this.app.vault.modify(existing, current + "\n" + entry);
		} else {
			await this.app.vault.create(
				logPath,
				"# Arbiter Assessment Log\n\nAppend-only event log of action assessments.\n\n---\n\n" +
					entry
			);
		}
	}

	/**
	 * Create a new policy file from template.
	 */
	async createPolicyFromTemplate() {
		const policyFolder = normalizePath(this.settings.policyFolderPath);

		// Ensure folder exists
		const folder = this.app.vault.getAbstractFileByPath(policyFolder);
		if (!folder) {
			await this.app.vault.createFolder(policyFolder);
		}

		const template = `---
policy_id: POL-NEW
scope: vault
applies_to: "*"
---

## Rules

1. Always ESC before deleting files outside the active task folder
2. Always ASK before modifying files owned by another agent
3. Never EXE tasks with needs_matt_review == true unless Matt has responded
`;

		const filePath = normalizePath(`${policyFolder}/new-policy.md`);
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing) {
			new Notice("Arbiter: new-policy.md already exists. Edit it or rename.");
			return;
		}

		const file = await this.app.vault.create(filePath, template);
		await this.app.workspace.getLeaf().openFile(file);
		new Notice("Arbiter: Policy template created. Edit rules and rename the file.");
	}

	/**
	 * Validate all policy files in the policy folder.
	 */
	async validatePolicies() {
		const policies = await this.loadPolicies();
		if (policies.length === 0) {
			new Notice("Arbiter: No valid policies found. Create one with 'Create new policy'.");
			return;
		}

		let totalRules = 0;
		for (const p of policies) {
			totalRules += p.rules.length;
		}

		new Notice(
			`Arbiter: ${policies.length} policy file(s) valid, ${totalRules} rule(s) loaded.`
		);
	}

	/**
	 * Open or reveal the Arbiter Kanban view in a workspace leaf.
	 */
	async activateKanbanView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(ARBITER_KANBAN_VIEW_TYPE);

		if (leaves.length > 0) {
			// Already open — reveal the existing leaf
			leaf = leaves[0];
		} else {
			// Open in a new main-area tab
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: ARBITER_KANBAN_VIEW_TYPE,
				active: true,
			});
		}

		if (leaf) workspace.revealLeaf(leaf);
	}

	/**
	 * Handle file modification for auto-assess mode.
	 */
	async handleFileChange(file: TFile) {
		if (!this.settings.autoAssessOnChange) return;

		const content = await this.app.vault.read(file);
		const task = parseTask(content, file.path);

		if (task.arbiterAssess) {
			// Debounce: don't re-assess within 5 seconds
			const lastAssessed = task.arbiterLastAssessed;
			if (lastAssessed) {
				const elapsed = Date.now() - new Date(lastAssessed).getTime();
				if (elapsed < 5000) return;
			}

			await this.assessFile(file);
		}
	}
}
