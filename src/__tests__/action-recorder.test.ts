import { describe, it, expect } from "vitest";
import {
	formatAssessmentBlock,
	formatFrontmatterFields,
	formatLaneAwareAssessmentBlock,
	setFrontmatterField,
	updateTaskContent,
	type LaneContext,
} from "../action-recorder";
import { parseTask } from "../task-parser";
import { assessReadiness } from "../readiness";
import { resolveWorkflowColumn } from "../column-resolver";
import type { ActionRecord } from "../types";

const SAMPLE_RECORD: ActionRecord = {
	action: "EXE",
	confidence: "high",
	reason: "All readiness dimensions are satisfied.",
	nextAction: "Pull latest main and create task breakdown.",
	blockerType: "none",
	needsHuman: false,
	lastAssessed: "2026-03-30T20:50:00.000Z",
};

describe("formatAssessmentBlock", () => {
	it("formats a basic EXE record", () => {
		const block = formatAssessmentBlock(SAMPLE_RECORD);
		expect(block).toContain("## Agent Assessment");
		expect(block).toContain("**Action**: EXE (Execute)");
		expect(block).toContain("**Confidence**: high");
		expect(block).toContain("Pull latest main");
		expect(block).toContain("**Human input needed**: no");
	});

	it("includes human ask for ASK records", () => {
		const askRecord: ActionRecord = {
			...SAMPLE_RECORD,
			action: "ASK",
			needsHuman: true,
			humanAsk: "Which schema should be updated?",
		};

		const block = formatAssessmentBlock(askRecord);
		expect(block).toContain("**Human ask**: Which schema should be updated?");
	});

	it("includes wake condition for WAIT records", () => {
		const waitRecord: ActionRecord = {
			...SAMPLE_RECORD,
			action: "WAIT",
			wakeCondition: "Matt responds with API credentials",
		};

		const block = formatAssessmentBlock(waitRecord);
		expect(block).toContain("**Wake condition**: Matt responds with API credentials");
	});

	it("includes subtasks for DEC records", () => {
		const decRecord: ActionRecord = {
			...SAMPLE_RECORD,
			action: "DEC",
			subtasks: ["Analyze scope", "Create subtask notes"],
		};

		const block = formatAssessmentBlock(decRecord);
		expect(block).toContain("- [ ] Analyze scope");
		expect(block).toContain("- [ ] Create subtask notes");
	});

	it("formats terminal records correctly", () => {
		const terminalRecord: ActionRecord = {
			...SAMPLE_RECORD,
			action: "DECL",
			terminal: true,
			reason: "Task is already completed.",
			nextAction: "No action needed — task is already completed.",
			needsHuman: false,
		};

		const block = formatAssessmentBlock(terminalRecord);
		expect(block).toContain("Terminal");
		expect(block).toContain("no further action required");
		expect(block).toContain("**Human input needed**: no");
	});
});

describe("formatFrontmatterFields", () => {
	it("produces arbiter_ prefixed fields", () => {
		const fields = formatFrontmatterFields(SAMPLE_RECORD);
		expect(fields.arbiter_action).toBe("EXE");
		expect(fields.arbiter_confidence).toBe("high");
		expect(fields.arbiter_blocker_type).toBe("none");
		expect(fields.arbiter_needs_human).toBe(false);
	});

	it("respects custom prefix", () => {
		const fields = formatFrontmatterFields(SAMPLE_RECORD, "custom_");
		expect(fields.custom_action).toBe("EXE");
	});
});

