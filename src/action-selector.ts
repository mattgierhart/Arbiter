import type {
	ActionRecord,
	ActionType,
	BlockerType,
	ConfidenceConfig,
	ConfidenceLevel,
	ParsedTask,
	PolicyRule,
	ReadinessDimension,
	ReadinessResult,
} from "./types";
import {
	BLOCKER_TO_ACTION,
	BLOCKER_PRIORITY,
	CONFIDENCE_SCORE,
	HARD_BLOCK_DIMENSIONS,
	MAX_DEC_DEPTH,
} from "./types";

/** Default EXE confidence threshold when no config is provided. Matches legacy `confidenceThreshold` default. */
const DEFAULT_EXE_THRESHOLD = 0.7;

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

/**
 * DEC-014 + OQ-005: three-state confidence rollup from dimension states.
 *
 *   - any dim blocked → low (forces non-EXE)
 *   - any HARD-BLOCK dim non-ready (blocked OR partial) → low
 *     (Authority/Feasibility partial means risk or capability concern that
 *      should not be papered over with confidence)
 *   - all dims ready → high
 *   - hard-blocks ready, soft-blocks partial → medium
 *   - all dims partial, nothing ready → low
 *
 * This is the Lighthouse Definition-of-Ready rollup with the OQ-005 hard-block
 * refinement. Per DEC-013, agents must be able to push back on low confidence.
 * The EXE confidence gate (`passesConfidenceGate`) interprets the level via
 * CONFIDENCE_SCORE and the per-agent threshold.
 */
function determineConfidence(readiness: ReadinessResult): ConfidenceLevel {
	if (readiness.anyBlocked) return "low";
	// OQ-005: any hard-block dim that isn't fully ready drops confidence to low,
	// even if no dim is "blocked" outright. Authority/Feasibility partial means
	// the EXE bar can't be reached structurally regardless of soft-block scores.
	for (const hardDim of HARD_BLOCK_DIMENSIONS) {
		const dim = readiness.dimensions.find((d) => d.dimension === hardDim);
		if (dim && dim.state !== "ready") return "low";
	}
	if (readiness.allReady) return "high";
	const readyCount = readiness.dimensions.filter((d) => d.state === "ready").length;
	if (readyCount === 0) return "low"; // all partial, no ready
	return "medium"; // hard-blocks ready, mix of soft ready + partial
}

/**
 * OQ-005: structural executability check.
 *
 * Returns true iff hard-block dimensions are fully READY AND no dim is BLOCKED.
 * Soft-block dimensions may be partial without disqualifying EXE. The
 * confidence gate (OQ-007) decides whether the resulting confidence level
 * clears the per-agent threshold.
 *
 * This replaces the older "all 6 dims must be ready" rule, which made EXE
 * unreachable in practice for most real-world tasks (a single unchecked
 * precondition or extra execution step would block).
 */
function isStructurallyExecutable(readiness: ReadinessResult): boolean {
	if (readiness.anyBlocked) return false;
	for (const hardDim of HARD_BLOCK_DIMENSIONS) {
		const dim = readiness.dimensions.find((d) => d.dimension === hardDim);
		if (!dim || dim.state !== "ready") return false;
	}
	return true;
}

/**
 * OQ-007: resolve the effective EXE threshold for this task.
 * Per-agent override wins, then config default, then DEFAULT_EXE_THRESHOLD.
 */
function getEffectiveExeThreshold(task: ParsedTask, config?: ConfidenceConfig): number {
	if (!config) return DEFAULT_EXE_THRESHOLD;
	const perAgent = config.perAgentThreshold?.[task.owner];
	if (typeof perAgent === "number" && Number.isFinite(perAgent)) return perAgent;
	if (typeof config.defaultThreshold === "number" && Number.isFinite(config.defaultThreshold)) {
		return config.defaultThreshold;
	}
	return DEFAULT_EXE_THRESHOLD;
}

/**
 * OQ-007: confidence gate. EXE is admitted only when the score for this
 * confidence level meets the effective threshold for this task's owner.
 */
function passesConfidenceGate(
	confidence: ConfidenceLevel,
	task: ParsedTask,
	config?: ConfidenceConfig,
): boolean {
	const score = CONFIDENCE_SCORE[confidence];
	const threshold = getEffectiveExeThreshold(task, config);
	return score >= threshold;
}

