import { describe, it, expect } from "vitest";
import {
	computeChecklistProgress,
	deriveProject,
	pathDerivedProject,
	urgencyState,
} from "../card-meta";
import type { TaskSections } from "../types";

describe("computeChecklistProgress", () => {
	it("aggregates checked items across all three checklist sections", () => {
		const sections: TaskSections = {
			preconditions: [
				{ text: "a", checked: true },
				{ text: "b", checked: false },
			],
			executionSteps: [
				{ text: "c", checked: true },
				{ text: "d", checked: true },
			],
			doneCriteria: [{ text: "e", checked: false }],
		};
		expect(computeChecklistProgress(sections)).toEqual({ done: 3, total: 5 });
	});

	it("returns 0/0 when there are no checklist sections", () => {
		expect(computeChecklistProgress({})).toEqual({ done: 0, total: 0 });
	});

	it("counts a fully complete task as done === total", () => {
		const sections: TaskSections = {
			executionSteps: [
				{ text: "a", checked: true },
				{ text: "b", checked: true },
			],
		};
		expect(computeChecklistProgress(sections)).toEqual({ done: 2, total: 2 });
	});
});

describe("urgencyState", () => {
	// Fixed reference "today" so the test is deterministic.
	const now = new Date(2026, 5, 24); // 2026-06-24 (month is 0-indexed)

	it("returns null when there is no date", () => {
		expect(urgencyState(undefined, now)).toBeNull();
	});

	it("returns null for an unparseable date", () => {
		expect(urgencyState("not-a-date", now)).toBeNull();
	});

	it("flags a past date as overdue", () => {
		expect(urgencyState("2026-06-20", now)).toBe("overdue");
	});

	it("flags the same calendar day as today", () => {
		expect(urgencyState("2026-06-24", now)).toBe("today");
	});

	it("flags a date within the soon window as soon", () => {
		expect(urgencyState("2026-06-26", now)).toBe("soon"); // 2 days out, soonDays=3
	});

	it("flags a date beyond the soon window as future", () => {
		expect(urgencyState("2026-07-15", now)).toBe("future");
	});

	it("honors a custom soonDays window", () => {
		expect(urgencyState("2026-06-30", now, 10)).toBe("soon"); // 6 days out, window=10
	});

	it("ignores a trailing time component", () => {
		expect(urgencyState("2026-06-24 14:30", now)).toBe("today");
	});
});

describe("pathDerivedProject", () => {
	const roots = ["backlog/tasks"];

	it("returns the first subfolder under a discovery root", () => {
		expect(pathDerivedProject("backlog/tasks/website/foo.md", roots)).toBe("website");
	});

	it("returns null for a file directly in the root (no project subfolder)", () => {
		expect(pathDerivedProject("backlog/tasks/foo.md", roots)).toBeNull();
	});

	it("returns null for a path outside every discovery root", () => {
		expect(pathDerivedProject("other/place/foo.md", roots)).toBeNull();
	});

	it("tolerates a trailing slash on the configured root", () => {
		expect(pathDerivedProject("backlog/tasks/website/foo.md", ["backlog/tasks/"])).toBe(
			"website",
		);
	});
});

describe("deriveProject", () => {
	const roots = ["backlog/tasks"];

	it("prefers an explicit project_tag over the path", () => {
		expect(deriveProject(["Pinch"], "backlog/tasks/website/foo.md", roots)).toBe("Pinch");
	});

	it("falls back to the path-derived project when no tag is present", () => {
		expect(deriveProject(undefined, "backlog/tasks/website/foo.md", roots)).toBe("website");
	});

	it("ignores an empty project_tag array and uses the path", () => {
		expect(deriveProject([], "backlog/tasks/website/foo.md", roots)).toBe("website");
	});

	it("returns null when there is neither a tag nor a project subfolder", () => {
		expect(deriveProject(undefined, "backlog/tasks/foo.md", roots)).toBeNull();
	});
});
