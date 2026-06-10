import type { EvidenceAtom, ParsedTask, ReadinessDimension, ReadinessResult, ReadinessState } from "./types";

/**
 * Assess the Clarity dimension: Is the task unambiguous?
 */
function assessClarity(task: ParsedTask): ReadinessDimension {
	const issues: string[] = [];
	const evidence: EvidenceAtom[] = [];

	if (!task.title || task.title === "Untitled") {
		issues.push("task has no title");
		evidence.push({ kind: "missing", ref: "frontmatter.title", polarity: "blocks" });
	} else {
		evidence.push({ kind: "frontmatter", ref: "frontmatter.title", polarity: "supports" });
	}

	const hasOutcome = !!task.sections.outcome;
	const hasResearchQuestion = !!task.sections.researchQuestion;
	if (!hasOutcome && !hasResearchQuestion) {
		issues.push("no outcome or research question defined");
		evidence.push({
			kind: "missing",
			ref: "missing: body §Outcome or §Research Question",
			polarity: "blocks",
		});
	} else {
		evidence.push({
			kind: "body-section",
			ref: hasOutcome ? "body §Outcome" : "body §Research Question",
			polarity: "supports",
		});
	}

	// Check if the outcome/research question is vague
	const target = task.sections.outcome ?? task.sections.researchQuestion ?? "";
	if (target.length > 0 && target.length < 10) {
		issues.push("outcome/research question is too brief to be actionable");
		evidence.push({
			kind: "body-section",
			ref: hasOutcome ? "body §Outcome" : "body §Research Question",
			note: `too brief (${target.length} chars)`,
			polarity: "blocks",
		});
	}

	if (issues.length === 0) {
		return {
			dimension: "clarity",
			state: "ready",
			reason: "Task is clearly defined with outcome.",
			evidence,
		};
	}
	if (issues.length === 1) {
		return {
			dimension: "clarity",
			state: "partial",
			reason: issues[0],
			blockerType: "ambiguity",
			evidence,
		};
	}
	return {
		dimension: "clarity",
		state: "blocked",
		reason: issues.join("; "),
		blockerType: "ambiguity",
		evidence,
	};
}

/**
 * Assess the Context dimension: Is all needed information available?
 */
