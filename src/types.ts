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

	// Arbiter-managed fields (may already exist from prior assessment)
	arbiterAction?: ActionType;
	arbiterConfidence?: ConfidenceLevel;
	arbiterBlockerType?: BlockerType;
	arbiterNeedsHuman?: boolean;
	arbiterLastAssessed?: string;
	arbiterWakeCondition?: string;
	arbiterAssess?: boolean;

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
