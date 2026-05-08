/** The 7 action types an agent can select */
export type ActionType = "EXE" | "ASK" | "CTX" | "DEC" | "WAIT" | "ESC" | "DECL";

/** Blocker types that map to readiness dimensions */
export type BlockerType =
	| "none"
	| "ambiguity"
	| "missing-context"
	| "scope"
	| "access"
	| "dependency"
	| "time"
	| "policy"
	| "capability"
	| "risk";

/** Readiness state for each dimension */
export type ReadinessState = "ready" | "partial" | "blocked";

/** Confidence level for action selection */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * v0.5.0 Component E: priority levels for dispatch queue ordering.
 * Set by Matt via the "Arbiter: Cycle priority" command. Affects sort order
 * of dispatchable cards in the Kanban "Up Next" strip — does NOT affect
 * Arbiter's assessment (a low-priority task with all dims ready still EXEs).
 */
export type Priority = "urgent" | "high" | "normal" | "low";

/**
 * v0.5.0 Component C: simplified visual state for the Kanban view.
 * The internal 7-action model is preserved; this is purely the color
 * collapse for human scanning. CTX is mapped to green for v0.5.0
 * (agent self-serves context); revisit if false-greens emerge. See OQ-014.
 */
export type ReadinessColor = "green" | "yellow" | "red" | "grey";

/** Task types from Pinch's existing format */
export type TaskType = "task-execution" | "task-research" | string;

/** Task status values */
export type TaskStatus = "active" | "waiting" | "completed" | "cancelled" | string;

/** A single readiness dimension assessment */
export interface ReadinessDimension {
	dimension: "clarity" | "context" | "scope" | "authority" | "dependencies" | "feasibility";
	state: ReadinessState;
	reason: string;
	blockerType?: BlockerType;
}

/** Full readiness assessment result */
export interface ReadinessResult {
	dimensions: ReadinessDimension[];
	allReady: boolean;
	anyBlocked: boolean;
	blockedDimensions: ReadinessDimension[];
	partialDimensions: ReadinessDimension[];
}

/** The action record that Arbiter produces */
export interface ActionRecord {
	action: ActionType;
	confidence: ConfidenceLevel;
	reason: string;
	nextAction: string;
	blockerType: BlockerType;
	needsHuman: boolean;
	lastAssessed: string;
	humanAsk?: string;
	wakeCondition?: string;
	subtasks?: string[];
	terminal?: boolean;
	/** DEC-012: decomposition depth of the task being assessed (for diagnostics) */
	decDepth?: number;
	/** DEC-012: set to true when the action was overridden from DEC → ESC because the depth cap was hit */
	decDepthCapHit?: boolean;
	/**
	 * SYNC-001: the task_revision value this assessment was computed against.
	 * Written to frontmatter as `arbiter_assessed_revision`. External readers
	 * (Claude, Codex, future agents) compare this to the current task_revision
	 * to detect torn cross-file snapshots from concurrent Pinch+human edits.
	 * See SYNC-PROTOCOL.md.
	 */
	assessedTaskRevision?: string;
}

/** DEC-012: hard cap on decomposition depth. Can be revised via policy / VD. */
export const MAX_DEC_DEPTH = 3;

/**
 * OQ-005: Hard-block readiness dimensions.
 *
 * Authority and Feasibility are the two dimensions where a non-ready state must
 * unconditionally block EXE — no amount of compensating ready elsewhere makes
 * up for "agent doesn't have permission" or "task is impossible." The other
 * four dimensions (Clarity, Context, Scope, Dependencies) are soft-block: a
 * partial state contributes to lower confidence but does not by itself prevent
 * EXE. This is what makes the EXE bar reachable in real-world tasks where a
 * couple of preconditions are unchecked but the agent has both authority and
 * capability to proceed.
 *
 * If either hard-block dim is blocked OR partial, the structural-executability
 * check fails and the action selector falls through to primary-blocker logic.
 *
 * See PRD.md §10 (v1.0 criterion 5) and open-questions.md OQ-005.
 */
export const HARD_BLOCK_DIMENSIONS: ReadinessDimension["dimension"][] = [
	"authority",
	"feasibility",
];

/**
 * OQ-007: numeric scores for confidence levels, used to compare against the
 * EXE threshold. Ordering matters more than the absolute values; gates are
 * satisfied when score >= threshold.
 */
export const CONFIDENCE_SCORE: Record<ConfidenceLevel, number> = {
	high: 1.0,
	medium: 0.6,
	low: 0.0,
};