function assessContext(task: ParsedTask): ReadinessDimension {
	const issues: string[] = [];
	const evidence: EvidenceAtom[] = [];

	// Check for unresolved wiki-links or references in the body
	const unresolvedLinks = task.bodyContent.match(/\[\[.*?\]\]/g) ?? [];
	// This is a heuristic — we can't actually check if vault files exist from pure text.
	// In the plugin, we'd check via the Obsidian API. For now, we note them.
	if (unresolvedLinks.length > 0) {
		evidence.push({
			kind: "link",
			ref: "body wiki-links",
			note: `${unresolvedLinks.length} referenced`,
			polarity: "neutral",
		});
	}

	// Check if preconditions exist but are unchecked
	// Separate human-gated preconditions from self-servable ones
	const humanKeywords = ["approval", "confirm", "matt", "review", "access", "billing", "permission", "tier"];
	let humanBlockedPreconditions: string[] = [];
	let agentBlockedPreconditions: string[] = [];

	if (task.sections.preconditions) {
		const unchecked = task.sections.preconditions.filter((p) => !p.checked);
		for (const p of unchecked) {
			const lower = p.text.toLowerCase();
			if (humanKeywords.some((kw) => lower.includes(kw))) {
				humanBlockedPreconditions.push(p.text);
			} else {
				agentBlockedPreconditions.push(p.text);
			}
		}
		if (unchecked.length > 0) {
			issues.push(
				`${unchecked.length} unchecked precondition(s): ${unchecked.map((p) => p.text).join(", ")}`
			);
			// Cap evidence atoms at 3 per dimension (PRD §13.10 noise risk).
			for (const p of unchecked.slice(0, 3)) {
				evidence.push({
					kind: "body-section",
					ref: "body §Preconditions",
					note: p.text,
					polarity: "blocks",
				});
			}
			if (unchecked.length > 3) {
				evidence.push({
					kind: "body-section",
					ref: "body §Preconditions",
					note: `+${unchecked.length - 3} more unchecked`,
					polarity: "blocks",
				});
			}
		} else if (task.sections.preconditions.length > 0) {
			evidence.push({
				kind: "body-section",
				ref: "body §Preconditions",
				note: "all checked",
				polarity: "supports",
			});
		}
	}

	// Check for empty required sections in research tasks
	if (task.type === "task-research") {
		if (!task.sections.scope) {
			issues.push("research task missing scope definition");
			evidence.push({
				kind: "missing",
				ref: "missing: body §Scope",
				note: "required for task-research",
				polarity: "blocks",
			});
		}
	}

	if (issues.length === 0) {
		// Ensure every ready dimension still has at least one atom showing
		// what was checked — "show your work" is the whole point of evidence.
		if (evidence.length === 0) {
			evidence.push({
				kind: "policy",
				ref: "policy:context-defaults",
				note: "no missing-context indicators",
				polarity: "supports",
			});
		}
		return {
			dimension: "context",
			state: "ready",
			reason: unresolvedLinks.length > 0
				? `Context appears available (${unresolvedLinks.length} linked notes referenced).`
				: "No missing context indicators found.",
			evidence,
		};
	}

	const isBlocked = task.sections.preconditions
		? task.sections.preconditions.filter((p) => !p.checked).length ===
		  task.sections.preconditions.length
		: false;

	// If the primary blockers are human-gated, use "access" blocker type
	// so the priority system routes to ASK instead of CTX
	const blockerType = humanBlockedPreconditions.length > 0 &&
		humanBlockedPreconditions.length >= agentBlockedPreconditions.length
		? "access" as const
		: "missing-context" as const;

	return {
		dimension: "context",
		state: isBlocked ? "blocked" : "partial",
		reason: issues.join("; "),
		blockerType,
		evidence,
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
	const uncheckedDone = doneCriteria.filter((d) => !d.checked).length;

	if (uncheckedSteps > 7) {
		return {
			dimension: "scope",
			state: "blocked",
			reason: `${uncheckedSteps} remaining execution steps — task may need decomposition.`,
			blockerType: "scope",
			evidence: [
				{
					kind: "body-section",
					ref: "body §Execution Steps",
					note: `${uncheckedSteps} unchecked (>7 → decompose)`,
					polarity: "blocks",
				},
			],
		};
	}

	if (uncheckedSteps > 4) {
		return {
			dimension: "scope",
			state: "partial",
			reason: `${uncheckedSteps} remaining execution steps — consider breaking into subtasks.`,
			blockerType: "scope",
			evidence: [
				{
					kind: "body-section",
					ref: "body §Execution Steps",
					note: `${uncheckedSteps} unchecked (>4 → consider DEC)`,
					polarity: "blocks",
				},
			],
		};
	}

	// Check done criteria complexity
	if (uncheckedDone > 5) {
		return {
			dimension: "scope",
			state: "partial",
			reason: `${uncheckedDone} unchecked done criteria — task may be broad.`,
			blockerType: "scope",
			evidence: [
				{
					kind: "body-section",
					ref: "body §Done Criteria",
					note: `${uncheckedDone} unchecked (>5)`,
					polarity: "blocks",
				},
			],
		};
	}

	const evidence: EvidenceAtom[] = [];
	if (steps.length > 0) {
		evidence.push({
			kind: "body-section",
			ref: "body §Execution Steps",
			note: `${uncheckedSteps}/${steps.length} unchecked`,
			polarity: "supports",
		});
	}
	if (doneCriteria.length > 0) {
		evidence.push({
			kind: "body-section",
			ref: "body §Done Criteria",
			note: `${uncheckedDone}/${doneCriteria.length} unchecked`,
			polarity: "supports",
		});
	}
	if (evidence.length === 0) {
		evidence.push({
			kind: "policy",
			ref: "policy:scope-defaults",
			note: "no decomposition triggers",
			polarity: "supports",
		});
	}
	return {
		dimension: "scope",
		state: "ready",
		reason: "Task scope is appropriate for execution.",
		evidence,
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
				evidence: [
					{
						kind: "frontmatter",
						ref: "frontmatter.needs_matt_review",
						note: "true; no approval markers in body",
						polarity: "blocks",
					},
				],
			};
		}
	}

	// Check for risk indicators — only in title and execution steps (not full body).
	// Research notes discuss these topics without meaning the agent should do them.
	const riskKeywords = [
		"delete",
		"remove",
		"drop",
		"billing",
		"payment",
		"production",
		"deploy",
	];
	const titleLower = task.title.toLowerCase();
	// Build action-context text from title + execution steps only
	const execStepText = (task.sections.executionSteps ?? [])
		.map((s) => s.text.toLowerCase())
		.join(" ");
	const actionContext = titleLower + " " + execStepText;

	const foundRisks = riskKeywords.filter((kw) => actionContext.includes(kw));
	if (foundRisks.length > 0) {
		return {
			dimension: "authority",
			state: "partial",
			reason: `Task involves potentially sensitive operations: ${foundRisks.join(", ")}. Consider escalation.`,
			blockerType: "risk",
			evidence: [
				{
					kind: "body-section",
					ref: "body §Execution Steps (or title)",
					note: `risk keywords: ${foundRisks.join(", ")}`,
					polarity: "blocks",
				},
			],
		};
	}

	const evidence: EvidenceAtom[] = task.needsMattReview
		? [
				{
					kind: "frontmatter",
					ref: "frontmatter.needs_matt_review",
					note: "approval markers found in body",
					polarity: "supports",
				},
		  ]
		: [
				{
					kind: "policy",
					ref: "policy:authority-defaults",
					note: "no human-gate requested",
					polarity: "supports",
				},
		  ];
	return {
		dimension: "authority",
		state: "ready",
		reason: "No authority constraints detected.",
		evidence,
	};
}

