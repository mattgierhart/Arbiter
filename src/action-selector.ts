import type {
	ActionRecord,
	ActionType,
	BlockerType,
	ConfidenceLevel,
	ParsedTask,
	PolicyConstraint,
	PolicyRule,
	ReadinessResult,
} from "./types";
import { BLOCKER_TO_ACTION } from "./types";

/**
 * Check if any policy rules override the default action selection.
 * Returns the overriding action if a policy matches, or null.
 */
function checkPolicies(
	task: ParsedTask,
	policies: PolicyRule[]
): { action: ActionType; reason: string } | null {
	for (const policy of policies) {
		// Check scope match
		if (policy.scope === "task-type" && policy.appliesTo !== task.type) continue;
		if (policy.scope === "agent" && policy.appliesTo !== task.owner) continue;
		if (
			policy.scope === "folder" &&
			!task.filePath.startsWith(policy.appliesTo)
		)
			continue;
		// "vault" scope always applies

		for (const constraint of policy.rules) {
			if (evaluateCondition(constraint.condition, task)) {
				return { action: constraint.action, reason: constraint.reason };
			}
		}
	}
	return null;
}

/**
 * Evaluate a simple policy condition against a task.
 * Supports basic patterns like:
 *   "needs_matt_review == true"
 *   "title contains billing"
 *   "owner == pinch"
 */
