import { describe, expect, it } from "vitest";
import { computeTaskRevision, isAssessmentFresh, isBoardSettled } from "../sync-protocol";
import type { ParsedTask } from "../types";

const SETTINGS_ON = { syncProtocolEnabled: true };
const SETTINGS_OFF = { syncProtocolEnabled: false };

function makeTask(overrides: Partial<ParsedTask> = {}): ParsedTask {
	return {
		title: "Test Task",
		type: "task-execution",
		status: "active",
		owner: "claude",
		filePath: "/vault/tasks/test.md",
		rawFrontmatter: {},
		bodyContent: "",
		sections: {},
		...overrides,
	};
}

describe("computeTaskRevision", () => {
	it("is deterministic for identical input", () => {
		const body = "## Outcome\nShip the thing.";
		const fm = { title: "T", owner: "matt" };
		expect(computeTaskRevision(body, fm)).toBe(computeTaskRevision(body, fm));
	});

	it("ignores arbiter_* frontmatter changes (Arbiter must not self-invalidate)", () => {
		const body = "## Outcome\nShip the thing.";
		const before = { title: "T", owner: "matt" };
		const afterArbiterWrote = {
			title: "T",
			owner: "matt",
			arbiter_action: "EXE",
			arbiter_confidence: "high",
			arbiter_last_assessed: "2026-05-03T10:00:00Z",
			arbiter_assessed_revision: "deadbeef",
		};
		expect(computeTaskRevision(body, before)).toBe(computeTaskRevision(body, afterArbiterWrote));
	});

	it("ignores ## Agent Assessment section changes (Arbiter owns it)", () => {
		const baseBody = "## Outcome\nShip the thing.\n";
		const withoutAssessment = baseBody;
		const withAssessment = baseBody + "\n## Agent Assessment\n- **Action**: EXE\n- **Confidence**: high\n";
		expect(computeTaskRevision(withoutAssessment, {})).toBe(computeTaskRevision(withAssessment, {}));
	});

	it("changes when user-editable frontmatter changes", () => {
		const body = "## Outcome\nShip the thing.";
		const a = { title: "T", owner: "matt" };
		const b = { title: "T", owner: "claude" }; // owner changed
		expect(computeTaskRevision(body, a)).not.toBe(computeTaskRevision(body, b));
	});

	it("changes when substantive body content changes", () => {
		const fm = { title: "T" };
		expect(computeTaskRevision("## Outcome\nA.", fm)).not.toBe(
			computeTaskRevision("## Outcome\nB.", fm)
		);
	});

	it("is order-independent for frontmatter keys", () => {
		const body = "x";
		const a = { title: "T", owner: "matt", project_tag: "x" };
		const b = { project_tag: "x", owner: "matt", title: "T" };
		expect(computeTaskRevision(body, a)).toBe(computeTaskRevision(body, b));
	});
});

describe("isAssessmentFresh", () => {
	it("returns fresh=true when sync protocol is disabled (back-compat)", () => {
		const task = makeTask({ taskRevision: "abc", arbiterAssessedRevision: "xyz" });
		expect(isAssessmentFresh(task, SETTINGS_OFF).fresh).toBe(true);
	});

	it("returns fresh=false when never assessed", () => {
		const task = makeTask({ taskRevision: "abc" });
		const result = isAssessmentFresh(task, SETTINGS_ON);
		expect(result.fresh).toBe(false);
		expect(result.reason).toContain("never been assessed");
	});

	it("returns fresh=false when revisions mismatch (the torn-snapshot case)", () => {
		const task = makeTask({ taskRevision: "new123", arbiterAssessedRevision: "old456" });
		const result = isAssessmentFresh(task, SETTINGS_ON);
		expect(result.fresh).toBe(false);
		expect(result.reason).toContain("Stale assessment");
	});

	it("returns fresh=true when revisions match", () => {
		const task = makeTask({ taskRevision: "abc123", arbiterAssessedRevision: "abc123" });
		const result = isAssessmentFresh(task, SETTINGS_ON);
		expect(result.fresh).toBe(true);
	});

	it("respects force=true even when sync protocol is off", () => {
		const task = makeTask({ taskRevision: "new", arbiterAssessedRevision: "old" });
		const result = isAssessmentFresh(task, SETTINGS_OFF, { force: true });
		expect(result.fresh).toBe(false);
	});
});

describe("isBoardSettled", () => {
	const settings = { boardDebounceMs: 60_000 };

	it("returns settled=false right after a board edit", () => {
		const now = 1_000_000_000;
		const result = isBoardSettled(now - 5_000, settings, now);
		expect(result.settled).toBe(false);
		expect(result.waitMs).toBe(55_000);
	});

	it("returns settled=true after debounce window elapses", () => {
		const now = 1_000_000_000;
		const result = isBoardSettled(now - 70_000, settings, now);
		expect(result.settled).toBe(true);
		expect(result.waitMs).toBe(0);
	});

	it("treats exactly the debounce boundary as settled", () => {
		const now = 1_000_000_000;
		const result = isBoardSettled(now - 60_000, settings, now);
		expect(result.settled).toBe(true);
	});
});
