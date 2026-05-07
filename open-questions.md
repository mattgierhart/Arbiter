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

**Status**: 🟡 DEFERRED to v0.5.0 — design ambiguity needs Matt's call
**Question**: What is the right level for policies?
- Per-vault (global defaults)
- Per-project/folder
- Per-agent
- Per-task-type
- Some combination

**Why deferred**: The "per-agent" lookup model has two reasonable interpretations:
1. **Owner-based**: `applies_to_agent` matches `task.owner` (the agent that authored / will dispatch the task). Simple, but tasks like `owner: matt+claude` don't disambiguate the actual dispatcher.
2. **Invoking-agent-based**: `applies_to_agent` matches whoever invoked Arbiter at assess time. More accurate, but requires plumbing an "invoking agent" identifier through the assess command (currently absent from the API).

Picking one without Matt's input risks landing the wrong model and reworking later. v0.4.0 ships without this. v0.5.0 picks a model and implements it.

**What's already supported**: `PolicyRule.scope` already accepts `"agent"` and matches against `task.owner`. So owner-based per-agent policies work today via existing scope mechanism. The OQ-004 fix is about adding a SECOND axis (cross-cutting agent + scope), not enabling agent-aware policies at all.

---

### OQ-005: Readiness dimension weighting

**Status**: ✅ RESOLVED (2026-05-06, planned for v0.4.0)
**Resolution**: Authority and Feasibility implemented as hard-block dimensions via `HARD_BLOCK_DIMENSIONS` in `types.ts`. New helper `isStructurallyExecutable()` in `action-selector.ts` requires both hard-blocks to be `ready` AND no dim to be `blocked`. Soft-block dims (Clarity, Context, Scope, Dependencies) may be `partial` without disqualifying EXE — but that lowers confidence to medium, which then must clear the per-agent threshold (see OQ-007).

`determineConfidence()` updated: any hard-block partial → low confidence (forces non-EXE regardless of other dims).

Tests: 6 new cases in `__tests__/action-selector.test.ts` under "OQ-005 + OQ-007: hard-block dimensions and EXE confidence gate".

---

### OQ-006: Action composability rules

**Status**: ✅ RESOLVED (2026-05-03, v0.2.0)
**Resolution**: DEC produces subtasks that re-enter the action model. Infinite decomposition is prevented by the **max-depth cap** (`decompositionMaxDepth` setting). When the cap is hit, action-selector emits `DECL` with reason `decomposition-depth-exceeded` and a learning-feedback hint that the parent task may need human re-scoping. Implementation in `action-selector.ts`; surfaced in manifest.json.

---

### OQ-007: Confidence threshold for EXE

**Status**: ✅ RESOLVED (2026-05-06, planned for v0.4.0)
**Resolution**: The legacy `confidenceThreshold` setting (was effectively unused at runtime) is now the active EXE gate via `passesConfidenceGate()` in `action-selector.ts`. Confidence levels map to numeric scores: `high=1.0, medium=0.6, low=0.0` (`CONFIDENCE_SCORE` in `types.ts`).

Per-agent overrides ship as new optional setting `perAgentExeThreshold: Record<string, number>`. The selector resolves the effective threshold: `perAgentThreshold[task.owner] ?? defaultThreshold ?? 0.7`.

**Edge case handled**: when readiness is structurally executable but confidence is below threshold AND no dim has a blocker (i.e., all-ready but threshold artificially high — `codex: 1.01` use case), selector returns ASK with reason "Confidence below threshold for owner X" rather than falling back to EXE via `BLOCKER_TO_ACTION["none"]`.

**Default behavior preserved**: with the default threshold of 0.7, only high-confidence (1.0) tasks EXE — same as the old `allReady`-only rule. Loosening the bar requires explicit threshold lowering (e.g., `defaultThreshold: 0.5` admits medium-confidence EXE for soft-partial-only tasks).

Tests: see `__tests__/action-selector.test.ts` "per-agent threshold overrides" and "blocks EXE even at high confidence when threshold is set above 1.0".

---

## Priority 3 — Lower urgency / scoped out

### OQ-008: Dataview/Templater compatibility

**Status**: 🟡 DEFERRED — personal use doesn't need this yet
**Note**: Frontmatter field naming (`arbiter_*` prefix) is already Dataview-queryable as a side effect. Explicit compat (e.g., `arbiter_action_dv` index fields, Templater snippets) is deferred until Pinch starts running Dataview queries. Revisit if/when that happens.

---

### OQ-009: Action record immutability

**Status**: ✅ RESOLVED (2026-05-06, planned for v0.4.0)
**Resolution**: [`AUDIT.md`](AUDIT.md) at repo root documents the dual-artefact model.

- **Inline `## Agent Assessment` section** = current truth, overwritten on every reassess.
- **Machine log at `.agent-orchestrator/logs/assessment-log.md`** = append-only history (when `enableMachineLog: true`).

These serve different questions: inline answers "what should the agent do RIGHT NOW?" — the latest, period. Machine log answers "why did the agent do X yesterday at 14:32?" — time-stamped historical. SYNC-001's `arbiter_assessed_revision` is logged in both, so a forensic reader can verify what content Arbiter scored against.

`AUDIT.md` includes reconstruction recipes (e.g., "show me what Arbiter has ever said about TASK-042"), edge cases, and a settings reference. No code changes — current `action-recorder.ts` already implements the model correctly.

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