function evaluateCondition(condition: string, task: ParsedTask): boolean {
	const trimmed = condition.trim().toLowerCase();

	// "field == value" pattern
	const eqMatch = trimmed.match(/^(\w+)\s*==\s*(.+)$/);
	if (eqMatch) {
		const field = eqMatch[1];
		const expected = eqMatch[2].trim().replace(/^["']|["']$/g, "");
		const actual = getTaskField(task, field);
		return String(actual).toLowerCase() === expected.toLowerCase();
	}

	// "field contains value" pattern
	const containsMatch = trimmed.match(/^(\w+)\s+contains\s+(.+)$/);
	if (containsMatch) {
		const field = containsMatch[1];
		const needle = containsMatch[2].trim().replace(/^["']|["']$/g, "");
		const actual = getTaskField(task, field);
		return String(actual).toLowerCase().includes(needle.toLowerCase());
	}

	return false;
}

function getTaskField(task: ParsedTask, field: string): unknown {
	const fieldMap: Record<string, unknown> = {
		title: task.title,
		type: task.type,
		status: task.status,
		owner: task.owner,
		needs_matt_review: task.needsMattReview,
		urgency_date: task.urgencyDate,
		capability_primary: task.capabilityPrimary,
		body: task.bodyContent,
	};
	return fieldMap[field] ?? task.rawFrontmatter[field];
}

/**
 * Determine confidence level based on readiness state.
 */
function determineConfidence(readiness: ReadinessResult): ConfidenceLevel {
	if (readiness.allReady) return "high";
	if (readiness.anyBlocked) {
		return readiness.blockedDimensions.length > 1 ? "low" : "medium";
	}
	// Only partial issues
	return readiness.partialDimensions.length > 1 ? "medium" : "high";
}

/**
 * Determine the primary blocker type from readiness results.
 */
function determinePrimaryBlocker(readiness: ReadinessResult): BlockerType {
	// Blocked dimensions take priority over partial
	if (readiness.blockedDimensions.length > 0) {
		return readiness.blockedDimensions[0].blockerType ?? "none";
	}
	if (readiness.partialDimensions.length > 0) {
		return readiness.partialDimensions[0].blockerType ?? "none";
	}
	return "none";
}

/**
 * Generate the recommended next action text based on the selected action type.
 */
function generateNextAction(
	action: ActionType,
	task: ParsedTask,
	readiness: ReadinessResult
): string {
	switch (action) {
		case "EXE": {
			// Try to find the first unchecked execution step
			const steps = task.sections.executionSteps ?? [];
			const nextStep = steps.find((s) => !s.checked);
			if (nextStep) {
				return nextStep.text;
			}
			return `Execute task: ${task.title}`;
		}
		case "ASK": {
			const blocked = [
				...readiness.blockedDimensions,
				...readiness.partialDimensions,
			].filter((d) => d.blockerType === "ambiguity" || d.blockerType === "access");
			if (blocked.length > 0) {
				return `Ask: ${blocked[0].reason}`;
			}
			return "Ask for clarification on task requirements.";
		}
		case "CTX": {
			const ctxBlocked = [
				...readiness.blockedDimensions,
				...readiness.partialDimensions,
			].filter((d) => d.blockerType === "missing-context");
			if (ctxBlocked.length > 0) {
				return `Gather context: ${ctxBlocked[0].reason}`;
			}
			return "Gather missing context before proceeding.";
		}
		case "DEC":
			return `Decompose "${task.title}" into smaller subtasks before execution.`;
		case "WAIT": {
			const depBlocked = [
				...readiness.blockedDimensions,
				...readiness.partialDimensions,
			].filter(
				(d) => d.blockerType === "dependency" || d.blockerType === "time"
			);
			if (depBlocked.length > 0) {
				return `Wait: ${depBlocked[0].reason}`;
			}
			return "Wait for blocking dependency to resolve.";
		}
		case "ESC": {
			const riskBlocked = [
				...readiness.blockedDimensions,
				...readiness.partialDimensions,
			].filter(
				(d) => d.blockerType === "risk" || d.blockerType === "capability"
			);
			if (riskBlocked.length > 0) {
				return `Escalate: ${riskBlocked[0].reason}`;
			}
			return "Escalate for human approval before proceeding.";
		}
		case "DECL":
			return `Decline: Task cannot proceed — ${readiness.blockedDimensions.map((d) => d.reason).join("; ")}`;
	}
}

/**
 * Generate a human ask string for ASK actions.
 */
function generateHumanAsk(
	readiness: ReadinessResult
): string | undefined {
	const askable = [
		...readiness.blockedDimensions,
		...readiness.partialDimensions,
	].filter(
		(d) =>
			d.blockerType === "ambiguity" ||
			d.blockerType === "access" ||
			d.blockerType === "missing-context"
	);

	if (askable.length === 0) return undefined;

	return askable.map((d) => d.reason).join(". ");
}

/**
 * Select the best action for a task given its readiness assessment and policies.
 */
export function selectAction(
	task: ParsedTask,
	readiness: ReadinessResult,
	policies: PolicyRule[] = []
): ActionRecord {
	const now = new Date().toISOString();

	// Step 1: Check policy overrides first
	const policyOverride = checkPolicies(task, policies);
	if (policyOverride) {
		return {
			action: policyOverride.action,
			confidence: "high",
			reason: `Policy override: ${policyOverride.reason}`,
			nextAction: generateNextAction(policyOverride.action, task, readiness),
			blockerType: determinePrimaryBlocker(readiness),
			needsHuman: ["ASK", "ESC", "DECL"].includes(policyOverride.action),
			lastAssessed: now,
			humanAsk:
				policyOverride.action === "ASK"
					? generateHumanAsk(readiness)
					: undefined,
		};
	}

	// Step 2: If all ready, execute
	if (readiness.allReady) {
		return {
			action: "EXE",
			confidence: "high",
			reason: "All readiness dimensions are satisfied.",
			nextAction: generateNextAction("EXE", task, readiness),
			blockerType: "none",
			needsHuman: false,
			lastAssessed: now,
		};
	}

	// Step 3: Map primary blocker to action
	const primaryBlocker = determinePrimaryBlocker(readiness);
	const action = BLOCKER_TO_ACTION[primaryBlocker];
	const confidence = determineConfidence(readiness);

	// Build the reason from all non-ready dimensions
	const allIssues = [
		...readiness.blockedDimensions,
		...readiness.partialDimensions,
	];
	const reason = allIssues.map((d) => `${d.dimension}: ${d.reason}`).join("; ");

	const record: ActionRecord = {
		action,
		confidence,
		reason,
		nextAction: generateNextAction(action, task, readiness),
		blockerType: primaryBlocker,
		needsHuman: ["ASK", "ESC", "DECL"].includes(action),
		lastAssessed: now,
	};

	// Add action-specific fields
	if (action === "ASK") {
		record.humanAsk = generateHumanAsk(readiness);
	}
	if (action === "WAIT") {
		const depIssues = allIssues.filter(
			(d) => d.blockerType === "dependency" || d.blockerType === "time"
		);
		if (depIssues.length > 0) {
			record.wakeCondition = depIssues.map((d) => d.reason).join("; ");
		}
	}
	if (action === "DEC") {
		record.subtasks = [
			`Analyze scope of "${task.title}"`,
			"Identify atomic subtasks",
			"Create subtask notes",
			"Assess each subtask independently",
		];
	}

	return record;
}