/**
 * OQ-007: per-call configuration for the action selector's confidence gate.
 *
 * `defaultThreshold` is the EXE bar applied when no per-agent override matches.
 * 0.7 (the legacy default) means "high confidence required, medium not enough."
 * Lower values (e.g., 0.5) admit medium-confidence EXE.
 *
 * `perAgentThreshold` lets you tighten or loosen the bar by `task.owner`. The
 * intended use is: per-agent dispatch trust (e.g., Codex read-only → very high
 * threshold; Pinch local action → medium acceptable; Claude Code → high).
 */
export interface ConfidenceConfig {
	defaultThreshold: number;
	perAgentThreshold?: Record<string, number>;
}

/**
 * Blocker priority order: higher-priority blockers override lower ones.
 * Authority/access/risk issues should outrank missing-context because
 * human-gated tasks need ASK/ESC, not CTX.
 */
export const BLOCKER_PRIORITY: BlockerType[] = [
	"policy",       // highest — hard constraints
	"risk",         // safety/escalation
	"access",       // needs human to grant
	"capability",   // agent can't do it
	"dependency",   // waiting on external
	"time",         // temporal constraint
	"ambiguity",    // needs clarification
	"scope",        // too broad
	"missing-context", // lowest — agent can self-serve
	"none",
];

/** Parsed task from a note's frontmatter + body */
export interface ParsedTask {
	// Required fields
	title: string;
	type: TaskType;
	status: TaskStatus;
	owner: string;

	// Optional existing fields
	capabilityPrimary?: string;
	needsMattReview?: boolean;
	urgencyDate?: string;
	projectTag?: string[];

	// v0.5.0 user-controlled flags (Matt sets via toggle commands)
	/** OQ-015: positive opt-in for autonomous dispatch. Distinct from
	 * needsMattReview (which is a negative gate). Both can be true:
	 * the task was gated, Matt approved → dispatch. */
	mattApproved?: boolean;
	/** OQ-012: dispatch-queue sort order. Affects "Up Next" only. */
	priority?: Priority;

	// Arbiter-managed fields (may already exist from prior assessment)
	arbiterAction?: ActionType;
	arbiterConfidence?: ConfidenceLevel;
	arbiterBlockerType?: BlockerType;
	arbiterNeedsHuman?: boolean;
	arbiterLastAssessed?: string;
	arbiterWakeCondition?: string;
	arbiterAssess?: boolean;

	// Decomposition depth tracking (DEC-012)
	// arbiterDecDepth: how deep this task sits in a decomposition chain
	//   (0 = top-level task, 1 = first-gen subtask, 2 = second-gen, 3 = cap)
	// arbiterDecParent: file path of the parent task (if this is a subtask)
	arbiterDecDepth?: number;
	arbiterDecParent?: string;

	// SYNC-001: revision tracking for multi-actor read safety
	// taskRevision: deterministic hash of body (excluding ## Agent Assessment)
	//   + non-arbiter_* frontmatter keys, computed by the parser.
	//   Changes whenever Pinch or Matt edits the note's substantive content.
	// arbiterAssessedRevision: the value of taskRevision at the moment Arbiter
	//   last wrote an assessment to this note. Read from frontmatter.
	//   When the two differ, the cached arbiter_action is stale and must not
	//   be acted upon by external readers (Claude, Codex). See SYNC-PROTOCOL.md.
	taskRevision?: string;
	arbiterAssessedRevision?: string;

	// Raw content
	filePath: string;
	rawFrontmatter: Record<string, unknown>;
	bodyContent: string;

	// Parsed body sections
	sections: TaskSections;
}

/** Structured sections parsed from task note body */
export interface TaskSections {
	outcome?: string;
	preconditions?: PreconditionItem[];
	executionSteps?: PreconditionItem[];
	validation?: string;
	risks?: string;
	handoff?: string;
	askForMatt?: string;
	doneCriteria?: PreconditionItem[];
	researchQuestion?: string;
	scope?: string;
	agentAssessment?: string;
}

/** A checklist item from the task body */
export interface PreconditionItem {
	text: string;
	checked: boolean;
}

/** A policy rule that constrains action selection */
export interface PolicyRule {
	id: string;
	scope: "vault" | "folder" | "agent" | "task-type";
	appliesTo: string;
	rules: PolicyConstraint[];
}

/** A single constraint within a policy */
export interface PolicyConstraint {
	condition: string;
	action: ActionType;
	reason: string;
}

