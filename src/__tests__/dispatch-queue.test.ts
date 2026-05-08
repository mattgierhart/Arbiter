import { describe, it, expect } from "vitest";
import {
	actionToColor,
	priorityRank,
	isAssessmentFresh,
	isDispatchable,
	sortDispatchQueue,
	getDispatchQueue,
	type QueueTask,
} from "../dispatch-queue";

describe("actionToColor (OQ-014)", () => {
	it("maps EXE and CTX to green", () => {
		expect(actionToColor("EXE")).toBe("green");
		expect(actionToColor("CTX")).toBe("green");
	});
	it("maps ASK and ESC to yellow", () => {
		expect(actionToColor("ASK")).toBe("yellow");
		expect(actionToColor("ESC")).toBe("yellow");
	});
	it("maps DEC, WAIT, DECL to red", () => {
		expect(actionToColor("DEC")).toBe("red");
		expect(actionToColor("WAIT")).toBe("red");
		expect(actionToColor("DECL")).toBe("red");
	});
	it("maps UNASSESSED and undefined to grey", () => {
		expect(actionToColor("UNASSESSED")).toBe("grey");
		expect(actionToColor(undefined)).toBe("grey");
	});
});

describe("priorityRank", () => {
	it("ranks urgent first, low last", () => {
		expect(priorityRank("urgent")).toBe(0);
		expect(priorityRank("high")).toBe(1);
		expect(priorityRank("normal")).toBe(2);
		expect(priorityRank("low")).toBe(3);
	});
	it("treats undefined as normal", () => {
		expect(priorityRank(undefined)).toBe(priorityRank("normal"));
	});
});

describe("isAssessmentFresh (SYNC-001)", () => {
	it("is fresh when revisions match", () => {
		expect(
			isAssessmentFresh({
				taskRevision: "abc123",
				arbiterAssessedRevision: "abc123",
			}),
		).toBe(true);
	});
	it("is NOT fresh when revisions differ", () => {
		expect(
			isAssessmentFresh({
				taskRevision: "abc123",
				arbiterAssessedRevision: "different",
			}),
		).toBe(false);
	});
	it("is NOT fresh when either revision is missing", () => {
		expect(isAssessmentFresh({ taskRevision: "abc" })).toBe(false);
		expect(isAssessmentFresh({ arbiterAssessedRevision: "abc" })).toBe(false);
		expect(isAssessmentFresh({})).toBe(false);
	});
});

describe("isDispatchable", () => {
	const baseTask: QueueTask = {
		arbiterAction: "EXE",
		mattApproved: true,
		taskRevision: "rev1",
		arbiterAssessedRevision: "rev1",
	};

	it("dispatches when EXE + approved + fresh", () => {
		expect(isDispatchable(baseTask)).toBe(true);
	});
	it("does NOT dispatch when not approved", () => {
		expect(isDispatchable({ ...baseTask, mattApproved: false })).toBe(false);
		expect(isDispatchable({ ...baseTask, mattApproved: undefined })).toBe(false);
	});
	it("does NOT dispatch when stale (SYNC-001 mismatch)", () => {
		expect(
			isDispatchable({ ...baseTask, arbiterAssessedRevision: "old" }),
		).toBe(false);
	});
	it("does NOT dispatch CTX even if approved (v0.5.0 strict)", () => {
		expect(isDispatchable({ ...baseTask, arbiterAction: "CTX" })).toBe(false);
	});
	it("does NOT dispatch when never assessed", () => {
		expect(
			isDispatchable({ ...baseTask, arbiterAction: undefined }),
		).toBe(false);
	});
	it("does NOT dispatch ASK/ESC/DEC/WAIT/DECL even if approved", () => {
		for (const a of ["ASK", "ESC", "DEC", "WAIT", "DECL"] as const) {
			expect(isDispatchable({ ...baseTask, arbiterAction: a })).toBe(false);
		}
	});
});

describe("sortDispatchQueue", () => {
	const fresh = { taskRevision: "r", arbiterAssessedRevision: "r" };

	it("sorts urgent before high before normal before low", () => {
		const tasks: QueueTask[] = [
			{ ...fresh, arbiterAction: "EXE", mattApproved: true, priority: "low", arbiterLastAssessed: "2026-01-01" },
			{ ...fresh, arbiterAction: "EXE", mattApproved: true, priority: "urgent", arbiterLastAssessed: "2026-01-01" },
			{ ...fresh, arbiterAction: "EXE", mattApproved: true, priority: "normal", arbiterLastAssessed: "2026-01-01" },
			{ ...fresh, arbiterAction: "EXE", mattApproved: true, priority: "high", arbiterLastAssessed: "2026-01-01" },
		];
		const sorted = sortDispatchQueue(tasks);
		expect(sorted.map((t) => t.priority)).toEqual(["urgent", "high", "normal", "low"]);
	});

	it("breaks ties by urgencyDate (earlier first)", () => {
		const tasks: QueueTask[] = [
			{ ...fresh, priority: "normal", urgencyDate: "2026-06-01" },
			{ ...fresh, priority: "normal", urgencyDate: "2026-04-01" },
			{ ...fresh, priority: "normal", urgencyDate: "2026-05-01" },
		];
		const sorted = sortDispatchQueue(tasks);
		expect(sorted.map((t) => t.urgencyDate)).toEqual([
			"2026-04-01",
			"2026-05-01",
			"2026-06-01",
		]);
	});

	it("dated tasks come before undated when priority equal", () => {
		const tasks: QueueTask[] = [
			{ ...fresh, priority: "normal" },
			{ ...fresh, priority: "normal", urgencyDate: "2026-06-01" },
		];
		const sorted = sortDispatchQueue(tasks);
		expect(sorted[0].urgencyDate).toBe("2026-06-01");
	});

	it("does not mutate the input array", () => {
		const tasks: QueueTask[] = [
			{ priority: "low" },
			{ priority: "urgent" },
		];
		const snapshot = [...tasks];
		sortDispatchQueue(tasks);
		expect(tasks).toEqual(snapshot);
	});
});

describe("getDispatchQueue (filter + sort end-to-end)", () => {
	const fresh = { taskRevision: "r", arbiterAssessedRevision: "r" };

	it("returns only dispatchable tasks, sorted by priority", () => {
		const tasks: QueueTask[] = [
			{ ...fresh, arbiterAction: "EXE", mattApproved: true, priority: "low" },
			{ ...fresh, arbiterAction: "ASK", mattApproved: true, priority: "urgent" }, // not green
			{ ...fresh, arbiterAction: "EXE", mattApproved: false, priority: "urgent" }, // not approved
			{ ...fresh, arbiterAction: "EXE", mattApproved: true, priority: "urgent" },
			{ ...fresh, arbiterAction: "EXE", mattApproved: true, priority: "high" },
		];
		const queue = getDispatchQueue(tasks);
		expect(queue.map((t) => t.priority)).toEqual(["urgent", "high", "low"]);
	});

	it("returns empty array when nothing is dispatchable", () => {
		const tasks: QueueTask[] = [
			{ ...fresh, arbiterAction: "ASK", mattApproved: true },
			{ ...fresh, arbiterAction: "EXE", mattApproved: false },
		];
		expect(getDispatchQueue(tasks)).toEqual([]);
	});
});