/**
 * Determine the primary blocker using state-first, then type priority.
 *
 * Bug fix (2026-04-12): Previously sorted by blocker TYPE index first,
 * then used state as a tiebreaker. This meant a partial-scope (type 7)
 * beat a blocked-context (type 8), producing DEC when CTX was correct.
 *
 * New sort order:
 *   1. All BLOCKED dimensions first (these are hard stops).
 *   2. All PARTIAL dimensions second (these are soft signals).
 *   3. Within each state group, sort by blocker TYPE priority
 *      (policy > risk > access > ... > missing-context).
 *
 * This ensures that a blocked dimension always wins over a partial one,
 * and type priority only arbitrates within dimensions at the same state.
 */
function determinePrimaryBlocker(readiness: ReadinessResult): BlockerType {
	const allIssues: ReadinessDimension[] = [
		...readiness.blockedDimensions,
		...readiness.partialDimensions,
	];

	if (allIssues.length === 0) return "none";

	const sorted = allIssues
		.filter((d) => d.blockerType && d.blockerType !== "none")
		.sort((a, b) => {
			// State-first: blocked before partial
			if (a.state === "blocked" && b.state !== "blocked") return -1;
			if (b.state === "blocked" && a.state !== "blocked") return 1;
			// Within same state: type priority (lower index = higher priority)
			const aPri = BLOCKER_PRIORITY.indexOf(a.blockerType ?? "none");
			const bPri = BLOCKER_PRIORITY.indexOf(b.blockerType ?? "none");
			return aPri - bPri;
		});

	return sorted.length > 0 ? (sorted[0].blockerType ?? "none") : "none";
}

/**
 * Statuses that indicate a task is finished and Arbiter should not advance it.
 * Pinch's vault uses `done` and `resolved` in real cards; Arbiter's earlier
 * vocabulary was `completed` / `cancelled`. Recognize all four. Comparison is
 * case-insensitive so frontmatter casing variations don't cause false EXEs on
 * already-finished work.
 */
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "done", "resolved"]);

/**
 * Check if a task is in a terminal state.
 * Returns the reason if terminal, null otherwise.
 */