/** Plugin settings */
export interface ArbiterSettings {
	policyFolderPath: string;
	logFolderPath: string;
	taskDiscoveryFolders: string[];
	frontmatterPrefix: string;
	assessmentHeading: string;
	autoAssessOnChange: boolean;
	confidenceThreshold: number;
	enableMachineLog: boolean;
	/**
	 * SYNC-001: when true, Arbiter writes task_revision + arbiter_assessed_revision
	 * fields and external readers (other agents) gain access to the staleness check.
	 * Off by default for back-compat with single-user vaults; turn on when Claude/Codex
	 * or any second writer is touching the same vault. See SYNC-PROTOCOL.md.
	 */
	syncProtocolEnabled: boolean;
	/** SYNC-001: how long Kanban.md must be untouched before reads are trusted, ms. */
	boardDebounceMs: number;

	/**
	 * OQ-007: per-agent EXE confidence threshold overrides, keyed by `task.owner`.
	 * When set for an owner, that value is used in place of `confidenceThreshold`
	 * for tasks owned by that agent. Useful for tightening the bar on
	 * higher-stakes dispatches (e.g., Claude Code) while keeping it lower for
	 * trusted local runs (e.g., Pinch). Optional — when unset for an owner,
	 * `confidenceThreshold` applies.
	 *
	 * Example:
	 *   {
	 *     "claude": 0.95,   // only EXE on rock-solid high confidence
	 *     "pinch": 0.6,     // medium acceptable
	 *     "codex": 1.01,    // unreachable — codex never EXEs (read-only by policy)
	 *   }
	 */
	perAgentExeThreshold?: Record<string, number>;

	/**
	 * DISPATCH-HINTS-001 (optional): advisory limits Arbiter publishes for external
	 * agent orchestrators (Pinch, openclaw, HERMES, Symphony-style runners) to read.
	 *
	 * Arbiter does NOT enforce these — Arbiter is an assessor, not a runner. The hints
	 * are a stable surface so dispatch-side heuristics don't have to invent their own
	 * conventions per orchestrator. When unset, orchestrators apply their own defaults.
	 *
	 * Symphony §5.3.5 inspired the field shape, but the enforcement model is intentionally
	 * different: Symphony's runner enforces concurrency itself; Arbiter publishes hints for
	 * whatever runner consumes them.
	 */
	agentDispatchHints?: AgentDispatchHints;
}

/**
 * Optional hints Arbiter publishes for downstream agent orchestrators.
 * All fields optional — orchestrators apply their own defaults when unset.
 */
export interface AgentDispatchHints {
	/**
	 * Recommended cap on concurrent dispatched tasks per `capability_primary`
	 * tag (e.g. {"build": 2, "design": 1, "distribution": 1}).
	 * Maps to Matt's "two-products-max-per-5h" rule when keyed by capability.
	 */
	maxConcurrentPerCapability?: Record<string, number>;
	/**
	 * Recommended cap on concurrent dispatched tasks per source_repo / project_tag.
	 * Prevents one repo monopolizing the runner.
	 */
	maxConcurrentPerRepo?: number;
	/** Hard ceiling across all capabilities and repos. Orchestrator's last-resort throttle. */
	maxConcurrentTotal?: number;
}

export const DEFAULT_SETTINGS: ArbiterSettings = {
	policyFolderPath: ".agent-orchestrator/policies",
	logFolderPath: ".agent-orchestrator/logs",
	taskDiscoveryFolders: ["backlog/tasks"],
	frontmatterPrefix: "arbiter_",
	assessmentHeading: "## Agent Assessment",
	autoAssessOnChange: false,
	confidenceThreshold: 0.7,
	enableMachineLog: false,
	syncProtocolEnabled: false,
	boardDebounceMs: 60_000,
	// agentDispatchHints intentionally undefined by default — orchestrators apply their own.
};

/** Map from blocker type to recommended action */
export const BLOCKER_TO_ACTION: Record<BlockerType, ActionType> = {
	none: "EXE",
	ambiguity: "ASK",
	"missing-context": "CTX",
	scope: "DEC",
	access: "ASK",
	dependency: "WAIT",
	time: "WAIT",
	policy: "DECL",
	capability: "ESC",
	risk: "ESC",
};

/** Human-readable labels for action types */
export const ACTION_LABELS: Record<ActionType, string> = {
	EXE: "Execute",
	ASK: "Ask Clarifying Question",
	CTX: "Request Missing Context",
	DEC: "Decompose Task",
	WAIT: "Wait on Dependency",
	ESC: "Escalate for Approval",
	DECL: "Decline / Push Back",
};
