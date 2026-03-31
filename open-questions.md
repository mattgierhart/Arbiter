# Open Questions — Agent Action Orchestration Plugin

## Priority 1 — Block next PRD cycle if unresolved

### OQ-001: Action record location — inline vs. separate file?

**Status**: RESOLVED (2026-03-30)  
**Decision**: A (inline) with optional C (centralized machine log).  
**Details**: Latest action record lives inline in task note under `## Agent Assessment`. Optional append-only event log in `.agent-orchestrator/logs/` for machine indexing/debugging. Task note is canonical human-facing truth.  
**Decided by**: Pinch.

---

### OQ-002: How does Pinch actually want to invoke action assessment?

**Status**: RESOLVED (2026-03-30)  
**Decision**: B (Obsidian CLI commands) primary, C (frontmatter-reactive) secondary.  
**Details**: Primary: explicit CLI commands like `arbiter:assess-task path="..."`. Secondary: opt-in frontmatter field `arbiter_assess: true` triggers plugin reaction. Hot folder (A) rejected — too indirect for Obsidian-native work.  
**Decided by**: Pinch.

---

### OQ-003: What does Pinch's current task intake look like?

**Status**: RESOLVED (2026-03-30)  
**Decision**: Tasks use structured frontmatter + body with typed templates.  
**Details**: Tasks come from Kanban cards, dedicated notes in `backlog/tasks/`, and chat. Frontmatter includes: title, type (task-execution|task-research), status, owner, capability_primary, needs_matt_review, urgency_date, project_tag. Body has sections: Task, Outcome, Preconditions, Execution Steps, Validation, Risks, Hand-off, Done Criteria. Pinch provided two full real-world examples.  
**Decided by**: Pinch.

---

## Priority 2 — Needed before architecture (v0.6)

### OQ-004: Policy granularity

What is the right level for policies?
- Per-vault (global defaults)
- Per-project/folder
- Per-agent
- Per-task-type
- Some combination

### OQ-005: Readiness dimension weighting

Are all 6 readiness dimensions equally important, or should some be weighted? For example, is "Authority" always a hard block while "Clarity" can be partial?

### OQ-006: Action composability rules

When a `DEC` (decompose) action produces subtasks, do those subtasks automatically enter the action model? What prevents infinite decomposition?

### OQ-007: Confidence threshold for EXE

The action record includes a `confidence` field. Is there a threshold below which an agent should not select `EXE`? Who sets it — the agent, the policy, or the plugin?

---

## Priority 3 — Needed before build (v0.7)

### OQ-008: Dataview/Templater compatibility

Should the plugin explicitly produce Dataview-queryable frontmatter? This helps humans but adds constraints on field naming.

### OQ-009: Action record immutability

Are action records truly append-only (for audit), or can they be amended (e.g., marking a question as answered)?

### OQ-010: Multi-agent scenarios

If two agents assess the same task, how are conflicts handled? Is this MVP or post-MVP?

### OQ-011: Plugin name for Obsidian community registry

See `naming-options.md` for candidates. Needs to be unique in the registry and clearly communicate purpose.

---

*Add new questions above the Priority 3 section or in the appropriate priority bucket.*
