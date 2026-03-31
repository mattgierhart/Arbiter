import { describe, it, expect } from "vitest";
import { parsePolicy } from "../policy-parser";

describe("parsePolicy", () => {
	it("parses a valid policy file", () => {
		const content = `---
policy_id: POL-001
scope: vault
applies_to: "*"
---

## Rules

1. Always ESC before deleting production files
2. Always ASK before modifying shared configs
`;

		const policy = parsePolicy(content);
		expect(policy).not.toBeNull();
		expect(policy!.id).toBe("POL-001");
		expect(policy!.scope).toBe("vault");
		expect(policy!.rules).toHaveLength(2);
		expect(policy!.rules[0].action).toBe("ESC");
		expect(policy!.rules[1].action).toBe("ASK");
	});

	it("parses Never rules", () => {
		const content = `---
policy_id: POL-002
scope: vault
applies_to: "*"
---

## Rules

1. Never EXE tasks with needs_matt_review == true
`;

		const policy = parsePolicy(content);
		expect(policy).not.toBeNull();
		expect(policy!.rules).toHaveLength(1);
		// "Never EXE" should map to ESC
		expect(policy!.rules[0].action).toBe("ESC");
	});

	it("returns null for content without Rules section", () => {
		const content = `---
policy_id: POL-003
scope: vault
applies_to: "*"
---

Just some text without a rules section.
`;

		const policy = parsePolicy(content);
		expect(policy).toBeNull();
	});

	it("returns null for empty rules section", () => {
		const content = `---
policy_id: POL-004
scope: vault
applies_to: "*"
---

## Rules

No actual rule lines here, just text.
`;

		const policy = parsePolicy(content);
		expect(policy).toBeNull();
	});

	it("handles bullet-style rules", () => {
		const content = `---
policy_id: POL-005
scope: agent
applies_to: pinch
---

## Rules

- Always WAIT if urgency_date contains 2027
- Always ESC when title contains production
`;

		const policy = parsePolicy(content);
		expect(policy).not.toBeNull();
		expect(policy!.rules).toHaveLength(2);
		expect(policy!.scope).toBe("agent");
	});
});
