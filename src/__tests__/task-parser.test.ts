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
