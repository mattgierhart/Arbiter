import type {
	ActionRecord,
	ArbiterSettings,
	EvidenceAtom,
	ParsedTask,
	ReadinessDimension,
	ReadinessResult,
	WorkflowColumn,
} from "./types";
import { ACTION_LABELS } from "./types";

/**
 * v0.6.0: bundle of context the recorder needs to render a lane-aware
 * assessment block. When omitted, the legacy single-template render is used.
 */
export interface LaneContext {
	task: ParsedTask;
	readiness: ReadinessResult;
	column: WorkflowColumn;
}

/**
 * Format an ActionRecord as a markdown assessment block.
 */
export function formatAssessmentBlock(record: ActionRecord): string {
	const actionLabel = record.terminal
		? `${record.action} (Terminal — ${record.reason})`
		: `${record.action} (${ACTION_LABELS[record.action]})`;

	const lines: string[] = [
		"## Agent Assessment",
		`- **Action**: ${actionLabel}`,
		`- **Confidence**: ${record.confidence}`,
		`- **Recommended next action**: ${record.nextAction}`,
		`- **Why**: ${record.reason}`,
		`- **Blocker type**: ${record.blockerType}`,
		`- **Human input needed**: ${record.needsHuman ? "yes" : "no"}`,
	];

	if (record.terminal) {
		lines.push("- **Terminal**: yes — no further action required");
	}

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

	if (record.terminal) {
		fields[`${prefix}terminal`] = true;
	}

	if (record.wakeCondition) {
		fields[`${prefix}wake_condition`] = record.wakeCondition;
	}

	// SYNC-001: pin the revision this assessment was computed against so external
	// readers can detect torn cross-file snapshots. Only emitted when the action
	// selector populated assessedTaskRevision (which it should whenever the
	// task being scored has a non-null taskRevision).
	if (record.assessedTaskRevision) {
		fields[`${prefix}assessed_revision`] = record.assessedTaskRevision;
	}

	return fields;
}

/**
 * Update a task note's content with the new assessment.
 * - Updates or adds arbiter_ frontmatter fields
 * - Replaces or appends the ## Agent Assessment section
 *
 * v0.6.0: when `lane` is provided AND `settings.laneAwareAssessments` is true
 * AND `lane.column !== "unknown"`, the assessment block uses a column-keyed
 * template (gap analysis / dispatch envelope / verification / audit). Otherwise
 * the legacy single-template render is used (back-compat).
 */
export function updateTaskContent(
	content: string,
	record: ActionRecord,
	settings: Pick<ArbiterSettings, "frontmatterPrefix" | "assessmentHeading" | "laneAwareAssessments">,
	lane?: LaneContext,
): string {
	let result = content;

	// Step 1: Update frontmatter
	result = updateFrontmatter(result, record, settings.frontmatterPrefix);

	// Step 2: Update or append assessment section
	const useLaneAware =
		settings.laneAwareAssessments && lane !== undefined && lane.column !== "unknown";
	const block = useLaneAware
		? formatLaneAwareAssessmentBlock(record, lane!)
		: formatAssessmentBlock(record);
	result = replaceOrAppendAssessmentSection(result, block, settings.assessmentHeading);

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
 * Replace existing ## Agent Assessment section or append a new one.
 */
function replaceOrAppendAssessmentSection(
	content: string,
	assessmentBlock: string,
	heading: string,
): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	// Try to find and replace existing assessment section
	const sectionPattern = new RegExp(
		`${escapedHeading}\\s*\\n[\\s\\S]*?(?=\\n## |$)`,
		"i",
	);

	if (sectionPattern.test(content)) {
		return content.replace(sectionPattern, assessmentBlock);
	}

	// Append before the last section or at end
	return content.trimEnd() + "\n\n" + assessmentBlock + "\n";
}

/**
 * Set or update a single frontmatter field in markdown content.
 * Used by the v0.5.0 toggle commands (matt_approved, priority).
 *
 * - If frontmatter exists, finds the key and replaces the line, OR appends
 *   the key if not present.
 * - If no frontmatter exists, creates one with just this field.
 * - Boolean values render bare (`true` / `false`); strings render unquoted
 *   when they're plain identifiers, double-quoted otherwise.
 */
