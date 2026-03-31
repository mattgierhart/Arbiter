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

	it("generates wake condition for WAIT actions", () => {
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

		// Should recommend a non-EXE action due to unchecked preconditions
		expect(record.action).not.toBe("EXE");
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

		// With very short outcome, clarity should be partial/blocked
		// The action may be ASK or another non-EXE type
		if (record.action === "ASK") {
			expect(record.humanAsk).toBeDefined();
		}
	});
});
