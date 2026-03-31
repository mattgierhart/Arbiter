import { App, PluginSettingTab, Setting } from "obsidian";
import type ArbiterPlugin from "./main";
import type { ArbiterSettings } from "./types";

export class ArbiterSettingTab extends PluginSettingTab {
	plugin: ArbiterPlugin;

	constructor(app: App, plugin: ArbiterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Arbiter — Agent Action Orchestration" });
		containerEl.createEl("p", {
			text: "Configure how Arbiter assesses tasks and records action decisions.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Policy folder")
			.setDesc("Path to the folder containing policy files (relative to vault root).")
			.addText((text) =>
				text
					.setPlaceholder(".agent-orchestrator/policies")
					.setValue(this.plugin.settings.policyFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.policyFolderPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Machine log folder")
			.setDesc("Path for optional append-only event log (relative to vault root).")
			.addText((text) =>
				text
					.setPlaceholder(".agent-orchestrator/logs")
					.setValue(this.plugin.settings.logFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.logFolderPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Task discovery folders")
			.setDesc("Comma-separated list of folders to scan for task notes.")
			.addText((text) =>
				text
					.setPlaceholder("backlog/tasks")
					.setValue(this.plugin.settings.taskDiscoveryFolders.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.taskDiscoveryFolders = value
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Frontmatter prefix")
			.setDesc("Prefix for Arbiter-managed frontmatter fields.")
			.addText((text) =>
				text
					.setPlaceholder("arbiter_")
					.setValue(this.plugin.settings.frontmatterPrefix)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterPrefix = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Assessment heading")
			.setDesc("Markdown heading used for the inline assessment block.")
			.addText((text) =>
				text
					.setPlaceholder("## Agent Assessment")
					.setValue(this.plugin.settings.assessmentHeading)
					.onChange(async (value) => {
						this.plugin.settings.assessmentHeading = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable machine log")
			.setDesc("Write append-only assessment events to the log folder.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableMachineLog)
					.onChange(async (value) => {
						this.plugin.settings.enableMachineLog = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-assess on change")
			.setDesc(
				"Automatically run assessment when a task note with arbiter_assess: true is modified."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAssessOnChange)
					.onChange(async (value) => {
						this.plugin.settings.autoAssessOnChange = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Confidence threshold")
			.setDesc(
				"Minimum confidence (0.0–1.0) for EXE recommendations. Below this, suggest a non-EXE action."
			)
			.addText((text) =>
				text
					.setPlaceholder("0.7")
					.setValue(String(this.plugin.settings.confidenceThreshold))
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && num >= 0 && num <= 1) {
							this.plugin.settings.confidenceThreshold = num;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