export function setFrontmatterField(
	content: string,
	key: string,
	value: string | boolean | null,
): string {
	const formatted = formatFrontmatterValue(value);
	const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);

	if (!fmMatch) {
		if (value === null) return content; // nothing to remove from no-frontmatter file
		return `---\n${key}: ${formatted}\n---\n${content}`;
	}

	const fmStart = fmMatch[1];
	let fmBody = fmMatch[2];
	const fmEnd = fmMatch[3];
	const afterFm = content.slice(fmMatch[0].length);

	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^${escapedKey}:.*$`, "m");

	if (value === null) {
		// Remove the line if present, otherwise no-op
		if (pattern.test(fmBody)) {
			fmBody = fmBody.replace(pattern, "").replace(/\n\n+/g, "\n");
		}
	} else if (pattern.test(fmBody)) {
		fmBody = fmBody.replace(pattern, `${key}: ${formatted}`);
	} else {
		fmBody = fmBody.trimEnd() + `\n${key}: ${formatted}`;
	}

	return fmStart + fmBody + fmEnd + afterFm;
}

function formatFrontmatterValue(value: string | boolean | null): string {
	if (typeof value === "boolean") return String(value);
	if (value === null) return "null";
	// Plain identifier — no quotes needed
	if (/^[a-z][a-z0-9_-]*$/i.test(value)) return value;
	// Otherwise quote, escaping internal quotes
	return `"${value.replace(/"/g, '\\"')}"`;
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

/**
 * v0.6.0: render an assessment block in the dialect of the workflow column
 * the card currently sits in. Same engine output, different framing per stage.
 *
 *   proposed/    → "Gap analysis" — what's missing to make this ready?
 *   next/        → "Dispatch envelope" — who runs this, where, with what?
 *   in-progress/ → "Verification" — what to check before marking done?
 *   done/        → "Audit footprint" — what was decided and what fired?
 *
 * See PRD §13.5 for the full per-template spec.
 */
export function formatLaneAwareAssessmentBlock(
	record: ActionRecord,
	lane: LaneContext,
): string {
	switch (lane.column) {
		case "proposed":
			return renderProposedTemplate(record, lane);
		case "next":
			return renderNextTemplate(record, lane);
		case "in-progress":
			return renderInProgressTemplate(record, lane);
		case "done":
			return renderDoneTemplate(record, lane);
		case "unknown":
		default:
			// Caller should have routed to the legacy formatter, but be safe.
			return formatAssessmentBlock(record);
	}
}

const DIMENSION_LABEL: Record<ReadinessDimension["dimension"], string> = {
	clarity: "Clarity",
	context: "Context",
	scope: "Scope",
	authority: "Authority",
	dependencies: "Dependencies",
	feasibility: "Feasibility",
};

function polarityIcon(polarity: EvidenceAtom["polarity"]): string {
	switch (polarity) {
		case "supports":
			return "✅";
		case "blocks":
			return "⚠️";
		case "neutral":
			return "ℹ️";
	}
}

function renderEvidenceLine(atom: EvidenceAtom): string {
	const icon = polarityIcon(atom.polarity);
	const note = atom.note ? ` — ${atom.note}` : "";
	return `  - ${icon} \`${atom.ref}\`${note}`;
}

function renderDimensionBlock(dim: ReadinessDimension): string[] {
	const lines: string[] = [`- **${DIMENSION_LABEL[dim.dimension]}** — ${dim.state}`];
	if (dim.evidence && dim.evidence.length > 0) {
		for (const atom of dim.evidence) {
			lines.push(renderEvidenceLine(atom));
		}
	} else {
		// Back-compat fallback when an assessor didn't populate evidence.
		lines.push(`  - ${dim.reason}`);
	}
	return lines;
}

/**
 * Sort dimensions so the most-relevant-to-this-template appear first.
 */
function orderForProposed(dims: ReadinessDimension[]): ReadinessDimension[] {
	// Lowest-scoring blocking dimensions first; everything else after.
	const order = (state: ReadinessDimension["state"]) =>
		state === "blocked" ? 0 : state === "partial" ? 1 : 2;
	return [...dims].sort((a, b) => order(a.state) - order(b.state));
}

function orderForNext(dims: ReadinessDimension[]): ReadinessDimension[] {
	// Authority + Feasibility first (the hard-blocks from OQ-005), then rest in
	// original order.
	const HARD = new Set(["authority", "feasibility"]);
	const hard = dims.filter((d) => HARD.has(d.dimension));
	const soft = dims.filter((d) => !HARD.has(d.dimension));
	return [...hard, ...soft];
}

function orderForInProgress(dims: ReadinessDimension[]): ReadinessDimension[] {
	// Feasibility first — did the agent actually have what it needed?
	const feasibility = dims.filter((d) => d.dimension === "feasibility");
	const rest = dims.filter((d) => d.dimension !== "feasibility");
	return [...feasibility, ...rest];
}

