import type { ParsedTask, ReadinessDimension, ReadinessResult, ReadinessState } from "./types";

/**
 * Assess the Clarity dimension: Is the task unambiguous?
 */
function assessClarity(task: ParsedTask): ReadinessDimension {
	const issues: string[] = [];

	if (!task.title || task.title === "Untitled") {
		issues.push("task has no title");
	}

	if (!task.sections.outcome && !task.sections.researchQuestion) {
		issues.push("no outcome or research question defined");
	}

	// Check if the outcome/research question is vague
	const target = task.sections.outcome ?? task.sections.researchQuestion ?? "";
	if (target.length < 10) {
		issues.push("outcome/research question is too brief to be actionable");
	}

	if (issues.length === 0) {
		return { dimension: "clarity", state: "ready", reason: "Task is clearly defined with outcome." };
	}
	if (issues.length === 1) {
		return {
			dimension: "clarity",
			state: "partial",
			reason: issues[0],
			blockerType: "ambiguity",
		};
	}
	return {
		dimension: "clarity",
		state: "blocked",
		reason: issues.join("; "),
		blockerType: "ambiguity",
	};
}

/**
 * Assess the Context dimension: Is all needed information available?
 */
function assessContext(task: ParsedTask): ReadinessDimension {
	const issues: string[] = [];

	// Check for unresolved wiki-links or references in the body
	const unresolvedLinks = task.bodyContent.match(/\[\[.*?\]\]/g) ?? [];
	// This is a heuristic — we can't actually check if vault files exist from pure text.
	// In the plugin, we'd check via the Obsidian API. For now, we note them.

	// Check if preconditions exist but are unchecked
	if (task.sections.preconditions) {
		const unchecked = task.sections.preconditions.filter((p) => !p.checked);
		if (unchecked.length > 0) {
			issues.push(
				`${unchecked.length} unchecked precondition(s): ${unchecked.map((p) => p.text).join(", ")}`
			);
		}
	}

	// Check for empty required sections in research tasks
	if (task.type === "task-research") {
		if (!task.sections.scope) {
			issues.push("research task missing scope definition");
		}
	}

	if (issues.length === 0) {
		return {
			dimension: "context",
			state: "ready",
			reason: unresolvedLinks.length > 0
				? `Context appears available (${unresolvedLinks.length} linked notes referenced).`
				: "No missing context indicators found.",
		};
	}

	const isBlocked = task.sections.preconditions
		? task.sections.preconditions.filter((p) => !p.checked).length ===
		  task.sections.preconditions.length
		: false;

	return {
		dimension: "context",
		state: isBlocked ? "blocked" : "partial",
		reason: issues.join("; "),
		blockerType: "missing-context",
	};
}

/**
 * Assess the Scope dimension: Is the task atomic enough to execute?
 */
function assessScope(task: ParsedTask): ReadinessDimension {
	// Check for decomposition indicators
	const steps = task.sections.executionSteps ?? [];
	const doneCriteria = task.sections.doneCriteria ?? [];

	// If there are many unchecked execution steps, scope may be too broad
	const uncheckedSteps = steps.filter((s) => !s.checked).length;

	if (uncheckedSteps > 7) {
		return {
			dimension: "scope",
			state: "blocked",
			reason: `${uncheckedSteps} remaining execution steps — task may need decomposition.`,
			blockerType: "scope",
		};
	}

	if (uncheckedSteps > 4) {
		return {
			dimension: "scope",
			state: "partial",
			reason: `${uncheckedSteps} remaining execution steps — consider breaking into subtasks.`,
			blockerType: "scope",
		};
	}

	// Check done criteria complexity
	const uncheckedDone = doneCriteria.filter((d) => !d.checked).length;
	if (uncheckedDone > 5) {
		return {
			dimension: "scope",
			state: "partial",
			reason: `${uncheckedDone} unchecked done criteria — task may be broad.`,
			blockerType: "scope",
		};
	}

	return {
		dimension: "scope",
		state: "ready",
		reason: "Task scope is appropriate for execution.",
	};
}

/**
 * Assess the Authority dimension: Does the agent have permission?
 */
