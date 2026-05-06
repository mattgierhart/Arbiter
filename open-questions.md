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

## Priority 2 — Open & relevant for personal-use v1.0

### OQ-004: Policy granularity

**Status**: OPEN — targeted by recommendation #3 (PRD §11)
**Question**: What is the right level for policies?
- Per-vault (global defaults)
- Per-project/folder
- Per-agent
- Per-task-type
- Some combination

**Why it matters now**: Multi-agent reality (Claude Code + Pinch + Codex sharing the vault) makes per-agent policy load-bearing. Codex is read-only by design — Arbiter must be able to express "Codex never EXE writes" as a policy rule, not just a convention.

**Tentative direction**: Add `applies_to_agent: claude-code | pinch | codex | "*"` to the policy file format. Agent name comes from the assess invocation context (frontmatter field `arbiter_invoking_agent` or settings default).

---

### OQ-005: Readiness dimension weighting

**Status**: OPEN — targeted by recommendation #3
**Question**: Are all 6 readiness dimensions equally important, or should some be weighted? Is "Authority" always a hard block while "Clarity" can be partial?

**Tentative direction (per PRD §11.3)**: Authority and Feasibility are **hard blocks** — if either is `blocked`, EXE is impossible regardless of other dimensions. The remaining four (Clarity, Context, Scope, Dependencies) contribute to a weighted readiness score that feeds the EXE confidence calculation. Each dimension's hard-block flag is a property of the dimension definition, not a policy override.

---

### OQ-006: Action composability rules

**Status**: ✅ RESOLVED (2026-05-03, v0.2.0)
**Resolution**: DEC produces subtasks that re-enter the action model. Infinite decomposition is prevented by the **max-depth cap** (`decompositionMaxDepth` setting). When the cap is hit, action-selector emits `DECL` with reason `decomposition-depth-exceeded` and a learning-feedback hint that the parent task may need human re-scoping. Implementation in `action-selector.ts`; surfaced in manifest.json.

---

### OQ-007: Confidence threshold for EXE

**Status**: 🟡 PARTIALLY RESOLVED — targeted by recommendation #3
**Resolved**: Plugin-level Definition-of-Ready confidence threshold exists as `confidenceThresholdEXE` setting (v0.2.0). Below threshold, action-selector forces a non-EXE action.

**Still open**: Per-agent threshold tuning. Claude Code dispatch is higher-stakes than Pinch local action — should require higher confidence floor. Tentative direction: `perAgentDefaults` block in settings, with policy-level overrides that can raise but not lower the floor.

---

## Priority 3 — Lower urgency / scoped out

### OQ-008: Dataview/Templater compatibility

**Status**: 🟡 DEFERRED — personal use doesn't need this yet
**Note**: Frontmatter field naming (`arbiter_*` prefix) is already Dataview-queryable as a side effect. Explicit compat (e.g., `arbiter_action_dv` index fields, Templater snippets) is deferred until Pinch starts running Dataview queries. Revisit if/when that happens.

---

### OQ-009: Action record immutability

**Status**: OPEN — targeted by recommendation #3
**Tentative direction**: **Inline assessment is the latest truth — overwrites on re-assess** (current behavior, keep it). **Machine log is append-only history** when `enableMachineLog` is on (already implemented). Audit story lives in the machine log; the inline block is the human-facing snapshot. Document this clearly in a new `AUDIT.md` at repo root so retro tooling and reviewers know which file to trust for "what did we decide at time T".

---

### OQ-010: Multi-agent scenarios

**Status**: 🟡 PARTIALLY RESOLVED (SYNC-001, 2026-05-03)
**Resolved**: Torn cross-file snapshot detection via revision-pin + board debounce. Reader agents skip dispatch if `arbiter_assessed_revision !== task_revision` or if Kanban.md was modified within `boardDebounceMs`.

**Still open (intentional non-goal per SYNC-PROTOCOL.md §6)**: True concurrent dispatch (two agents on different machines deciding to EXE the same task simultaneously). Documented mitigation pattern: write `dispatched_by:` advisory frontmatter field before starting work. Not enforced — opt-in per agent. Personal-use risk is low (single-Mac most days).

---

### OQ-011: Plugin name for Obsidian community registry

**Status**: ❌ OUT OF SCOPE (PRD §6)
**Resolution**: Not submitting to community registry. Personal usage via BRAT instead. Plugin name `obsidian-arbiter` (display: "Arbiter — Agent Action Orchestration") is locked for the GitHub Releases / BRAT path; community-registry uniqueness check is moot. Original candidates remain in `naming-options.md` for historical reference only.

---

*Add new questions above this line in the appropriate priority bucket. Update status fields when work changes their state. Cross-reference PRD.md §10 (definition of v1.0) when closing items.*