describe("updateTaskContent", () => {
	const settings = {
		frontmatterPrefix: "arbiter_",
		assessmentHeading: "## Agent Assessment",
		laneAwareAssessments: true,
	};

	it("adds assessment to a note without one", () => {
		const original = `---
title: "Test task"
status: active
---

## Outcome
Do the thing.
`;

		const updated = updateTaskContent(original, SAMPLE_RECORD, settings);

		expect(updated).toContain('arbiter_action: "EXE"');
		expect(updated).toContain("## Agent Assessment");
		expect(updated).toContain("**Action**: EXE");
	});

	it("replaces existing assessment section", () => {
		const original = `---
title: "Test task"
status: active
arbiter_action: "WAIT"
---

## Outcome
Do the thing.

## Agent Assessment
- **Action**: WAIT
- **Confidence**: low
- **Last assessed**: old date
`;

		const updated = updateTaskContent(original, SAMPLE_RECORD, settings);

		// Should have new action, not old
		expect(updated).toContain("**Action**: EXE");
		expect(updated).not.toContain("**Action**: WAIT");
		// Frontmatter should be updated
		expect(updated).toContain('arbiter_action: "EXE"');
	});

	it("adds frontmatter to a note without any", () => {
		const original = "# Just a note\n\nSome content.";
		const updated = updateTaskContent(original, SAMPLE_RECORD, settings);

		expect(updated).toContain("---");
		expect(updated).toContain('arbiter_action: "EXE"');
		expect(updated).toContain("## Agent Assessment");
	});
});

describe("setFrontmatterField (v0.5.0 toggle commands)", () => {
	it("updates an existing field", () => {
		const original = `---
title: "T"
matt_approved: false
---
body`;
		const updated = setFrontmatterField(original, "matt_approved", true);
		expect(updated).toContain("matt_approved: true");
		expect(updated).not.toContain("matt_approved: false");
	});

	it("appends a new field when absent", () => {
		const original = `---
title: "T"
---
body`;
		const updated = setFrontmatterField(original, "priority", "urgent");
		expect(updated).toContain("priority: urgent");
	});

	it("creates frontmatter block on a file that has none", () => {
		const original = "# No frontmatter\n\nbody";
		const updated = setFrontmatterField(original, "matt_approved", true);
		expect(updated.startsWith("---\nmatt_approved: true\n---\n")).toBe(true);
	});

	it("removes a field when value is null", () => {
		const original = `---
title: "T"
priority: urgent
status: active
---
body`;
		const updated = setFrontmatterField(original, "priority", null);
		expect(updated).not.toMatch(/^priority:/m);
		expect(updated).toContain('title: "T"');
		expect(updated).toContain("status: active");
	});

	it("preserves other fields untouched", () => {
		const original = `---
title: "Important"
type: task-execution
status: active
owner: pinch
---
body`;
		const updated = setFrontmatterField(original, "matt_approved", true);
		expect(updated).toContain('title: "Important"');
		expect(updated).toContain("type: task-execution");
		expect(updated).toContain("status: active");
		expect(updated).toContain("owner: pinch");
		expect(updated).toContain("matt_approved: true");
	});

	it("formats values cleanly: bare booleans, unquoted identifiers, quoted strings", () => {
		const a = setFrontmatterField("---\nx: 1\n---\nbody", "k", true);
		expect(a).toContain("k: true");

		const b = setFrontmatterField("---\nx: 1\n---\nbody", "k", "urgent");
		expect(b).toContain("k: urgent");

		const c = setFrontmatterField("---\nx: 1\n---\nbody", "k", "has spaces");
		expect(c).toContain('k: "has spaces"');
	});
});

