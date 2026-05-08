import { describe, it, expect } from "vitest";
import {
	formatAssessmentBlock,
	formatFrontmatterFields,
	setFrontmatterField,
	updateTaskContent,
} from "../action-recorder";
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
