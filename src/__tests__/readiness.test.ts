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

describe("assessReadiness — v0.6.0 evidence atoms", () => {
	it("populates evidence on every dimension of a well-formed task", () => {
		const content = `---
title: "Well-formed task"
type: task-execution
status: active
owner: pinch
---

## Outcome
Implement feature X with tests passing.

## Preconditions
- [x] Requirements documented

## Execution Steps
- [ ] Write implementation
- [ ] Submit PR

## Done Criteria
- [ ] Tests pass
`;
		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);

		for (const dim of result.dimensions) {
			expect(dim.evidence, `${dim.dimension} should have evidence`).toBeDefined();
			expect(dim.evidence!.length, `${dim.dimension} should have ≥1 atom`).toBeGreaterThanOrEqual(1);
			for (const atom of dim.evidence!) {
				expect(["frontmatter", "body-section", "link", "policy", "missing"]).toContain(atom.kind);
				expect(["supports", "blocks", "neutral"]).toContain(atom.polarity);
				expect(typeof atom.ref).toBe("string");
				expect(atom.ref.length).toBeGreaterThan(0);
			}
		}
	});

	it("marks missing-outcome as a blocking atom on Clarity", () => {
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

		expect(clarity?.evidence).toBeDefined();
		expect(
			clarity!.evidence!.some(
				(a) => a.kind === "missing" && a.ref.includes("Outcome") && a.polarity === "blocks",
			),
		).toBe(true);
	});

	it("flags risk keywords as a blocking Authority atom", () => {
		const content = `---
title: "Deploy to production"
type: task-execution
status: active
owner: pinch
---

## Outcome
Deploy the new release to production servers.

## Execution Steps
- [ ] Run deploy script
- [ ] Verify rollout
`;
		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);
		const authority = result.dimensions.find((d) => d.dimension === "authority");

		expect(authority?.state).toBe("partial");
		expect(authority?.evidence).toBeDefined();
		const riskAtom = authority!.evidence!.find((a) => a.note?.includes("risk keywords"));
		expect(riskAtom).toBeDefined();
		expect(riskAtom!.polarity).toBe("blocks");
		expect(riskAtom!.note).toContain("deploy");
	});

	it("flags terminal status as a blocking Feasibility atom", () => {
		const content = `---
title: "Already done"
type: task-execution
status: done
owner: pinch
---

## Outcome
Done long ago.
`;
		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);
		const feasibility = result.dimensions.find((d) => d.dimension === "feasibility");

		expect(feasibility?.state).toBe("blocked");
		expect(feasibility?.evidence).toBeDefined();
		const statusAtom = feasibility!.evidence!.find(
			(a) => a.kind === "frontmatter" && a.ref === "frontmatter.status",
		);
		expect(statusAtom).toBeDefined();
		expect(statusAtom!.polarity).toBe("blocks");
		expect(statusAtom!.note).toContain("done");
	});

	it("caps Context atoms at 3 + overflow indicator when many preconditions are unchecked", () => {
		const content = `---
title: "Many unchecked"
type: task-execution
status: active
owner: pinch
---

## Outcome
Do many things.

## Preconditions
- [ ] First
- [ ] Second
- [ ] Third
- [ ] Fourth
- [ ] Fifth

## Execution Steps
- [ ] Single step
`;
		const task = parseTask(content, "test.md");
		const result = assessReadiness(task);
		const context = result.dimensions.find((d) => d.dimension === "context");

		expect(context?.evidence).toBeDefined();
		const preconditionAtoms = context!.evidence!.filter(
			(a) => a.kind === "body-section" && a.ref === "body §Preconditions",
		);
		// 3 individual + 1 "+2 more" overflow = 4 total
		expect(preconditionAtoms).toHaveLength(4);
		expect(preconditionAtoms[3].note).toContain("+2 more");
	});

	it("preserves the existing `reason` string for back-compat alongside evidence", () => {
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

		expect(typeof clarity?.reason).toBe("string");
		expect(clarity!.reason.length).toBeGreaterThan(0);
		expect(clarity!.evidence).toBeDefined();
	});
});