/**
 * Assess the Dependencies dimension: Are upstream tasks/events complete?
 */
function assessDependencies(task: ParsedTask): ReadinessDimension {
	const issues: string[] = [];
	const evidence: EvidenceAtom[] = [];

	// Check for temporal constraints
	// NOTE: A PAST urgency_date means overdue, not "wait." Overdue tasks need
	// attention, not parking. Only FUTURE dates with explicit "don't do until"
	// language should trigger WAIT.
	if (task.urgencyDate) {
		const urgency = new Date(task.urgencyDate);
		const now = new Date();
		if (urgency.getTime() > now.getTime()) {
			// Future date — check if there's an explicit "wait until" signal
			const bodyLower = task.bodyContent.toLowerCase();
			if (
				bodyLower.includes("don't do until") ||
				bodyLower.includes("do not start until") ||
				bodyLower.includes("wait until") ||
				bodyLower.includes("defer until")
			) {
				issues.push(`task deferred until ${task.urgencyDate}`);
				evidence.push({
					kind: "frontmatter",
					ref: "frontmatter.urgency_date",
					note: `future + 'wait until' language in body`,
					polarity: "blocks",
				});
			}
		}
		// Past dates are NOT a dependency — they indicate urgency, handled elsewhere
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
				evidence.push({
					kind: "body-section",
					ref: "body §Preconditions",
					note: blockingPrecondition.text,
					polarity: "blocks",
				});
			}
		}
	}

	// Check for existing arbiter wait condition
	if (task.arbiterAction === "WAIT" && task.arbiterWakeCondition) {
		issues.push(`previously waiting: ${task.arbiterWakeCondition}`);
		evidence.push({
			kind: "frontmatter",
			ref: "frontmatter.arbiter_wake_condition",
			note: task.arbiterWakeCondition,
			polarity: "blocks",
		});
	}

	if (issues.length === 0) {
		if (evidence.length === 0) {
			evidence.push({
				kind: "policy",
				ref: "policy:dependency-defaults",
				note: "no blocking dependencies",
				polarity: "supports",
			});
		}
		return {
			dimension: "dependencies",
			state: "ready",
			reason: "No blocking dependencies detected.",
			evidence,
		};
	}

	// Cap atoms at 3 for noise control (PRD §13.10).
	const cappedEvidence = evidence.slice(0, 3);
	if (evidence.length > 3) {
		cappedEvidence.push({
			kind: "body-section",
			ref: "body §Preconditions",
			note: `+${evidence.length - 3} more dependency indicators`,
			polarity: "blocks",
		});
	}

	return {
		dimension: "dependencies",
		state: issues.length > 1 ? "blocked" : "partial",
		reason: issues.join("; "),
		blockerType: "dependency",
		evidence: cappedEvidence,
	};
}

/**
 * Assess the Feasibility dimension: Can this actually be done?
 */
function assessFeasibility(task: ParsedTask): ReadinessDimension {
	// Check task status — recognize Pinch's `done`/`resolved` vocabulary alongside
	// Arbiter's original `completed`/`cancelled`. Case-insensitive.
	const normalizedStatus = String(task.status ?? "").trim().toLowerCase();
	if (normalizedStatus === "cancelled") {
		return {
			dimension: "feasibility",
			state: "blocked",
			reason: "Task is cancelled.",
			blockerType: "policy",
			evidence: [
				{
					kind: "frontmatter",
					ref: "frontmatter.status",
					note: "cancelled (terminal)",
					polarity: "blocks",
				},
			],
		};
	}
	if (normalizedStatus === "completed" || normalizedStatus === "done" || normalizedStatus === "resolved") {
		return {
			dimension: "feasibility",
			state: "blocked",
			reason: `Task is marked '${normalizedStatus}'.`,
			blockerType: "policy",
			evidence: [
				{
					kind: "frontmatter",
					ref: "frontmatter.status",
					note: `${normalizedStatus} (terminal)`,
					polarity: "blocks",
				},
			],
		};
	}

	// Check for risk/slip triggers that indicate infeasibility
	if (task.sections.risks) {
		const risksLower = task.sections.risks.toLowerCase();
		const matches = ["infeasible", "impossible", "cannot be done"].filter((kw) =>
			risksLower.includes(kw),
		);
		if (matches.length > 0) {
			return {
				dimension: "feasibility",
				state: "blocked",
				reason: "Task risks section indicates infeasibility.",
				blockerType: "capability",
				evidence: [
					{
						kind: "body-section",
						ref: "body §Risks",
						note: `matched: ${matches.join(", ")}`,
						polarity: "blocks",
					},
				],
			};
		}
	}

	return {
		dimension: "feasibility",
		state: "ready",
		reason: "Task appears feasible.",
		evidence: [
			{
				kind: "frontmatter",
				ref: "frontmatter.status",
				note: normalizedStatus || "active",
				polarity: "supports",
			},
		],
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
