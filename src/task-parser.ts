import type { ParsedTask, PreconditionItem, TaskSections } from "./types";
import { computeTaskRevision } from "./sync-protocol";

/**
 * Parse YAML frontmatter from markdown content.
 * Returns the frontmatter as a key-value record and the body after the frontmatter block.
 */
export function parseFrontmatter(content: string): {
	frontmatter: Record<string, unknown>;
	body: string;
} {
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!fmMatch) {
		return { frontmatter: {}, body: content };
	}

	const fmBlock = fmMatch[1];
	const body = fmMatch[2];
	const frontmatter: Record<string, unknown> = {};

	for (const line of fmBlock.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const key = line.slice(0, colonIdx).trim();
		let value: unknown = line.slice(colonIdx + 1).trim();

		if (value === "") continue;

		// Handle YAML arrays: [tag1, tag2]
		const strVal = value as string;
		if (strVal.startsWith("[") && strVal.endsWith("]")) {
			value = strVal
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""));
		}
		// Handle booleans
		else if (strVal === "true") value = true;
		else if (strVal === "false") value = false;
		// Handle quoted strings
		else if (
			(strVal.startsWith('"') && strVal.endsWith('"')) ||
			(strVal.startsWith("'") && strVal.endsWith("'"))
		) {
			value = strVal.slice(1, -1);
		}

		frontmatter[key] = value;
	}

	return { frontmatter, body };
}

/**
 * Parse checklist items from a markdown section.
 * Handles both `- [ ] item` and `- [x] item` formats.
 */
function parseChecklistItems(text: string): PreconditionItem[] {
	const items: PreconditionItem[] = [];
	const lines = text.split("\n");

	for (const line of lines) {
		const match = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)/);
		if (match) {
			items.push({
				checked: match[1].toLowerCase() === "x",
				text: match[2].trim(),
			});
		}
	}
	return items;
}

/**
 * Extract text content of a markdown section by heading.
 * Returns everything between the heading and the next heading of same or higher level.
 */
function extractSection(body: string, heading: string): string | undefined {
	// Match the heading (case-insensitive) and capture until next same-level or higher heading
	const headingLevel = heading.match(/^(#+)/)?.[1].length ?? 2;
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(
		`${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n#{1,${headingLevel}}\\s|$)`,
		"i"
	);
	const match = body.match(pattern);
	return match ? match[1].trim() : undefined;
}

/**
 * Parse body sections from a task note.
 */
function parseSections(body: string): TaskSections {
	const sections: TaskSections = {};

	const outcome = extractSection(body, "## Outcome");
	if (outcome) sections.outcome = outcome;

	const preconditions = extractSection(body, "## Preconditions");
	if (preconditions) sections.preconditions = parseChecklistItems(preconditions);

	const steps = extractSection(body, "## Execution Steps");
	if (steps) sections.executionSteps = parseChecklistItems(steps);

	const validation = extractSection(body, "## Validation");
	if (validation) sections.validation = validation;

	const risks = extractSection(body, "## Risks");
	if (risks) sections.risks = risks;

	const handoff = extractSection(body, "## Hand-off");
	if (handoff) sections.handoff = handoff;

	const done = extractSection(body, "## Done Criteria");
	if (done) sections.doneCriteria = parseChecklistItems(done);

	const askForMatt = extractSection(body, "## Ask for Matt");
	if (askForMatt) sections.askForMatt = askForMatt;

	const research = extractSection(body, "## Research Question");
	if (research) sections.researchQuestion = research;

	const scope = extractSection(body, "## Scope");
	if (scope) sections.scope = scope;

	const assessment = extractSection(body, "## Agent Assessment");
	if (assessment) sections.agentAssessment = assessment;

	return sections;
}

/**
 * Parse a task note's content into a structured ParsedTask.
 */
export function parseTask(content: string, filePath: string): ParsedTask {
	const { frontmatter, body } = parseFrontmatter(content);
	const sections = parseSections(body);

	return {
		title: String(frontmatter.title ?? "Untitled"),
		type: String(frontmatter.type ?? "task-execution"),
		status: String(frontmatter.status ?? "active"),
		owner: String(frontmatter.owner ?? "unknown"),

		capabilityPrimary: frontmatter.capability_primary
			? String(frontmatter.capability_primary)
			: undefined,
		needsMattReview:
			frontmatter.needs_matt_review === true || frontmatter.needs_matt_review === "true",
		urgencyDate: frontmatter.urgency_date ? String(frontmatter.urgency_date) : undefined,
		projectTag: Array.isArray(frontmatter.project_tag)
			? (frontmatter.project_tag as string[])
			: frontmatter.project_tag
				? [String(frontmatter.project_tag)]
				: undefined,

		// Arbiter fields
		arbiterAction: frontmatter.arbiter_action as ParsedTask["arbiterAction"],
		arbiterConfidence: frontmatter.arbiter_confidence as ParsedTask["arbiterConfidence"],
		arbiterBlockerType: frontmatter.arbiter_blocker_type as ParsedTask["arbiterBlockerType"],
		arbiterNeedsHuman:
			frontmatter.arbiter_needs_human === true ||
			frontmatter.arbiter_needs_human === "true",
		arbiterLastAssessed: frontmatter.arbiter_last_assessed
			? String(frontmatter.arbiter_last_assessed)
			: undefined,
		arbiterWakeCondition: frontmatter.arbiter_wake_condition
			? String(frontmatter.arbiter_wake_condition)
			: undefined,
		arbiterAssess:
			frontmatter.arbiter_assess === true || frontmatter.arbiter_assess === "true",
		arbiterDecDepth:
			typeof frontmatter.arbiter_dec_depth === "number"
				? frontmatter.arbiter_dec_depth
				: frontmatter.arbiter_dec_depth !== undefined
					? Number(frontmatter.arbiter_dec_depth)
					: undefined,
		arbiterDecParent: frontmatter.arbiter_dec_parent
			? String(frontmatter.arbiter_dec_parent)
			: undefined,

		// SYNC-001: revision tracking
		taskRevision: computeTaskRevision(body, frontmatter),
		arbiterAssessedRevision: frontmatter.arbiter_assessed_revision
			? String(frontmatter.arbiter_assessed_revision)
			: undefined,

		filePath,
		rawFrontmatter: frontmatter,
		bodyContent: body,
		sections,
	};
}
