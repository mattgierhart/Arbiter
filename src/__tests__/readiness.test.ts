import { describe, it, expect } from "vitest";
import { assessReadiness } from "../readiness";
import { parseTask } from "../task-parser";

describe("assessReadiness", () => {
	it("returns all ready for a well-formed task", () => {
		const content = `---
title: "Simple executable task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Complete the implementation of feature X with tests passing.

## Preconditions
- [x] Requirements documented
- [x] Branch created

## Execution Steps
- [ ] Write implementation
- [ ] Write tests
- [ ] Submit PR

## Done Criteria
- [ ] Tests pass
- [ ] PR approved
`;

		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);

		expect(result.allReady).toBe(true);
		expect(result.anyBlocked).toBe(false);
		expect(result.blockedDimensions).toHaveLength(0);
	});

	it("detects blocked clarity when no outcome", () => {
		const content = `---
title: "Vague task"
type: task-execution
status: active
owner: pinch
---

Do stuff.
`;

		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);

		const clarity = result.dimensions.find((d) => d.dimension === "clarity");
		expect(clarity?.state).not.toBe("ready");
	});

	it("detects blocked authority when needs_matt_review is true", () => {
		const content = `---
title: "Review needed task"
type: task-execution
status: active
owner: pinch
needs_matt_review: true
---

## Outcome
Deploy the new auth system to production.
`;

		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);

		const authority = result.dimensions.find((d) => d.dimension === "authority");
		expect(authority?.state).toBe("blocked");
	});

	it("detects scope issues with many execution steps", () => {
		const steps = Array.from({ length: 10 }, (_, i) => `- [ ] Step ${i + 1}`).join("\n");
		const content = `---
title: "Big task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Complete a very large refactoring effort.

## Execution Steps
${steps}
`;

		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);

		const scope = result.dimensions.find((d) => d.dimension === "scope");
		expect(scope?.state).toBe("blocked");
	});

	it("detects blocked feasibility for cancelled tasks", () => {
		const content = `---
title: "Cancelled task"
type: task-execution
status: cancelled
owner: pinch
---

## Outcome
This was going to be great.
`;

		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);

		const feasibility = result.dimensions.find((d) => d.dimension === "feasibility");
		expect(feasibility?.state).toBe("blocked");
	});

	it("detects unchecked preconditions as context issues", () => {
		const content = `---
title: "Task with unmet preconditions"
type: task-execution
status: active
owner: pinch
---

## Outcome
Build the integration layer.

## Preconditions
- [ ] API documentation reviewed
- [ ] Access credentials obtained
- [ ] Test environment ready
`;

		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);

		const context = result.dimensions.find((d) => d.dimension === "context");
		expect(context?.state).not.toBe("ready");
	});
});
