import { describe, it, expect } from "vitest";
import { selectAction } from "../action-selector";
import { assessReadiness } from "../readiness";
import { parseTask } from "../task-parser";
import type { PolicyRule } from "../types";

describe("selectAction", () => {
	it("selects EXE for a fully ready task", () => {
		const content = `---
title: "Ready task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Complete the feature implementation with all tests passing.

## Preconditions
- [x] Requirements clear
- [x] Branch exists

## Execution Steps
- [ ] Write the code
- [ ] Run tests

## Done Criteria
- [ ] Tests pass
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		expect(record.action).toBe("EXE");
		expect(record.confidence).toBe("high");
		expect(record.needsHuman).toBe(false);
		expect(record.blockerType).toBe("none");
	});

	it("selects ASK when authority is blocked due to review requirement", () => {
		const content = `---
title: "Needs review"
type: task-execution
status: active
owner: pinch
needs_matt_review: true
---

## Outcome
Deploy updates to production server.

## Execution Steps
- [ ] Deploy
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		expect(["ASK", "ESC"]).toContain(record.action);
		expect(record.needsHuman).toBe(true);
		expect(record.humanAsk).toBeDefined();
	});

	it("selects ASK over CTX when task has needs_matt_review and unchecked preconditions", () => {
		const content = `---
title: "Production billing access task"
type: task-execution
status: active
owner: pinch
needs_matt_review: true
---

## Outcome
Downgrade a billing plan in production before renewal.

## Preconditions
- [ ] Matt approval confirmed
- [ ] Billing account access available

## Execution Steps
- [ ] Log into billing portal
- [ ] Change plan
- [ ] Save confirmation
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		// Should be ASK or ESC, NOT CTX
		expect(["ASK", "ESC"]).toContain(record.action);
		expect(record.needsHuman).toBe(true);
		expect(record.humanAsk).toBeDefined();
		// Should mention approval or billing
		expect(record.humanAsk!.toLowerCase()).toMatch(/approval|billing|confirm/);
	});

	it("selects DEC when scope is blocked", () => {
		const steps = Array.from({ length: 10 }, (_, i) => `- [ ] Step ${i + 1}`).join("\n");
		const content = `---
title: "Huge task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Refactor the entire authentication system including migration.

## Execution Steps
${steps}
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		expect(record.action).toBe("DEC");
		expect(record.subtasks).toBeDefined();
		expect(record.subtasks!.length).toBeGreaterThan(0);
	});

	it("respects policy overrides", () => {
		const content = `---
title: "Billing task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Update the billing portal configuration.

## Execution Steps
- [ ] Change billing settings
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);

		const policies: PolicyRule[] = [
			{
				id: "POL-001",
				scope: "vault",
				appliesTo: "*",
				rules: [
					{
						condition: "body contains billing",
						action: "ESC",
						reason: "Always escalate billing-related tasks",
					},
				],
			},
		];

		const record = selectAction(task, readiness, policies);
		expect(record.action).toBe("ESC");
		expect(record.reason).toContain("Policy override");
	});

	it("handles terminal state: completed", () => {
		const content = `---
title: "Done task"
type: task-execution
status: completed
owner: pinch
---

## Outcome
Already done.
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		expect(record.action).toBe("DECL");
		expect(record.terminal).toBe(true);
		expect(record.needsHuman).toBe(false);
		expect(record.nextAction.toLowerCase()).toContain("no action needed");
	});

	it("handles terminal state: cancelled", () => {
		const content = `---
title: "Cancelled task"
type: task-execution
status: cancelled
owner: pinch
---

## Outcome
Cancelled project.
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		expect(record.action).toBe("DECL");
		expect(record.terminal).toBe(true);
		expect(record.needsHuman).toBe(false);
	});

	it("detects needsHuman from unchecked preconditions with human keywords", () => {
		const content = `---
title: "Access gated task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Integrate with external payment API using provided credentials.

## Preconditions
- [ ] API credentials obtained from Matt
- [ ] Sandbox environment access confirmed
- [x] API documentation reviewed
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		expect(record.needsHuman).toBe(true);
	});

	it("includes humanAsk for ASK actions", () => {
		const content = `---
title: "Ambiguous task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Fix it.
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		if (record.action === "ASK") {
			expect(record.humanAsk).toBeDefined();
		}
	});

	it("always includes wakeCondition for WAIT actions", () => {
		const content = `---
title: "Waiting task"
type: task-execution
status: active
owner: pinch
arbiter_action: WAIT
arbiter_wake_condition: "Matt provides API credentials"
---

## Outcome
Integrate with external payment API.

## Preconditions
- [ ] API credentials obtained
- [ ] Sandbox environment access confirmed
- [ ] API documentation reviewed
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		if (record.action === "WAIT") {
			expect(record.wakeCondition).toBeDefined();
		}
	});

	it("generates smart subtasks from execution steps for DEC", () => {
		const steps = Array.from({ length: 9 }, (_, i) => `- [ ] Implementation step ${i + 1}`).join("\n");
		const content = `---
title: "Complex refactor"
type: task-execution
status: active
owner: pinch
---

## Outcome
Complete the full system refactor across all modules.

## Execution Steps
${steps}
`;

		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);

		expect(record.action).toBe("DEC");
		// Should cluster steps into groups, not use generic subtasks
		expect(record.subtasks!.some((s) => s.includes("Implementation step"))).toBe(true);
	});
});