describe("formatLaneAwareAssessmentBlock (v0.6.0)", () => {
	const WELL_FORMED_CONTENT = `---
title: "Build evidence renderer"
type: task-execution
status: active
owner: claude-code
---

## Outcome
Render evidence atoms with icons under each readiness dimension.

## Preconditions
- [x] EvidenceAtom type defined

## Execution Steps
- [ ] Write renderDimensionBlock
- [ ] Add tests

## Done Criteria
- [ ] All templates pass snapshot tests
- [ ] No regressions in 121-test baseline
`;

	const VAGUE_CONTENT = `---
title: "Vague proposal"
type: task-execution
status: active
owner: pinch
---

Do stuff with billing.
`;

	function buildLane(filePath: string, content: string): { record: ActionRecord; lane: LaneContext } {
		const task = parseTask(content, filePath);
		const readiness = assessReadiness(task);
		const record: ActionRecord = {
			action: readiness.allReady ? "EXE" : "DEC",
			confidence: readiness.allReady ? "high" : "low",
			reason: readiness.allReady ? "Ready" : "Gaps detected",
			nextAction: "Refine the outcome section",
			blockerType: readiness.allReady ? "none" : "ambiguity",
			needsHuman: !readiness.allReady,
			lastAssessed: "2026-05-21T14:00:00.000Z",
		};
		const column = resolveWorkflowColumn(filePath);
		return { record, lane: { task, readiness, column } };
	}

	describe("proposed/ — Gap analysis template", () => {
		it("headlines 'Refinement needed' when gaps exist", () => {
			const { record, lane } = buildLane("arbiter/proposed/T1.md", VAGUE_CONTENT);
			const block = formatLaneAwareAssessmentBlock(record, lane);

			expect(block).toContain("## Agent Assessment");
			expect(block.toLowerCase()).toContain("refinement needed");
			expect(block).toContain("`next/`"); // footer guides to next/
		});

		it("headlines 'Promotion-eligible' when no gaps", () => {
			const { record, lane } = buildLane("arbiter/proposed/T2.md", WELL_FORMED_CONTENT);
			const block = formatLaneAwareAssessmentBlock(record, lane);

			expect(block).toContain("Promotion-eligible");
		});

		it("renders evidence atoms with polarity icons under each dimension", () => {
			const { record, lane } = buildLane("arbiter/proposed/T3.md", VAGUE_CONTENT);
			const block = formatLaneAwareAssessmentBlock(record, lane);

			expect(block).toContain("**Clarity**");
			expect(block).toMatch(/⚠️.*frontmatter|⚠️.*missing|⚠️.*body/);
		});
	});

	describe("next/ — Dispatch envelope template", () => {
		it("headlines with dispatch envelope when action is EXE", () => {
			const { record, lane } = buildLane("arbiter/next/T4.md", WELL_FORMED_CONTENT);
			const block = formatLaneAwareAssessmentBlock(record, lane);

			expect(block).toContain("## Agent Assessment");
			expect(block).toContain("EXE");
			expect(block).toContain("dispatch to claude-code");
			expect(block).toContain("**Next step**");
			expect(block).toContain("**Dispatch envelope**: claude-code");
		});

		it("orders Authority + Feasibility first in the dimension list", () => {
			const { record, lane } = buildLane("arbiter/next/T5.md", WELL_FORMED_CONTENT);
			const block = formatLaneAwareAssessmentBlock(record, lane);

			const authorityIdx = block.indexOf("**Authority**");
			const feasibilityIdx = block.indexOf("**Feasibility**");
			const clarityIdx = block.indexOf("**Clarity**");

			expect(authorityIdx).toBeGreaterThan(-1);
			expect(feasibilityIdx).toBeGreaterThan(-1);
			expect(clarityIdx).toBeGreaterThan(-1);
			expect(authorityIdx).toBeLessThan(clarityIdx);
			expect(feasibilityIdx).toBeLessThan(clarityIdx);
		});

		it("surfaces approval state in the footer", () => {
			const { record, lane } = buildLane("arbiter/next/T6.md", WELL_FORMED_CONTENT);
			lane.task.mattApproved = true;
			const approved = formatLaneAwareAssessmentBlock(record, lane);
			expect(approved).toContain("Approved + dispatchable");

			lane.task.mattApproved = false;
			const awaiting = formatLaneAwareAssessmentBlock(record, lane);
			expect(awaiting).toContain("Awaiting approval");
		});
	});

	describe("in-progress/ — Verification template", () => {
		it("headlines 'In flight' and lists done criteria as checkboxes", () => {
			const { record, lane } = buildLane("arbiter/in-progress/T7.md", WELL_FORMED_CONTENT);
			const block = formatLaneAwareAssessmentBlock(record, lane);

			expect(block).toContain("In flight with claude-code");
			expect(block).toContain("Done criteria — verify before marking done");
			expect(block).toContain("- [ ] All templates pass snapshot tests");
			expect(block).toContain("Verify done criteria before moving to `done/`");
		});

		it("orders Feasibility first", () => {
			const { record, lane } = buildLane("arbiter/in-progress/T8.md", WELL_FORMED_CONTENT);
			const block = formatLaneAwareAssessmentBlock(record, lane);

			const feasibilityIdx = block.indexOf("**Feasibility**");
			const clarityIdx = block.indexOf("**Clarity**");
			expect(feasibilityIdx).toBeGreaterThan(-1);
			expect(feasibilityIdx).toBeLessThan(clarityIdx);
		});
	});

	describe("done/ — Audit footprint template", () => {
		it("renders read-only audit framing with as-of-dispatch snapshot", () => {
			const { record, lane } = buildLane("arbiter/done/T9.md", WELL_FORMED_CONTENT);
			const block = formatLaneAwareAssessmentBlock(record, lane);

			expect(block).toContain("recorded");
			expect(block).toContain("**Dispatched by**: claude-code");
			expect(block).toContain("As-of-dispatch snapshot");
			expect(block).toContain("Read-only audit footprint");
		});
	});

	describe("opt-out + unknown column behavior", () => {
		it("updateTaskContent uses legacy template when laneAwareAssessments is false", () => {
			const { record, lane } = buildLane("arbiter/next/T10.md", WELL_FORMED_CONTENT);
			const updated = updateTaskContent(
				WELL_FORMED_CONTENT,
				record,
				{
					frontmatterPrefix: "arbiter_",
					assessmentHeading: "## Agent Assessment",
					laneAwareAssessments: false,
				},
				lane,
			);

			// Legacy block has "- **Action**: EXE (Execute)" line; lane-aware uses
			// a bold headline above it instead.
			expect(updated).toContain("- **Action**: EXE (Execute)");
			expect(updated).not.toContain("dispatch to claude-code");
		});

		it("updateTaskContent uses legacy template when column is unknown", () => {
			const { record, lane } = buildLane("backlog/tasks/T11.md", WELL_FORMED_CONTENT);
			expect(lane.column).toBe("unknown");

			const updated = updateTaskContent(
				WELL_FORMED_CONTENT,
				record,
				{
					frontmatterPrefix: "arbiter_",
					assessmentHeading: "## Agent Assessment",
					laneAwareAssessments: true,
				},
				lane,
			);

			expect(updated).toContain("- **Action**: EXE (Execute)");
			expect(updated).not.toContain("dispatch to claude-code");
		});

		it("updateTaskContent uses lane-aware template when laneAwareAssessments=true and column is known", () => {
			const { record, lane } = buildLane("arbiter/next/T12.md", WELL_FORMED_CONTENT);
			const updated = updateTaskContent(
				WELL_FORMED_CONTENT,
				record,
				{
					frontmatterPrefix: "arbiter_",
					assessmentHeading: "## Agent Assessment",
					laneAwareAssessments: true,
				},
				lane,
			);

			expect(updated).toContain("dispatch to claude-code");
			expect(updated).toContain("**Dispatch envelope**: claude-code");
		});

		it("falls back to legacy formatter when lane is omitted entirely", () => {
			const updated = updateTaskContent(
				WELL_FORMED_CONTENT,
				SAMPLE_RECORD,
				{
					frontmatterPrefix: "arbiter_",
					assessmentHeading: "## Agent Assessment",
					laneAwareAssessments: true,
				},
			);

			expect(updated).toContain("- **Action**: EXE (Execute)");
		});
	});
});
