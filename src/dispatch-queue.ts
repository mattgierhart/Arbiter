import type { ActionType, Priority, ReadinessColor } from "./types";

/**
 * v0.5.0 — pure logic for the Kanban "Up Next" dispatch queue.
 *
 * Lives outside `kanban-view.ts` (which has Obsidian DOM deps) so this
 * module is unit-testable. Three concerns: (1) collapse the 7-action
 * model into a 3-color visual, (2) decide which cards are dispatchable
 * right now, (3) sort dispatchable cards by priority + urgency.
 *
 * The kanban view (and any external dispatcher that wants the same logic)
 * imports these functions and feeds in tasks shaped like `QueueTask`.
 */

/**
 * Minimum fields a task needs to participate in the dispatch queue.
 * Both `ParsedTask` and `kanban-view.KanbanTask` are supersets of this.
 */
export interface QueueTask {
	arbiterAction?: ActionType;
	mattApproved?: boolean;
	priority?: Priority;
	taskRevision?: string;
	arbiterAssessedRevision?: string;
	arbiterLastAssessed?: string;
	urgencyDate?: string;
}

/**
 * OQ-014 mapping: 7 actions → 3 colors (+ grey for unassessed).
 *
 *   EXE, CTX → green   (agent-actionable: ready, or agent self-serves missing context)
 *   ASK, ESC → yellow  (human input needed)
 *   DEC, WAIT, DECL → red (not actionable: too broad / blocked / terminal)
 *
 * CTX = green is debatable; for v0.5.0 we accept it because the agent
 * can act unilaterally to gather context. Move to yellow in v0.6.0
 * if practice shows CTX leads to false-greens.
 */
export function actionToColor(
	action: ActionType | "UNASSESSED" | undefined,
): ReadinessColor {
	switch (action) {
		case "EXE":
		case "CTX":
			return "green";
		case "ASK":
		case "ESC":
			return "yellow";
		case "DEC":
		case "WAIT":
		case "DECL":
			return "red";
		case "UNASSESSED":
		case undefined:
			return "grey";
	}
}

/**
 * Priority sort weight — lower number sorts first.
 * Undefined priority defaults to normal (matches the absent-frontmatter case).
 */
export function priorityRank(p?: Priority): number {
	switch (p) {
		case "urgent":
			return 0;
		case "high":
			return 1;
		case "normal":
		case undefined:
			return 2;
		case "low":
			return 3;
	}
}

/**
 * SYNC-001 freshness: the cached assessment must match current task content.
 * If either revision is missing, the assessment is NOT fresh (either unassessed
 * or assessed without sync-protocol enabled).
 */
export function isAssessmentFresh(task: QueueTask): boolean {
	if (!task.arbiterAssessedRevision || !task.taskRevision) return false;
	return task.arbiterAssessedRevision === task.taskRevision;
}

/**
 * Predicate: should this card appear in "Up Next"?
 *
 * Strict gate per PRD §12.4:
 *   1. action maps to green (EXE-ish — currently only EXE, CTX strictly)
 *   2. mattApproved === true (positive opt-in to autonomous dispatch)
 *   3. assessment is fresh (SYNC-001 revision pin matches)
 *
 * We deliberately gate to EXE alone here (not CTX) for v0.5.0: "Up Next"
 * means "would dispatch right now," and a CTX outcome means "go gather
 * context, then re-assess." Don't list CTX cards as ready-to-run even
 * though they color-as-green — that's a future v0.6.0 decision.
 *
 * blocked_by chain validation is `/arbiter-read`'s job (it has access
 * to all cards across columns); the kanban view doesn't try to repeat it.
 */
export function isDispatchable(task: QueueTask): boolean {
	if (task.arbiterAction !== "EXE") return false;
	if (task.mattApproved !== true) return false;
	if (!isAssessmentFresh(task)) return false;
	return true;
}

/**
 * Sort dispatchable tasks: priority ascending (urgent first), then by
 * urgencyDate (earlier dates / overdue first), then by lastAssessed
 * (oldest first, so unattended tasks bubble up).
 *
 * Returns a new array — does not mutate the input.
 */
export function sortDispatchQueue<T extends QueueTask>(tasks: T[]): T[] {
	return [...tasks].sort((a, b) => {
		const ap = priorityRank(a.priority);
		const bp = priorityRank(b.priority);
		if (ap !== bp) return ap - bp;
		// Both have priority equal — break by urgency date (earlier first)
		if (a.urgencyDate && b.urgencyDate) {
			const cmp = a.urgencyDate.localeCompare(b.urgencyDate);
			if (cmp !== 0) return cmp;
		} else if (a.urgencyDate) {
			return -1; // dated tasks before undated
		} else if (b.urgencyDate) {
			return 1;
		}
		// Tiebreak: oldest assessment first (so neglected cards bubble up)
		if (a.arbiterLastAssessed && b.arbiterLastAssessed) {
			return a.arbiterLastAssessed.localeCompare(b.arbiterLastAssessed);
		}
		return 0;
	});
}

/**
 * One-shot: filter to dispatchable, then sort. Returns the dispatch queue.
 */
export function getDispatchQueue<T extends QueueTask>(tasks: T[]): T[] {
	return sortDispatchQueue(tasks.filter(isDispatchable));
}
