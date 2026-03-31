import type { PolicyRule, PolicyConstraint, ActionType } from "./types";
import { parseFrontmatter } from "./task-parser";

const VALID_ACTIONS: ActionType[] = ["EXE", "ASK", "CTX", "DEC", "WAIT", "ESC", "DECL"];

/**
 * Parse a policy file's markdown content into a PolicyRule.
 *
 * Expected format:
 * ```markdown
 * ---
 * policy_id: POL-001
 * scope: vault
 * applies_to: "*"
 * ---
 *
 * ## Rules
 *
 * 1. Always ESC before deleting files outside the active task folder
 * 2. Always ASK before modifying files owned by another agent
 * ```
 *
 * Rule lines are parsed as: "Always <ACTION> <condition>"
 * or freeform text that we try to extract an action and condition from.
 */
export function parsePolicy(content: string): PolicyRule | null {
	const { frontmatter, body } = parseFrontmatter(content);

	const id = String(frontmatter.policy_id ?? frontmatter.id ?? "unknown");
	const scope = String(frontmatter.scope ?? "vault") as PolicyRule["scope"];
	const appliesTo = String(frontmatter.applies_to ?? "*");

	// Extract rules section
	const rulesMatch = body.match(/## Rules\s*\n([\s\S]*?)(?=\n## |$)/i);
	if (!rulesMatch) return null;

	const rulesText = rulesMatch[1];
	const rules: PolicyConstraint[] = [];

	// Parse numbered or bulleted rules
	const ruleLines = rulesText.split("\n").filter((line) => {
		const trimmed = line.trim();
		return trimmed.match(/^(\d+\.|[-*])\s+/);
	});

	for (const line of ruleLines) {
		const constraint = parseRuleLine(line.replace(/^[\s]*(\d+\.|[-*])\s+/, ""));
		if (constraint) {
			rules.push(constraint);
		}
	}

	if (rules.length === 0) return null;

	return { id, scope, appliesTo, rules };
}

/**
 * Parse a single rule line into a PolicyConstraint.
 *
 * Supports patterns like:
 *   "Always ESC before deleting files"
 *   "Never EXE tasks with needs_matt_review: true unless Matt has responded"
 *   "WAIT threshold: if urgency_date is >7 days away, defer"
 */
function parseRuleLine(line: string): PolicyConstraint | null {
	const trimmed = line.trim();

	// Pattern: "Always <ACTION> [when|before|if] <condition>"
	const alwaysMatch = trimmed.match(
		/^always\s+(EXE|ASK|CTX|DEC|WAIT|ESC|DECL)\s+(?:when|before|if|for)?\s*(.+)/i
	);
	if (alwaysMatch) {
		const action = alwaysMatch[1].toUpperCase() as ActionType;
		if (!VALID_ACTIONS.includes(action)) return null;
		return {
			condition: normalizeCondition(alwaysMatch[2]),
			action,
			reason: trimmed,
		};
	}

	// Pattern: "Never <ACTION> [when|unless] <condition>"
	// "Never EXE" means we need to pick a non-EXE action; default to ESC
	const neverMatch = trimmed.match(
		/^never\s+(EXE|ASK|CTX|DEC|WAIT|ESC|DECL)\s+(?:tasks?\s+)?(?:with|when|unless|if)?\s*(.+)/i
	);
	if (neverMatch) {
		const blockedAction = neverMatch[1].toUpperCase() as ActionType;
		// If "Never EXE", the constraint should escalate
		const action = blockedAction === "EXE" ? "ESC" : "DECL";
		return {
			condition: normalizeCondition(neverMatch[2]),
			action,
			reason: trimmed,
		};
	}

	return null;
}

/**
 * Normalize a condition string into a format evaluateCondition() can handle.
 * This is a best-effort heuristic parser.
 */
function normalizeCondition(raw: string): string {
	let cond = raw.trim();

	// "needs_matt_review: true" → "needs_matt_review == true"
	cond = cond.replace(/(\w+):\s*(true|false)/i, "$1 == $2");

	// "tasks involving billing" → "body contains billing"
	if (cond.match(/(?:involving|about|related to)\s+(\w+)/i)) {
		const match = cond.match(/(?:involving|about|related to)\s+(\w+)/i);
		if (match) {
			cond = `body contains ${match[1]}`;
		}
	}

	// "title contains X" - pass through
	// "owner == X" - pass through

	return cond;
}