describe("OQ-005 + OQ-007: hard-block dimensions and EXE confidence gate", () => {
	// One precondition checked, one unchecked → Context is PARTIAL (not blocked).
	// Authority + Feasibility ready (no risk indicators in execution steps).
	const softPartialTask = `---
title: "Partial-soft task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Implement the feature with reasonable defaults.

## Preconditions
- [x] Branch exists
- [ ] Tests scaffold present

## Execution Steps
- [ ] Step one
- [ ] Step two
`;

	it("does not EXE when hard-block dim (Authority) is partial — risk indicator in execution steps", () => {
		// "production deploy" in execution steps triggers Authority partial via risk scanner
		const content = `---
title: "Risky task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Ship the new feature.

## Execution Steps
- [ ] Deploy to production
`;
		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness);
		expect(record.action).not.toBe("EXE");
		expect(record.confidence).toBe("low"); // hard-block partial drops to low
	});

	it("does not EXE at default threshold (0.7) when only soft-block dims are partial", () => {
		// Unchecked preconditions → Context partial; everything else ready
		const task = parseTask(softPartialTask, "test.md");
		const readiness = assessReadiness(task);
		// No confidence config → uses default threshold 0.7
		const record = selectAction(task, readiness);
		expect(record.action).not.toBe("EXE"); // medium confidence (0.6) < 0.7 threshold
		expect(record.confidence).toBe("medium"); // OQ-005: hard-blocks ready, soft partial → medium
	});

	it("admits EXE with medium confidence when threshold is lowered below 0.6", () => {
		const task = parseTask(softPartialTask, "test.md");
		const readiness = assessReadiness(task);
		const record = selectAction(task, readiness, [], { defaultThreshold: 0.5 });
		expect(record.action).toBe("EXE"); // 0.6 >= 0.5 → admitted
		expect(record.confidence).toBe("medium");
		expect(record.reason).toMatch(/soft-dim.*partial/i); // honest about why confidence isn't high
	});

	it("blocks EXE even at high confidence when threshold is set above 1.0 (effectively off)", () => {
		const fullyReadyContent = `---
title: "Fully ready"
type: task-execution
status: active
owner: codex
---

## Outcome
Read documentation and summarize.

## Preconditions
- [x] All set

## Execution Steps
- [ ] Read docs
`;
		const task = parseTask(fullyReadyContent, "test.md");
		const readiness = assessReadiness(task);
		// Codex effectively read-only — threshold > 1.0 means EXE never admits
		const record = selectAction(task, readiness, [], {
			defaultThreshold: 0.7,
			perAgentThreshold: { codex: 1.01 },
		});
		expect(record.action).not.toBe("EXE");
	});

	it("per-agent threshold overrides default — pinch lower, claude higher", () => {
		const task = parseTask(softPartialTask, "test.md");
		const readiness = assessReadiness(task);
		const config = {
			defaultThreshold: 0.7,
			perAgentThreshold: { pinch: 0.5, claude: 0.95 },
		};
		// pinch — threshold 0.5, medium (0.6) admits
		const pinchRecord = selectAction(task, readiness, [], config);
		expect(pinchRecord.action).toBe("EXE");

		// Same task but flip owner to claude — threshold 0.95, medium fails
		const claudeContent = softPartialTask.replace("owner: pinch", "owner: claude");
		const claudeTask = parseTask(claudeContent, "test.md");
		const claudeReadiness = assessReadiness(claudeTask);
		const claudeRecord = selectAction(claudeTask, claudeReadiness, [], config);
		expect(claudeRecord.action).not.toBe("EXE");
	});

	it("recognizes Pinch's 'done' and 'resolved' as terminal statuses (DECL, not EXE)", () => {
		const cases: Array<{ status: string; label: string }> = [
			{ status: "done", label: "done" },
			{ status: "resolved", label: "resolved" },
			{ status: "DONE", label: "case-insensitive" },
			{ status: "completed", label: "legacy completed" },
			{ status: "cancelled", label: "legacy cancelled" },
		];
		for (const { status, label } of cases) {
			const content = `---
title: "Already finished — ${label}"
type: task-execution
status: ${status}
owner: pinch
---

## Outcome
Should never EXE — terminal state.

## Execution Steps
- [x] Done already
`;
			const task = parseTask(content, "test.md");
			const readiness = assessReadiness(task);
			const record = selectAction(task, readiness);
			expect(record.action).toBe("DECL");
			expect(record.terminal).toBe(true);
		}
	});

	it("hard-block BLOCKED still wins over confidence config — no per-agent unlock for blocked dims", () => {
		// Status cancelled → Feasibility blocked (terminal state caught earlier as DECL)
		// To exercise the hard-block path proper, use needs_matt_review without approval
		const content = `---
title: "Authority-blocked"
type: task-execution
status: active
owner: pinch
needs_matt_review: true
---

## Outcome
Take an action that needs Matt's signoff.

## Execution Steps
- [ ] Do the thing
`;
		const task = parseTask(content, "test.md");
		const readiness = assessReadiness(task);
		// Even with permissive config, blocked Authority must not EXE
		const record = selectAction(task, readiness, [], {
			defaultThreshold: 0.0,
			perAgentThreshold: { pinch: 0.0 },
		});
		expect(record.action).not.toBe("EXE");
	});
});
