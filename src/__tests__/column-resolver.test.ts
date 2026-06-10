import { describe, expect, it } from "vitest";
import { resolveWorkflowColumn } from "../column-resolver";

describe("resolveWorkflowColumn", () => {
	describe("standard workflow layouts", () => {
		it("detects proposed", () => {
			expect(resolveWorkflowColumn("arbiter/proposed/TASK-1.md")).toBe("proposed");
		});

		it("detects next", () => {
			expect(resolveWorkflowColumn("arbiter/next/TASK-2.md")).toBe("next");
		});

		it("detects in-progress", () => {
			expect(resolveWorkflowColumn("arbiter/in-progress/TASK-3.md")).toBe("in-progress");
		});

		it("detects done", () => {
			expect(resolveWorkflowColumn("arbiter/done/TASK-4.md")).toBe("done");
		});

		it("works with deeper roots", () => {
			expect(resolveWorkflowColumn("workspace/arbiter/next/TASK-5.md")).toBe("next");
		});

		it("works with nested subfolders inside a column", () => {
			expect(resolveWorkflowColumn("arbiter/done/archive/2026/TASK-6.md")).toBe("done");
		});
	});

	describe("case insensitivity", () => {
		it("matches Proposed", () => {
			expect(resolveWorkflowColumn("Arbiter/Proposed/TASK-7.md")).toBe("proposed");
		});

		it("matches IN-PROGRESS", () => {
			expect(resolveWorkflowColumn("arbiter/IN-PROGRESS/TASK-8.md")).toBe("in-progress");
		});
	});

	describe("deepest-wins ambiguity", () => {
		it("picks the rightmost matching segment", () => {
			// Both `proposed` and `next` appear; `next` is deeper, so it wins.
			expect(resolveWorkflowColumn("arbiter/proposed/next/TASK-9.md")).toBe("next");
		});

		it("ignores column keywords in the parent root when a deeper match exists", () => {
			expect(resolveWorkflowColumn("done/arbiter/proposed/TASK-10.md")).toBe("proposed");
		});
	});

	describe("filename is not consulted", () => {
		it("does not treat a file named proposed.md as a match", () => {
			expect(resolveWorkflowColumn("arbiter/backlog/proposed.md")).toBe("unknown");
		});

		it("does not treat a file named done.md as a match", () => {
			expect(resolveWorkflowColumn("notes/done.md")).toBe("unknown");
		});
	});

	describe("fallback to unknown", () => {
		it("returns unknown for unrelated layouts", () => {
			expect(resolveWorkflowColumn("backlog/tasks/TASK-11.md")).toBe("unknown");
		});

		it("returns unknown for empty input", () => {
			expect(resolveWorkflowColumn("")).toBe("unknown");
		});

		it("returns unknown for filename-only paths", () => {
			expect(resolveWorkflowColumn("TASK-12.md")).toBe("unknown");
		});

		it("does not partial-match (e.g. 'proposed-archive' is not 'proposed')", () => {
			expect(resolveWorkflowColumn("arbiter/proposed-archive/TASK-13.md")).toBe("unknown");
		});

		it("does not match 'in_progress' (underscore) — convention is dash", () => {
			expect(resolveWorkflowColumn("arbiter/in_progress/TASK-14.md")).toBe("unknown");
		});
	});

	describe("path separator handling", () => {
		it("handles backslash-separated paths", () => {
			expect(resolveWorkflowColumn("arbiter\\next\\TASK-15.md")).toBe("next");
		});

		it("handles mixed separators", () => {
			expect(resolveWorkflowColumn("workspace\\arbiter/in-progress\\TASK-16.md")).toBe(
				"in-progress",
			);
		});
	});
});