function assessAuthority(task: ParsedTask): ReadinessDimension {
	// Check if task requires human review
	if (task.needsMattReview) {
		// Check if there's evidence Matt has reviewed (this is heuristic)
		const bodyLower = task.bodyContent.toLowerCase();
		const hasApproval =
			bodyLower.includes("approved") ||
			bodyLower.includes("matt reviewed") ||
			bodyLower.includes("✅");

		if (!hasApproval) {
			return {
				dimension: "authority",
				state: "blocked",
				reason: "Task requires Matt's review (needs_matt_review: true) — no approval evidence found.",
				blockerType: "access",
			};
		}
	}

	// Check for risk indicators in the task
	const riskKeywords = [
		"delete",
		"remove",
		"drop",
		"billing",
		"payment",
		"production",
		"deploy",
		"publish",
	];
	const bodyLower = task.bodyContent.toLowerCase();
	const titleLower = task.title.toLowerCase();
	const combined = bodyLower + " " + titleLower;

	const foundRisks = riskKeywords.filter((kw) => combined.includes(kw));
	if (foundRisks.length > 0) {
		return {
			dimension: "authority",
			state: "partial",
			reason: `Task involves potentially sensitive operations: ${foundRisks.join(", ")}. Consider escalation.`,
			blockerType: "risk",
		};
	}

	return {
		dimension: "authority",
		state: "ready",
		reason: "No authority constraints detected.",
	};
}

/**
 * Assess the Dependencies dimension: Are upstream tasks/events complete?
 */
function assessDependencies(task: ParsedTask): ReadinessDimension {
	const issues: string[] = [];

	// Check for temporal constraints
	if (task.urgencyDate) {
		const urgency = new Date(task.urgencyDate);
		const now = new Date();
		if (urgency.getTime() < now.getTime()) {
			issues.push(`urgency date ${task.urgencyDate} has passed`);
		}
	}

	// Check for wait/dependency indicators in body
	const waitIndicators = [
		"waiting on",
		"blocked by",
		"depends on",
		"after",
		"once",
		"when",
	];
	const bodyLower = task.bodyContent.toLowerCase();
	for (const indicator of waitIndicators) {
		// Look for these in context that suggests actual blocking
		const pattern = new RegExp(`(?:^|\\n)[-*]\\s.*${indicator}\\s`, "i");
		if (pattern.test(task.bodyContent)) {
			// Check if it's in a precondition that's unchecked
			const preconditions = task.sections.preconditions ?? [];
			const blockingPrecondition = preconditions.find(
				(p) => !p.checked && p.text.toLowerCase().includes(indicator)
			);
			if (blockingPrecondition) {
				issues.push(`unchecked dependency: "${blockingPrecondition.text}"`);
			}
		}
	}

	// Check for existing arbiter wait condition
	if (task.arbiterAction === "WAIT" && task.arbiterWakeCondition) {
		issues.push(`previously waiting: ${task.arbiterWakeCondition}`);
	}

	if (issues.length === 0) {
		return {
			dimension: "dependencies",
			state: "ready",
			reason: "No blocking dependencies detected.",
		};
	}

	return {
		dimension: "dependencies",
		state: issues.length > 1 ? "blocked" : "partial",
		reason: issues.join("; "),
		blockerType: "dependency",
	};
}

/**
 * Assess the Feasibility dimension: Can this actually be done?
 */
function assessFeasibility(task: ParsedTask): ReadinessDimension {
	// Check task status
	if (task.status === "cancelled") {
		return {
			dimension: "feasibility",
			state: "blocked",
			reason: "Task is cancelled.",
			blockerType: "policy",
		};
	}

	if (task.status === "completed") {
		return {
			dimension: "feasibility",
			state: "blocked",
			reason: "Task is already completed.",
			blockerType: "policy",
		};
	}

	// Check for risk/slip triggers that indicate infeasibility
	if (task.sections.risks) {
		const risksLower = task.sections.risks.toLowerCase();
		if (
			risksLower.includes("infeasible") ||
			risksLower.includes("impossible") ||
			risksLower.includes("cannot be done")
		) {
			return {
				dimension: "feasibility",
				state: "blocked",
				reason: "Task risks section indicates infeasibility.",
				blockerType: "capability",
			};
		}
	}

	return {
		dimension: "feasibility",
		state: "ready",
		reason: "Task appears feasible.",
	};
}

/**
 * Run the full 6-dimension readiness assessment on a parsed task.
 */
export function assessReadiness(task: ParsedTask): ReadinessResult {
	const dimensions: ReadinessDimension[] = [
		assessClarity(task),
		assessContext(task),
		assessScope(task),
		assessAuthority(task),
		assessDependencies(task),
		assessFeasibility(task),
	];

	const blockedDimensions = dimensions.filter((d) => d.state === "blocked");
	const partialDimensions = dimensions.filter((d) => d.state === "partial");

	return {
		dimensions,
		allReady: blockedDimensions.length === 0 && partialDimensions.length === 0,
		anyBlocked: blockedDimensions.length > 0,
		blockedDimensions,
		partialDimensions,
	};
}
