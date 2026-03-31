import type { ActionRecord, ArbiterSettings } from "./types";
import { ACTION_LABELS } from "./types";

/**
 * Format an ActionRecord as a markdown assessment block.
 */
export function formatAssessmentBlock(record: ActionRecord): string {
	const lines: string[] = [
		"## Agent Assessment",
		`- **Action**: ${record.action} (${ACTION_LABELS[record.action]})`,
		`- **Confidence**: ${record.confidence}`,
		`- **Recommended next action**: ${record.nextAction}`,
		`- **Why**: ${record.reason}`,
		`- **Blocker type**: ${record.blockerType}`,
		`- **Human input needed**: ${record.needsHuman ? "yes" : "no"}`,
	];

	if (record.humanAsk) {
		lines.push(`- **Human ask**: ${record.humanAsk}`);
	}
	if (record.wakeCondition) {
		lines.push(`- **Wake condition**: ${record.wakeCondition}`);
	}
	if (record.subtasks && record.subtasks.length > 0) {
		lines.push("- **Subtasks**:");
		for (const st of record.subtasks) {
			lines.push(`  - [ ] ${st}`);
		}
	}

	lines.push(`- **Last assessed**: ${formatTimestamp(record.lastAssessed)}`);

	return lines.join("\n");
}

/**
 * Format an ActionRecord as YAML frontmatter fields.
 * Returns a record of key-value pairs to merge into existing frontmatter.
 */
export function formatFrontmatterFields(
	record: ActionRecord,
	prefix: string = "arbiter_"
): Record<string, string | boolean> {
	const fields: Record<string, string | boolean> = {
		[`${prefix}action`]: record.action,
		[`${prefix}confidence`]: record.confidence,
		[`${prefix}blocker_type`]: record.blockerType,
		[`${prefix}needs_human`]: record.needsHuman,
		[`${prefix}last_assessed`]: record.lastAssessed,
	};

	if (record.wakeCondition) {
		fields[`${prefix}wake_condition`] = record.wakeCondition;
	}

	return fields;
}

/**
 * Update a task note's content with the new assessment.
 * - Updates or adds arbiter_ frontmatter fields
 * - Replaces or appends the ## Agent Assessment section
 */
export function updateTaskContent(
	content: string,
	record: ActionRecord,
	settings: Pick<ArbiterSettings, "frontmatterPrefix" | "assessmentHeading">
): string {
	let result = content;

	// Step 1: Update frontmatter
	result = updateFrontmatter(result, record, settings.frontmatterPrefix);

	// Step 2: Update or append assessment section
	result = updateAssessmentSection(result, record, settings.assessmentHeading);

	return result;
}

/**
 * Update arbiter_ fields in frontmatter.
 */
function updateFrontmatter(
	content: string,
	record: ActionRecord,
	prefix: string
): string {
	const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);
	if (!fmMatch) {
		// No frontmatter — add it
		const fields = formatFrontmatterFields(record, prefix);
		const fmLines = Object.entries(fields).map(
			([k, v]) => `${k}: ${typeof v === "boolean" ? v : `"${v}"`}`
		);
		return `---\n${fmLines.join("\n")}\n---\n${content}`;
	}

	const fmStart = fmMatch[1];
	let fmBody = fmMatch[2];
	const fmEnd = fmMatch[3];
	const afterFm = content.slice(fmMatch[0].length);

	const fields = formatFrontmatterFields(record, prefix);

	// Update existing fields or append new ones
	for (const [key, value] of Object.entries(fields)) {
		const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(`^${escapedKey}:.*$`, "m");
		const formatted = typeof value === "boolean" ? String(value) : `"${value}"`;

		if (pattern.test(fmBody)) {
			fmBody = fmBody.replace(pattern, `${key}: ${formatted}`);
		} else {
			fmBody += `\n${key}: ${formatted}`;
		}
	}

	return fmStart + fmBody + fmEnd + afterFm;
}

/**
 * Replace existing ## Agent Assessment section or append one.
 */
function updateAssessmentSection(
	content: string,
	record: ActionRecord,
	heading: string
): string {
	const assessmentBlock = formatAssessmentBlock(record);
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	// Try to find and replace existing assessment section
	const sectionPattern = new RegExp(
		`${escapedHeading}\\s*\\n[\\s\\S]*?(?=\\n## |$)`,
		"i"
	);

	if (sectionPattern.test(content)) {
		return content.replace(sectionPattern, assessmentBlock);
	}

	// Append before the last section or at end
	return content.trimEnd() + "\n\n" + assessmentBlock + "\n";
}

/**
 * Format a machine log entry for the optional append-only event log.
 */
export function formatLogEntry(
	record: ActionRecord,
	taskPath: string
): string {
	return [
		`## ${formatTimestamp(record.lastAssessed)}`,
		`- **Task**: ${taskPath}`,
		`- **Action**: ${record.action}`,
		`- **Confidence**: ${record.confidence}`,
		`- **Reason**: ${record.reason}`,
		`- **Next**: ${record.nextAction}`,
		record.humanAsk ? `- **Ask**: ${record.humanAsk}` : null,
		record.wakeCondition ? `- **Wake**: ${record.wakeCondition}` : null,
		"",
	]
		.filter(Boolean)
		.join("\n");
}

function formatTimestamp(iso: string): string {
	try {
		const date = new Date(iso);
		return date.toLocaleString("en-US", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			timeZoneName: "short",
		});
	} catch {
		return iso;
	}
}
