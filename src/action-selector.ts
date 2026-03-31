import type {
	ActionRecord,
	ActionType,
	BlockerType,
	ConfidenceLevel,
	ParsedTask,
	PolicyRule,
	ReadinessDimension,
	ReadinessResult,
} from "./types";
import { BLOCKER_TO_ACTION, BLOCKER_PRIORITY } from "./types";

/**
 * Check if any policy rules override the default action selection.
 */
function checkPolicies(
	task: ParsedTask,
	policies: PolicyRule[]
): { action: ActionType; reason: string } | null {
	for (const policy of policies) {
		if (policy.scope === "task-type" && policy.appliesTo !== task.type) continue;
		if (policy.scope === "agent" && policy.appliesTo !== task.owner) continue;
		if (policy.scope === "folder" && !task.filePath.startsWith(policy.appliesTo)) continue;

		for (const constraint of policy.rules) {
			if (evaluateCondition(constraint.condition, task)) {
				return { action: constraint.action, reason: constraint.reason };
			}
		}
	}
	return null;
}

function evaluateCondition(condition: string, task: ParsedTask): boolean {
	const trimmed = condition.trim().toLowerCase();

	const eqMatch = trimmed.match(/^(\w+)\s*==\s*(.+)$/);
	if (eqMatch) {
		const field = eqMatch[1];
		const expected = eqMatch[2].trim().replace(/^["']|["']$/g, "");
		const actual = getTaskField(task, field);
		return String(actual).toLowerCase() === expected.toLowerCase();
	}

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

function determineConfidence(readiness: ReadinessResult): ConfidenceLevel {
	if (readiness.allReady) return "high";
	if (readiness.anyBlocked) {
		return readiness.blockedDimensions.length > 1 ? "low" : "medium";
	}
	return readiness.partialDimensions.length > 1 ? "medium" : "high";
}

/**
 * Determine the primary blocker using priority ordering.
 * Authority/access/risk blockers outrank missing-context so that
 * human-gated tasks get ASK/ESC instead of CTX.
 */
function determinePrimaryBlocker(readiness: ReadinessResult): BlockerType {
	const allIssues: ReadinessDimension[] = [
		...readiness.blockedDimensions,
		...readiness.partialDimensions,
	];

	if (allIssues.length === 0) return "none";

	// Sort by blocker priority (lower index = higher priority)
	const sorted = allIssues
		.filter((d) => d.blockerType && d.blockerType !== "none")
		.sort((a, b) => {
			const aPri = BLOCKER_PRIORITY.indexOf(a.blockerType ?? "none");
			const bPri = BLOCKER_PRIORITY.indexOf(b.blockerType ?? "none");
			// Prefer blocked over partial at same priority
			if (aPri === bPri) {
				if (a.state === "blocked" && b.state !== "blocked") return -1;
				if (b.state === "blocked" && a.state !== "blocked") return 1;
			}
			return aPri - bPri;
		});

	return sorted.length > 0 ? (sorted[0].blockerType ?? "none") : "none";
}

/**
 * Check if a task is in a terminal state (completed/cancelled).
 */
function isTerminal(task: ParsedTask): { terminal: true; reason: string } | null {
	if (task.status === "completed") {
		return { terminal: true, reason: "Task is already completed." };
	}
	if (task.status === "cancelled") {
		return { terminal: true, reason: "Task is cancelled." };
	}
	return null;
}

/**
 * Detect whether the task fundamentally requires human involvement,
 * beyond what the action type alone tells us.
 */
function detectHumanNeeded(
	task: ParsedTask,
	readiness: ReadinessResult,
	action: ActionType
): boolean {
	// These actions always need human
	if (action === "ASK" || action === "ESC") return true;

	// Check for explicit human-gating signals
	if (task.needsMattReview) return true;

	// Check if any blocker is human-requiring
	const humanBlockers: BlockerType[] = ["access", "risk", "policy"];
	const allIssues = [...readiness.blockedDimensions, ...readiness.partialDimensions];
	for (const issue of allIssues) {
		if (issue.blockerType && humanBlockers.includes(issue.blockerType)) {
			return true;
		}
	}

	// Check body for human-gated keywords in unchecked preconditions
	const preconditions = task.sections.preconditions ?? [];
	const humanKeywords = ["approval", "confirm", "matt", "review", "access", "billing", "permission"];
	for (const p of preconditions) {
		if (!p.checked) {
			const lower = p.text.toLowerCase();
			if (humanKeywords.some((kw) => lower.includes(kw))) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Synthesize a precise, minimal human ask from the readiness issues.
 */
function synthesizeHumanAsk(
	task: ParsedTask,
	readiness: ReadinessResult
): string | undefined {
	const asks: string[] = [];

	// Authority/access issues first
	const authorityIssue = [...readiness.blockedDimensions, ...readiness.partialDimensions].find(
		(d) => d.dimension === "authority"
	);
	if (authorityIssue) {
		if (task.needsMattReview) {
			asks.push("Please confirm approval to proceed with this task.");
		}
		if (authorityIssue.blockerType === "access") {
			// Extract what access is needed from preconditions
			const accessPreconditions = (task.sections.preconditions ?? [])
				.filter((p) => !p.checked)
				.filter((p) => {
					const lower = p.text.toLowerCase();
					return (
						lower.includes("access") ||
						lower.includes("approval") ||
						lower.includes("confirm") ||
						lower.includes("billing") ||
						lower.includes("permission")
					);
				})
				.map((p) => p.text);
			if (accessPreconditions.length > 0) {
				asks.push(`Needed: ${accessPreconditions.join("; ")}.`);
			}
		}
		if (authorityIssue.blockerType === "risk") {
			asks.push(
				`This task involves sensitive operations. Please confirm it is safe to proceed.`
			);
		}
	}

	// Clarity issues
	const clarityIssue = [...readiness.blockedDimensions, ...readiness.partialDimensions].find(
		(d) => d.dimension === "clarity"
	);
	if (clarityIssue && asks.length === 0) {
		asks.push(
			`Please clarify the task: add a clear title, expected outcome, and either execution steps or a research question.`
		);
	}

	// Context issues — only if no higher-priority asks
	if (asks.length === 0) {
		const contextIssue = [...readiness.blockedDimensions, ...readiness.partialDimensions].find(
			(d) => d.dimension === "context"
		);
		if (contextIssue) {
			const unchecked = (task.sections.preconditions ?? [])
				.filter((p) => !p.checked)
				.map((p) => p.text);
			if (unchecked.length > 0) {
				asks.push(`Unresolved preconditions: ${unchecked.join("; ")}.`);
			} else {
				asks.push(contextIssue.reason);
			}
		}
	}

	return asks.length > 0 ? asks.join(" ") : undefined;
}

/**
 * Generate specific next-action text pulling real details from the task note.
 */
function generateNextAction(
	action: ActionType,
	task: ParsedTask,
	readiness: ReadinessResult
): string {
	switch (action) {
		case "EXE": {
			const steps = task.sections.executionSteps ?? [];
			const nextStep = steps.find((s) => !s.checked);
			if (nextStep) {
				return nextStep.text;
			}
			// Fall back to outcome
			if (task.sections.outcome) {
				return `Execute: ${task.sections.outcome.split("\n")[0].replace(/^[-*]\s*/, "").trim()}`;
			}
			return `Execute task: ${task.title}`;
		}
		case "ASK": {
			const ask = synthesizeHumanAsk(task, readiness);
			return ask ? `Ask Matt: ${ask}` : "Ask for clarification on task requirements.";
		}
		case "CTX": {
			// List specific missing context items
			const unchecked = (task.sections.preconditions ?? [])
				.filter((p) => !p.checked)
				.filter((p) => {
					// Only include preconditions the agent can self-serve
					const lower = p.text.toLowerCase();
					return !["approval", "confirm", "matt", "billing", "access", "permission"].some(
						(kw) => lower.includes(kw)
					);
				})
				.map((p) => p.text);
			if (unchecked.length > 0) {
				return `Gather context: ${unchecked.join("; ")}`;
			}
			return "Gather missing context from vault before proceeding.";
		}
		case "DEC": {
			// Try to cluster execution steps into groups
			const steps = task.sections.executionSteps ?? [];
			const unchecked = steps.filter((s) => !s.checked);
			if (unchecked.length > 4) {
				const firstBatch = unchecked.slice(0, 3).map((s) => s.text);
				return `Decompose "${task.title}" — start with first batch: ${firstBatch.join("; ")}. Create subtask notes for remaining ${unchecked.length - 3} steps.`;
			}
			return `Decompose "${task.title}" into smaller subtasks before execution.`;
		}
		case "WAIT": {
			const depIssues = [
				...readiness.blockedDimensions,
				...readiness.partialDimensions,
			].filter((d) => d.blockerType === "dependency" || d.blockerType === "time");
			if (depIssues.length > 0) {
				return `Wait: ${depIssues[0].reason}. Do not reprocess until wake condition is met.`;
			}
			return "Wait for blocking dependency to resolve. Do not reprocess.";
		}
		case "ESC": {
			const riskIssues = [
				...readiness.blockedDimensions,
				...readiness.partialDimensions,
			].filter((d) => d.blockerType === "risk" || d.blockerType === "capability");
			if (riskIssues.length > 0) {
				return `Escalate to Matt: ${riskIssues[0].reason}`;
			}
			if (task.needsMattReview) {
				return `Escalate to Matt: task requires review before execution (needs_matt_review: true).`;
			}
			return "Escalate for human approval before proceeding.";
		}
		case "DECL":
			return `Decline: Task cannot proceed — ${readiness.blockedDimensions.map((d) => d.reason).join("; ")}`;
	}
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

	// Step 0: Check for terminal state first
	const terminal = isTerminal(task);
	if (terminal) {
		return {
			action: "DECL",
			confidence: "high",
			reason: terminal.reason,
			nextAction: `No action needed — ${terminal.reason.toLowerCase()}`,
			blockerType: "policy",
			needsHuman: false,
			lastAssessed: now,
			terminal: true,
		};
	}

	// Step 1: Check policy overrides
	const policyOverride = checkPolicies(task, policies);
	if (policyOverride) {
		const needsHuman = detectHumanNeeded(task, readiness, policyOverride.action);
		return {
			action: policyOverride.action,
			confidence: "high",
			reason: `Policy override: ${policyOverride.reason}`,
			nextAction: generateNextAction(policyOverride.action, task, readiness),
			blockerType: determinePrimaryBlocker(readiness),
			needsHuman,
			lastAssessed: now,
			humanAsk: needsHuman ? synthesizeHumanAsk(task, readiness) : undefined,
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

	// Step 3: Map highest-priority blocker to action
	const primaryBlocker = determinePrimaryBlocker(readiness);
	const action = BLOCKER_TO_ACTION[primaryBlocker];
	const confidence = determineConfidence(readiness);
	const needsHuman = detectHumanNeeded(task, readiness, action);

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
		needsHuman,
		lastAssessed: now,
	};

	// Always include humanAsk when human is needed
	if (needsHuman) {
		record.humanAsk = synthesizeHumanAsk(task, readiness);
	}

	// Always include wakeCondition for WAIT
	if (action === "WAIT") {
		const depIssues = allIssues.filter(
			(d) => d.blockerType === "dependency" || d.blockerType === "time"
		);
		if (depIssues.length > 0) {
			record.wakeCondition = depIssues.map((d) => d.reason).join("; ");
		} else {
			record.wakeCondition = "Reassess when blocking condition changes.";
		}
	}

	// Smarter subtasks for DEC
	if (action === "DEC") {
		const steps = task.sections.executionSteps ?? [];
		const unchecked = steps.filter((s) => !s.checked);
		if (unchecked.length > 4) {
			// Cluster into groups of ~3
			const groups: string[] = [];
			for (let i = 0; i < unchecked.length; i += 3) {
				const batch = unchecked.slice(i, i + 3).map((s) => s.text);
				groups.push(`Subtask ${groups.length + 1}: ${batch.join(", ")}`);
			}
			record.subtasks = groups;
		} else {
			record.subtasks = [
				`Analyze scope of "${task.title}"`,
				"Identify atomic subtasks",
				"Create subtask notes",
				"Assess each subtask independently",
			];
		}
	}

	return record;
}
