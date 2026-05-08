import { describe, it, expect } from "vitest";
import { parseFrontmatter, parseTask } from "../task-parser";

describe("parseFrontmatter", () => {
	it("parses basic frontmatter", () => {
		const content = `---
title: "Test task"
type: task-execution
status: active
owner: pinch
---

# Body content`;

		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter.title).toBe("Test task");
		expect(frontmatter.type).toBe("task-execution");
		expect(frontmatter.status).toBe("active");
		expect(frontmatter.owner).toBe("pinch");
		expect(body).toContain("# Body content");
	});

	it("handles boolean values", () => {
		const content = `---
needs_matt_review: true
arbiter_assess: false
---
body`;

		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.needs_matt_review).toBe(true);
		expect(frontmatter.arbiter_assess).toBe(false);
	});

	it("handles array values", () => {
		const content = `---
project_tag: [gear-heart, pinch]
---
body`;

		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.project_tag).toEqual(["gear-heart", "pinch"]);
	});

	it("returns empty frontmatter for content without frontmatter", () => {
		const content = "# Just a heading\n\nSome text.";
		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe(content);
	});
});

describe("parseTask", () => {
	const FULL_TASK = `---
title: "OriginStamp: Begin Epic 1 development"
type: task-execution
status: active
owner: Pinch
capability_primary: software-dev-management
needs_matt_review: true
urgency_date: 2026-02-29
project_tag: [gear-heart]
---

# Task

## Outcome
- Concrete result expected: Epic 1 kickoff completed with first executable tasks in progress.

## Preconditions
- [ ] PRD + epics reviewed in local repo
- [x] CI baseline understood
- [ ] No blocker unresolved

## Execution Steps
- [ ] Pull latest main
- [ ] Define Epic 1 task breakdown (3–7 tasks)
- [ ] Create implementation cards

## Validation
- How we confirm done: Epic 1 has task list.

## Risks
- Trigger: unresolved architecture constraints

## Hand-off
- If Matt executes next, approve priority order.

## Done Criteria
- [ ] Outcome achieved
- [ ] Validation captured
- [ ] Kanban card moved
`;

	it("parses a full task note", () => {
		const task = parseTask(FULL_TASK, "backlog/tasks/test.md");
		expect(task.title).toBe("OriginStamp: Begin Epic 1 development");
		expect(task.type).toBe("task-execution");
		expect(task.status).toBe("active");
		expect(task.owner).toBe("Pinch");
		expect(task.needsMattReview).toBe(true);
		expect(task.urgencyDate).toBe("2026-02-29");
		expect(task.projectTag).toEqual(["gear-heart"]);
	});

	it("parses preconditions with check states", () => {
		const task = parseTask(FULL_TASK, "test.md");
		expect(task.sections.preconditions).toHaveLength(3);
		expect(task.sections.preconditions![0].checked).toBe(false);
		expect(task.sections.preconditions![1].checked).toBe(true);
		expect(task.sections.preconditions![1].text).toBe("CI baseline understood");
	});

	it("parses execution steps", () => {
		const task = parseTask(FULL_TASK, "test.md");
		expect(task.sections.executionSteps).toHaveLength(3);
		expect(task.sections.executionSteps![0].text).toBe("Pull latest main");
	});

	it("parses done criteria", () => {
		const task = parseTask(FULL_TASK, "test.md");
		expect(task.sections.doneCriteria).toHaveLength(3);
	});

	it("parses outcome section", () => {
		const task = parseTask(FULL_TASK, "test.md");
		expect(task.sections.outcome).toContain("Epic 1 kickoff");
	});

	it("handles minimal task note", () => {
		const minimal = `---
title: "Quick task"
---
Do the thing.`;

		const task = parseTask(minimal, "test.md");
		expect(task.title).toBe("Quick task");
		expect(task.type).toBe("task-execution");
		expect(task.status).toBe("active");
		expect(task.owner).toBe("unknown");
	});
});

describe("v0.5.0 fields: matt_approved and priority", () => {
	it("parses matt_approved as boolean", () => {
		const content = `---
title: "Approved task"
type: task-execution
status: active
owner: matt
matt_approved: true
---
body`;
		const task = parseTask(content, "test.md");
		expect(task.mattApproved).toBe(true);
	});

	it("treats missing matt_approved as false", () => {
		const content = `---
title: "No approval flag"
type: task-execution
status: active
owner: matt
---
body`;
		const task = parseTask(content, "test.md");
		expect(task.mattApproved).toBe(false);
	});

	it("parses priority enum (urgent/high/normal/low)", () => {
		for (const p of ["urgent", "high", "normal", "low"]) {
			const content = `---
title: "Priority test"
type: task-execution
status: active
owner: matt
priority: ${p}
---
body`;
			const task = parseTask(content, "test.md");
			expect(task.priority).toBe(p);
		}
	});

	it("returns undefined for invalid priority values", () => {
		const content = `---
title: "Invalid priority"
type: task-execution
status: active
owner: matt
priority: super-urgent
---
body`;
		const task = parseTask(content, "test.md");
		expect(task.priority).toBeUndefined();
	});

	it("returns undefined when priority is absent", () => {
		const content = `---
title: "No priority"
type: task-execution
status: active
owner: matt
---
body`;
		const task = parseTask(content, "test.md");
		expect(task.priority).toBeUndefined();
	});

	it("priority is case-insensitive", () => {
		const content = `---
title: "Case test"
type: task-execution
status: active
owner: matt
priority: URGENT
---
body`;
		const task = parseTask(content, "test.md");
		expect(task.priority).toBe("urgent");
	});
});