function isTerminal(task: ParsedTask): { terminal: true; reason: string } | null {
	const normalized = String(task.status ?? "").trim().toLowerCase();
	if (TERMINAL_STATUSES.has(normalized)) {
		const label = normalized === "cancelled" ? "cancelled" : `marked '${normalized}'`;
		return { terminal: true, reason: `Task is ${label}.` };
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
 * Synthesize a precise, minimal human ask from readiness issues, hand-off section,
 * and preconditions. Produces a single actionable sentence where possible.
 */
function synthesizeHumanAsk(
	task: ParsedTask,
	readiness: ReadinessResult
): string | undefined {
	const allIssues = [...readiness.blockedDimensions, ...readiness.partialDimensions];

	// Mine the Hand-off and Ask for Matt sections
	const handoffAction = extractHandoffAsk(task);
	const askForMatt = extractAskForMatt(task);

	// Mine unchecked human-gated preconditions
	const humanPreconditions = (task.sections.preconditions ?? [])
		.filter((p) => !p.checked)
		.filter((p) => {
			const lower = p.text.toLowerCase();
			return ["approval", "confirm", "matt", "review", "access", "billing", "permission"].some(
				(kw) => lower.includes(kw)
			);
		})
		.map((p) => p.text);

	const authorityIssue = allIssues.find((d) => d.dimension === "authority");

	// Build the ask — prioritize: Ask for Matt > Hand-off > preconditions
	// "Ask for Matt" is the most explicit human-authored ask
	if (askForMatt) {
		const afterAsk = getAgentFollowUp(task);
		if (afterAsk) {
			return `${askForMatt} If confirmed, I'll ${afterAsk}.`;
		}
		return askForMatt;
	}

	if (handoffAction && task.needsMattReview) {
		const afterAsk = getAgentFollowUp(task);
		if (afterAsk) {
			return `${handoffAction} If confirmed, I'll ${afterAsk}.`;
		}
		return handoffAction;
	}

	if (task.needsMattReview) {
		const afterAsk = getAgentFollowUp(task);
		if (humanPreconditions.length > 0) {
			const needed = humanPreconditions.join("; ");
			if (afterAsk) {
				return `Please confirm approval (needed: ${needed}). If yes, I'll ${afterAsk}.`;
			}
			return `Please confirm approval. Needed: ${needed}.`;
		}
		if (afterAsk) {
			return `Please confirm approval to proceed. If yes, I'll ${afterAsk}.`;
		}
		return "Please confirm approval to proceed with this task.";
	}

	if (authorityIssue?.blockerType === "access") {
		if (humanPreconditions.length > 0) {
			return `Needed from Matt: ${humanPreconditions.join("; ")}.`;
		}
		return "Access or permission is required to proceed. Please provide or confirm.";
	}

	if (authorityIssue?.blockerType === "risk") {
		return "This task involves sensitive operations. Please confirm it is safe to proceed.";
	}

	// Clarity issues
	const clarityIssue = allIssues.find((d) => d.dimension === "clarity");
	if (clarityIssue) {
		return "Please clarify the task: add a clear title, expected outcome, and either execution steps or a research question.";
	}

	// Context issues — lowest priority
	const contextIssue = allIssues.find((d) => d.dimension === "context");
	if (contextIssue) {
		const unchecked = (task.sections.preconditions ?? [])
			.filter((p) => !p.checked)
			.map((p) => p.text);
		if (unchecked.length > 0) {
			return `Unresolved preconditions: ${unchecked.join("; ")}.`;
		}
		return contextIssue.reason;
	}

	return undefined;
}

/**
 * Extract the human ask from the ## Hand-off section.
 * Prefers nested/indented action lines over scaffolding/question lines.
 */
function extractHandoffAsk(task: ParsedTask): string | undefined {
	if (!task.sections.handoff) return undefined;

	const lines = task.sections.handoff.split("\n");

	// Skip scaffolding patterns
	const isScaffolding = (s: string): boolean => {
		const lower = s.toLowerCase();
		return (
			lower.includes("what exactly should") ||
			lower.includes("what should") ||
			lower.includes("if matt executes next") ||
			lower.includes("if matt does next") ||
			lower.includes("if matt handles next") ||
			lower.endsWith("?") ||
			s.startsWith("#")
		);
	};

	// First pass: look for nested/indented bullet lines (the actual actionable items)
	for (const line of lines) {
		// Indented bullets (2+ spaces or tab before - or *)
		const nestedMatch = line.match(/^[\t ]{2,}[-*]\s+(.+)/);
		if (nestedMatch) {
			const action = nestedMatch[1].trim();
			if (action.length > 5 && !isScaffolding(action)) {
				return `Please ${action.charAt(0).toLowerCase()}${action.slice(1)}${action.endsWith(".") ? "" : "."}`;
			}
		}
	}

	// Second pass: look for any non-scaffolding, non-question line
	for (const line of lines) {
		const trimmed = line.replace(/^[\t ]*[-*]\s*/, "").trim();
		if (trimmed.length > 10 && !isScaffolding(trimmed)) {
			return trimmed.endsWith(".") ? trimmed : trimmed + ".";
		}
	}

	// Third pass: handle "If Matt executes next, do X" where the action is on the same line
	for (const line of lines) {
		const trimmed = line.replace(/^[\t ]*[-*]\s*/, "").trim();
		const mattMatch = trimmed.match(/if matt (?:executes|does|handles) next[,:]?\s*(.+)/i);
		if (mattMatch) {
			const action = mattMatch[1].trim();
			if (!action.endsWith("?") && action.length > 5) {
				return `Please ${action.charAt(0).toLowerCase()}${action.slice(1)}${action.endsWith(".") ? "" : "."}`;
			}
		}
	}

	return undefined;
}

/**
 * Extract explicit asks from the ## Ask for Matt section.
 * These are human-authored asks that should take highest priority.
 */
function extractAskForMatt(task: ParsedTask): string | undefined {
	if (!task.sections.askForMatt) return undefined;

	const lines = task.sections.askForMatt.split("\n");
	for (const line of lines) {
		// Look for checklist items (unchecked asks)
		const checkMatch = line.match(/^[-*]\s+\[([ ])\]\s+(.+)/);
		if (checkMatch) {
			const text = checkMatch[2].trim();
			if (text.length > 5) {
				// Clean up label prefixes like "Decision needed:" or "Approval needed:"
				const cleaned = text.replace(/^(decision|approval)\s+needed:\s*/i, "").trim();
				if (cleaned.length > 5) {
					return cleaned.endsWith(".") ? cleaned : cleaned + ".";
				}
			}
		}
		// Also look for plain bullet items
		const bulletMatch = line.match(/^[-*]\s+(.+)/);
		if (bulletMatch && !line.includes("[ ]") && !line.includes("[x]")) {
			const text = bulletMatch[1].trim();
			const cleaned = text.replace(/^(decision|approval)\s+needed:\s*/i, "").trim();
			if (cleaned.length > 10) {
				return cleaned.endsWith(".") ? cleaned : cleaned + ".";
			}
		}
	}

	return undefined;
}

/**
 * Get what the agent will do after the human unblocks — for contextual asks.
 */
function getAgentFollowUp(task: ParsedTask): string | undefined {
	// First unchecked non-human-gated execution step
	const steps = task.sections.executionSteps ?? [];
	const agentSteps = steps
		.filter((s) => !s.checked)
		.filter((s) => {
			const lower = s.text.toLowerCase();
			return !["approval", "billing", "matt", "permission"].some((kw) => lower.includes(kw));
		});

	if (agentSteps.length > 0) {
		const first = agentSteps[0].text;
		return first.charAt(0).toLowerCase() + first.slice(1);
	}

	// Fall back to outcome
	if (task.sections.outcome) {
		const firstLine = task.sections.outcome.split("\n")[0].replace(/^[-*]\s*/, "").trim();
		if (firstLine.length > 10) {
			return firstLine.charAt(0).toLowerCase() + firstLine.slice(1);
		}
	}

	return undefined;
}

/**
 * Format the reason field with primary + secondary blocker structure.
 */
function formatReason(readiness: ReadinessResult): string {
	const allIssues = [
		...readiness.blockedDimensions,
		...readiness.partialDimensions,
	];

	if (allIssues.length === 0) return "All readiness dimensions are satisfied.";

	// Sort by priority
	const sorted = [...allIssues].sort((a, b) => {
		const aPri = BLOCKER_PRIORITY.indexOf(a.blockerType ?? "none");
		const bPri = BLOCKER_PRIORITY.indexOf(b.blockerType ?? "none");
		if (aPri !== bPri) return aPri - bPri;
		if (a.state === "blocked" && b.state !== "blocked") return -1;
		if (b.state === "blocked" && a.state !== "blocked") return 1;
		return 0;
	});

	const primary = sorted[0];
	const secondary = sorted.slice(1);

	const primaryText = primary.reason.replace(/\.+$/, "");
	let reason = `Primary: ${primary.dimension} — ${primaryText}.`;
	if (secondary.length > 0) {
		// Limit to top 2 secondary reasons to reduce noise
		const topSecondary = secondary.slice(0, 2);
		const secondaryText = topSecondary
			.map((d) => `${d.dimension}: ${d.reason.replace(/\.+$/, "")}`)
			.join("; ");
		reason += ` Also: ${secondaryText}.`;
	}

	return reason;
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
 *
 * OQ-005 / OQ-007: pass `confidenceConfig` to apply the hard-block executability
 * model and per-agent EXE thresholds. When omitted, falls back to the legacy
 * default threshold (0.7) — high confidence required.
 */
export function selectAction(
	task: ParsedTask,
	readiness: ReadinessResult,
	policies: PolicyRule[] = [],
	confidenceConfig?: ConfidenceConfig,
): ActionRecord {
	const now = new Date().toISOString();
	// SYNC-001: pin the revision this assessment is computed against. Every
	// ActionRecord returned below carries this so action-recorder can write
	// `arbiter_assessed_revision` to the task note for external readers.
	const assessedTaskRevision = task.taskRevision;

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
			assessedTaskRevision,
		};
	}

	// Step 0.5: DEC-012 depth cap check — runs BEFORE policies and readiness
	// so that a task at max depth gets the learning-loop escalation regardless
	// of what the risk scanner or policy engine would otherwise select.
	const currentDepth = task.arbiterDecDepth ?? 0;
	if (currentDepth >= MAX_DEC_DEPTH) {
		const readiness_check = readiness; // for context in the message
		const steps = task.sections.executionSteps ?? [];
		const unchecked = steps.filter((s) => !s.checked);
		return {
			action: "ESC",
			confidence: "medium",
			reason: `DEC-012 depth cap hit: task is at decomposition depth ${currentDepth} (cap: ${MAX_DEC_DEPTH}). Cannot decompose further without escalation.`,
			nextAction:
				`Escalate to Matt: max decomposition depth ${MAX_DEC_DEPTH} reached on "${task.title}" ` +
				`(current depth ${currentDepth}). ${unchecked.length} unchecked steps remain. ` +
				`Matt: is the depth cap still appropriate here, or should we raise it for this scenario? ` +
				`Your feedback calibrates the decomposition model.`,
			blockerType: "policy",
			needsHuman: true,
			lastAssessed: now,
			humanAsk:
				`Decomposition depth cap hit on "${task.title}" at depth ${currentDepth} ` +
				`(cap is ${MAX_DEC_DEPTH} per DEC-012). ${unchecked.length} unchecked execution steps remain ` +
				`but the task cannot be decomposed further. ` +
				`Two questions: (1) should I raise the depth cap for this specific task? ` +
				`(2) is the ${MAX_DEC_DEPTH}-cap the right default rule, or does this scenario suggest a different rule? ` +
				`Your answer helps me learn.`,
			decDepth: currentDepth,
			decDepthCapHit: true,
			assessedTaskRevision,
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
			assessedTaskRevision,
		};
	}

	// Step 2: OQ-005 + OQ-007 — EXE gated by structural executability AND confidence threshold.
	// Hard-block dims (Authority, Feasibility) must be ready and no dim must be blocked.
	// The resulting confidence must meet the per-agent threshold (or default 0.7).
	const confidence = determineConfidence(readiness);

	if (isStructurallyExecutable(readiness) && passesConfidenceGate(confidence, task, confidenceConfig)) {
		const partial = readiness.partialDimensions;
		const reason =
			partial.length === 0
				? "All readiness dimensions are satisfied."
				: `Hard-block dimensions ready; ${partial.length} soft-dim(s) partial — proceeding with ${confidence} confidence (threshold: ${getEffectiveExeThreshold(task, confidenceConfig)}).`;
		return {
			action: "EXE",
			confidence,
			reason,
			nextAction: generateNextAction("EXE", task, readiness),
			blockerType: "none",
			needsHuman: false,
			lastAssessed: now,
			assessedTaskRevision,
		};
	}

	// Step 3: EXE not admitted — map highest-priority blocker to action.
	// `confidence` from above is reused; primaryBlocker covers both blocked and partial dims.
	const primaryBlocker = determinePrimaryBlocker(readiness);

	// Edge case: structurally executable but confidence below threshold AND no
	// dimension flagged a blocker (i.e., readiness is all-ready but the threshold
	// is unreachably high). primaryBlocker is "none" which would otherwise map
	// back to EXE — that contradicts the gate. Force ASK with a confidence-
	// threshold reason so the operator sees what's actually blocking dispatch.
	if (primaryBlocker === "none" && isStructurallyExecutable(readiness)) {
		const threshold = getEffectiveExeThreshold(task, confidenceConfig);
		return {
			action: "ASK",
			confidence,
			reason: `Confidence ${confidence} (score ${CONFIDENCE_SCORE[confidence]}) below EXE threshold ${threshold} for owner '${task.owner}'.`,
			nextAction: `Confidence threshold not met for '${task.owner}'. Either raise confidence by addressing partial dimensions, lower the threshold for this agent, or approve manually.`,
			blockerType: "policy",
			needsHuman: true,
			lastAssessed: now,
			humanAsk: `Confidence (${confidence}) below threshold (${threshold}) for owner '${task.owner}'. Approve manually or adjust the threshold in Arbiter settings.`,
			assessedTaskRevision,
		};
	}

	const action = BLOCKER_TO_ACTION[primaryBlocker];
	const needsHuman = detectHumanNeeded(task, readiness, action);

	const allIssues = [
		...readiness.blockedDimensions,
		...readiness.partialDimensions,
	];
	const reason = formatReason(readiness);

	const record: ActionRecord = {
		action,
		confidence,
		reason,
		nextAction: generateNextAction(action, task, readiness),
		blockerType: primaryBlocker,
		needsHuman,
		lastAssessed: now,
		assessedTaskRevision,
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
