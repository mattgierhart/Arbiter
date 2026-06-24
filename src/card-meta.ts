import type { TaskSections } from "./types";

/**
 * v0.7.0 (prototype) — pure derivation helpers for the Kanban card surface.
 *
 * Trietment-inspired polish borrowed onto Arbiter's *decision-state* board:
 *   1. Subtask progress badge (☑ done/total) — from the checklists Arbiter
 *      already parses but never surfaced on cards.
 *   2. Time-urgency state (overdue / today / soon / future) — Trietment's
 *      red=overdue / orange=today, driven by the existing `urgency_date`.
 *   3. Project derivation — for the project facet chip strip (PRD §12.7 /
 *      §13 deferred "project facet"), from `project_tag` or the file path.
 *
 * Lives outside `kanban-view.ts` (which has Obsidian DOM deps) so this module
 * stays unit-testable, exactly like `dispatch-queue.ts`.
 */

export interface ChecklistProgress {
	done: number;
	total: number;
}

/**
 * Aggregate checkbox completion across the three checklist sections a task can
 * carry: preconditions, execution steps, and done criteria. Returns a single
 * done/total pair for the compact card badge (the modal breaks it out per
 * section). A task with no checklist items returns {done:0,total:0} — callers
 * should hide the badge when total === 0.
 */
export function computeChecklistProgress(sections: TaskSections): ChecklistProgress {
	const lists = [sections.preconditions, sections.executionSteps, sections.doneCriteria];
	let done = 0;
	let total = 0;
	for (const list of lists) {
		if (!list) continue;
		for (const item of list) {
			total++;
			if (item.checked) done++;
		}
	}
	return { done, total };
}

export type UrgencyState = "overdue" | "today" | "soon" | "future";

function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Parse a date-only string (YYYY-MM-DD, optionally with a trailing time) into a
 * local Date at midnight. Falls back to Date parsing for other formats. Returns
 * null when unparseable so the caller can skip the urgency treatment.
 */
function parseDateOnly(s: string): Date | null {
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (m) {
		return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	}
	const d = new Date(s);
	return isNaN(d.getTime()) ? null : startOfDay(d);
}

/**
 * Classify a task's `urgency_date` relative to `now`.
 *   overdue — due date is before today
 *   today   — due date is today
 *   soon    — due within `soonDays` (default 3) calendar days
 *   future  — beyond the soon window
 * Returns null when there's no date or it can't be parsed.
 *
 * `now` is injected (not read from the clock) to keep this pure + testable.
 */
export function urgencyState(
	dateStr: string | undefined,
	now: Date,
	soonDays = 3,
): UrgencyState | null {
	if (!dateStr) return null;
	const due = parseDateOnly(dateStr);
	if (!due) return null;
	const today = startOfDay(now);
	const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
	if (diffDays < 0) return "overdue";
	if (diffDays === 0) return "today";
	if (diffDays <= soonDays) return "soon";
	return "future";
}

/**
 * Derive the project name a card belongs to, for the facet chip strip.
 *
 * Priority: explicit `project_tag` (first entry) wins; otherwise fall back to
 * the first folder segment beneath a configured discovery root (path-derived
 * project, e.g. `backlog/tasks/website-redesign/foo.md` → "website-redesign").
 * Returns null when the task has no tag and sits directly in a discovery root
 * (no project subfolder) — those land in the "No project" bucket.
 */
export function deriveProject(
	projectTag: string[] | undefined,
	path: string,
	discoveryFolders: string[],
): string | null {
	if (projectTag && projectTag.length > 0 && projectTag[0]) {
		return projectTag[0];
	}
	return pathDerivedProject(path, discoveryFolders);
}

/** Path-derived project: first subfolder under a discovery root, or null. */
export function pathDerivedProject(path: string, discoveryFolders: string[]): string | null {
	for (const root of discoveryFolders) {
		const norm = root.replace(/\/+$/, "");
		const prefix = norm + "/";
		if (path.startsWith(prefix)) {
			const rest = path.slice(prefix.length);
			const segs = rest.split("/");
			// segs.length > 1 means there's at least one subfolder before the file.
			if (segs.length > 1) return segs[0];
			return null;
		}
	}
	return null;
}