function renderProposedTemplate(record: ActionRecord, lane: LaneContext): string {
	const blocked = lane.readiness.blockedDimensions;
	const partial = lane.readiness.partialDimensions;
	const gaps = [...blocked, ...partial].slice(0, 2).map((d) => DIMENSION_LABEL[d.dimension]);

	const headline =
		gaps.length === 0
			? "**Promotion-eligible — no gaps detected**"
			: `**Refinement needed: ${gaps.join(", ").toLowerCase()}**`;

	const lines: string[] = [
		"## Agent Assessment",
		headline,
		"",
		`- **Action**: ${record.action} (${ACTION_LABELS[record.action]})`,
		`- **Confidence**: ${record.confidence}`,
	];

	for (const dim of orderForProposed(lane.readiness.dimensions)) {
		lines.push(...renderDimensionBlock(dim));
	}

	lines.push("");
	lines.push(
		gaps.length === 0
			? "_Move to `next/` to dispatch._"
			: "_Address the gaps above, then move to `next/`._",
	);
	lines.push(`_Last assessed: ${formatTimestamp(record.lastAssessed)}._`);

	return lines.join("\n");
}

function renderNextTemplate(record: ActionRecord, lane: LaneContext): string {
	const approved = lane.task.mattApproved === true;
	const headline =
		record.action === "EXE"
			? `**EXE — dispatch to ${lane.task.owner} · Confidence: ${record.confidence}**`
			: `**${record.action} (${ACTION_LABELS[record.action]}) · Confidence: ${record.confidence}**`;

	const lines: string[] = ["## Agent Assessment", headline, ""];

	for (const dim of orderForNext(lane.readiness.dimensions)) {
		lines.push(...renderDimensionBlock(dim));
	}

	lines.push("");
	lines.push(`- **Next step**: ${record.nextAction}`);
	lines.push(`- **Dispatch envelope**: ${lane.task.owner}`);
	if (record.humanAsk) {
		lines.push(`- **Human ask**: ${record.humanAsk}`);
	}
	if (record.wakeCondition) {
		lines.push(`- **Wake condition**: ${record.wakeCondition}`);
	}

	lines.push("");
	lines.push(
		approved
			? "_Approved + dispatchable._"
			: "_Awaiting approval (set `matt_approved: true` to dispatch)._",
	);
	lines.push(`_Last assessed: ${formatTimestamp(record.lastAssessed)}._`);

	return lines.join("\n");
}

function renderInProgressTemplate(record: ActionRecord, lane: LaneContext): string {
	const since = lane.task.arbiterLastAssessed ?? record.lastAssessed;
	const headline = `**In flight with ${lane.task.owner} since ${formatTimestamp(since)}**`;

	const lines: string[] = [
		"## Agent Assessment",
		headline,
		"",
		`- **Current action**: ${record.action} (${ACTION_LABELS[record.action]})`,
		`- **Confidence**: ${record.confidence}`,
	];

	for (const dim of orderForInProgress(lane.readiness.dimensions)) {
		lines.push(...renderDimensionBlock(dim));
	}

	// Done-criteria checklist surfaces what to verify before marking done.
	const doneCriteria = lane.task.sections.doneCriteria ?? [];
	if (doneCriteria.length > 0) {
		lines.push("");
		lines.push("**Done criteria — verify before marking done:**");
		for (const dc of doneCriteria) {
			lines.push(`- [${dc.checked ? "x" : " "}] ${dc.text}`);
		}
	}

	lines.push("");
	lines.push("_Verify done criteria before moving to `done/`._");
	lines.push(`_Last assessed: ${formatTimestamp(record.lastAssessed)}._`);

	return lines.join("\n");
}

function renderDoneTemplate(record: ActionRecord, lane: LaneContext): string {
	const headline = record.terminal
		? `**${record.action} — terminal (${record.reason})**`
		: `**${record.action} (${ACTION_LABELS[record.action]}) — recorded**`;

	const lines: string[] = [
		"## Agent Assessment",
		headline,
		"",
		`- **Dispatched by**: ${lane.task.owner}`,
		`- **Final confidence**: ${record.confidence}`,
		`- **Reason**: ${record.reason}`,
	];

	// Snapshot of dimensions as-of-dispatch (no re-scoring framing).
	lines.push("");
	lines.push("**As-of-dispatch snapshot:**");
	for (const dim of lane.readiness.dimensions) {
		lines.push(...renderDimensionBlock(dim));
	}

	lines.push("");
	lines.push("_Read-only audit footprint. Re-assessment does not overwrite (per ARC-002)._");
	lines.push(`_Last assessed: ${formatTimestamp(record.lastAssessed)}._`);

	return lines.join("\n");
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
