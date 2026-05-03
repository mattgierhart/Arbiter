import { createHash } from "node:crypto";
import type { ArbiterSettings, ParsedTask } from "./types";

/**
 * SYNC-001 — Multi-actor read-safety protocol for Arbiter task notes.
 *
 * Problem this solves: in a vault touched by multiple actors (Pinch on Mac Mini,
 * Claude on Mac Studio, Matt via Obsidian UI, Arbiter as the assessor), file-level
 * sync is not transactional. iCloud / network FS / Dropbox / Syncthing all deliver
 * file changes independently. A second-reader agent can observe the Kanban.md from
 * a newer revision while the linked task note is still on the older revision —
 * and vice versa. The result: the agent acts on a stale `arbiter_action: EXE`
 * that no longer reflects the post-edit assessment.
 *
 * Diagnosis credit: Codex (gpt-5.5) review on 2026-05-03.
 *
 * Mitigation: every task note carries a deterministic content-derived revision
 * (`taskRevision`). Whenever Arbiter records an assessment, it also writes the
 * revision it scored against (`arbiterAssessedRevision`). External readers must
 * verify these match before trusting the cached action.
 *
 * What's hashed:
 *   - The body content with the `## Agent Assessment` section removed (Arbiter
 *     manages that section, so its writes don't change the revision)
 *   - All non-arbiter_* frontmatter keys, sorted, stringified
 *
 * What's NOT hashed (Arbiter writes these, would self-invalidate):
 *   - `arbiter_*` frontmatter fields
 *   - The `## Agent Assessment` section
 *
 * Result: Arbiter's own writes don't change `taskRevision`. Pinch's or Matt's
 * substantive edits do. External readers see the new revision and know to
 * wait for Arbiter to re-assess before dispatching.
 *
 * Open-source notes: this protocol is generic across vault-based agent
 * collaboration. The contract is portable — any agent that respects the
 * `taskRevision` / `arbiterAssessedRevision` fields can interoperate safely.
 */

const ASSESSMENT_HEADING_PATTERN = /^##\s+Agent Assessment\b/im;
const NEXT_HEADING_PATTERN = /\n##\s/;

/**
 * Strip the `## Agent Assessment` section (Arbiter-managed) from a body so its
 * presence/contents don't change the revision hash. Returns the body with
 * everything from the heading through the next `## ` heading (or end of string)
 * removed.
 */
function stripAssessmentSection(body: string): string {
	const match = body.match(ASSESSMENT_HEADING_PATTERN);
	if (!match || match.index === undefined) return body;
	const start = match.index;
	const after = body.slice(start);
	const nextRel = after.slice(1).search(NEXT_HEADING_PATTERN);
	const end = nextRel === -1 ? body.length : start + 1 + nextRel;
	return body.slice(0, start) + body.slice(end);
}

/**
 * Compute a deterministic revision string from a task note's substantive content.
 * Stable across Arbiter's own writes; changes only when a non-Arbiter actor edits
 * the note.
 */
export function computeTaskRevision(
	body: string,
	frontmatter: Record<string, unknown>
): string {
	const bodyWithoutAssessment = stripAssessmentSection(body).trim();

	// Filter out arbiter_* keys (Arbiter writes them, must not self-invalidate)
	const userKeys = Object.keys(frontmatter)
		.filter((k) => !k.startsWith("arbiter_"))
		.sort();
	const userFrontmatter: Record<string, unknown> = {};
	for (const k of userKeys) userFrontmatter[k] = frontmatter[k];

	const payload = JSON.stringify(userFrontmatter) + "\n---\n" + bodyWithoutAssessment;
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Result of a sync-protocol freshness check. External readers consume this to
 * decide whether to act on the cached arbiter_action.
 */
export interface FreshnessCheck {
	fresh: boolean;
	reason: string;
	taskRevision: string | undefined;
	arbiterAssessedRevision: string | undefined;
}

/**
 * Public API for any external agent (Claude, Codex, future Pinch-driven agents)
 * to call before acting on a task's `arbiterAction`.
 *
 * Returns `fresh: true` only when:
 *   1. Sync protocol is enabled in settings (or `force: true` to check anyway)
 *   2. The task has been assessed at least once (`arbiterAssessedRevision` exists)
 *   3. The assessed revision matches the current task revision
 *
 * The board-debounce window is enforced by the calling reader at the board level
 * (it knows the Kanban.md mtime and can debounce externally). This function
 * checks the task-level half of the protocol.
 */
export function isAssessmentFresh(
	task: ParsedTask,
	settings: Pick<ArbiterSettings, "syncProtocolEnabled">,
	opts: { force?: boolean } = {}
): FreshnessCheck {
	if (!settings.syncProtocolEnabled && !opts.force) {
		return {
			fresh: true,
			reason: "Sync protocol disabled — caller assumes single-actor vault",
			taskRevision: task.taskRevision,
			arbiterAssessedRevision: task.arbiterAssessedRevision,
		};
	}

	if (!task.arbiterAssessedRevision) {
		return {
			fresh: false,
			reason: "Task has never been assessed (no arbiter_assessed_revision)",
			taskRevision: task.taskRevision,
			arbiterAssessedRevision: undefined,
		};
	}

	if (!task.taskRevision) {
		return {
			fresh: false,
			reason: "Parser did not compute a current task_revision",
			taskRevision: undefined,
			arbiterAssessedRevision: task.arbiterAssessedRevision,
		};
	}

	if (task.arbiterAssessedRevision !== task.taskRevision) {
		return {
			fresh: false,
			reason: `Stale assessment: scored against revision ${task.arbiterAssessedRevision}, current revision is ${task.taskRevision}. Wait for Arbiter to re-score.`,
			taskRevision: task.taskRevision,
			arbiterAssessedRevision: task.arbiterAssessedRevision,
		};
	}

	return {
		fresh: true,
		reason: "Assessment matches current revision",
		taskRevision: task.taskRevision,
		arbiterAssessedRevision: task.arbiterAssessedRevision,
	};
}

/**
 * Check whether the Kanban board file has been stable long enough for safe
 * cross-file reads. Callers pass the board file's mtime; this returns true
 * only if the debounce window has elapsed.
 *
 * The board-level half of the protocol — protects against the case where the
 * board moved a card to "Now" but the corresponding task note's edit hasn't
 * synced yet.
 */
export function isBoardSettled(
	boardMtimeMs: number,
	settings: Pick<ArbiterSettings, "boardDebounceMs">,
	nowMs: number = Date.now()
): { settled: boolean; waitMs: number } {
	const elapsed = nowMs - boardMtimeMs;
	if (elapsed >= settings.boardDebounceMs) {
		return { settled: true, waitMs: 0 };
	}
	return { settled: false, waitMs: settings.boardDebounceMs - elapsed };
}
