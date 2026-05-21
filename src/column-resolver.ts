import type { WorkflowColumn } from "./types";

/**
 * v0.6.0: derive a task's workflow column from its file path.
 *
 * Per PRD §13.5 + OQ-016 (file path wins as the source of truth for "current
 * column" when Kanban.md and filesystem disagree), this is the canonical
 * lookup used by the lane-aware assessment templates. The kanban view's own
 * grouping (by `arbiter_action`) is orthogonal — that's the *decision*
 * column; this is the *workflow stage* column.
 *
 * Detection: split the path by `/` and look for a segment matching one of
 * the known workflow columns. Case-insensitive. When multiple match, the
 * **deepest** (rightmost, closest to the filename) wins — this lets nested
 * layouts like `arbiter/proposed/next/TASK.md` mean "this is in next"
 * without ambiguity.
 *
 * Returns "unknown" when no segment matches — that path renders the
 * generic template (OQ-018 fallback).
 */
const COLUMN_KEYWORDS: ReadonlyArray<{ keyword: string; column: WorkflowColumn }> = [
	{ keyword: "proposed", column: "proposed" },
	{ keyword: "next", column: "next" },
	{ keyword: "in-progress", column: "in-progress" },
	{ keyword: "done", column: "done" },
];

export function resolveWorkflowColumn(filePath: string): WorkflowColumn {
	if (!filePath) return "unknown";

	// Normalize separators and split. Windows paths can show up via Obsidian
	// adapters in some configurations; treat both `/` and `\` as segment breaks.
	const segments = filePath.split(/[/\\]/).filter(Boolean);
	if (segments.length === 0) return "unknown";

	// Drop the final segment if it looks like a filename (has an extension or
	// is the last segment). The column is conveyed by the folder structure,
	// not by the filename itself — a file literally named "proposed.md"
	// should NOT count.
	const folderSegments = segments.slice(0, -1);

	// Walk right-to-left so the deepest match wins.
	for (let i = folderSegments.length - 1; i >= 0; i--) {
		const segLower = folderSegments[i].toLowerCase();
		for (const { keyword, column } of COLUMN_KEYWORDS) {
			if (segLower === keyword) {
				return column;
			}
		}
	}

	return "unknown";
}
