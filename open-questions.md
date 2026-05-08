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

### OQ-013: How aggressive should "Assess all" filtering be? (raised 2026-05-08)

**Status**: OPEN — target v0.5.0
**Problem**: `walkFolder` in `kanban-view.ts` recurses into ALL subdirectories of `taskDiscoveryFolders`. Matt's vault has `backlog/tasks/arbiter-test-suite/` (12 fixtures + README.md) which gets assessed alongside real tasks, producing noise.

**Options**:
1. **Skip well-known non-task filenames** — `README.md`, `index.md` (case-insensitive). Cheap, opaque (Matt has to know).
2. **Require minimum frontmatter for inclusion** — must have title + type + status. Cleanest signal-based filter; auto-skips README and stub files.
3. **Per-folder opt-out** — `taskDiscoveryFoldersExclude: ["**/test-suite/**", "**/_archive/**"]` in settings. Most flexible, more setting surface area.
4. **Frontmatter opt-in** — only assess files with `arbiter_assess: true` (already a field that exists for the auto-assess-on-change feature). Most explicit, but requires Pinch/Matt to set the field on every real task.

**Recommendation**: Option 2 (minimum frontmatter) as the default behavior in `walkFolder`, with Option 3 as an escape hatch for power users. Don't ship Option 4 — too invasive for existing task notes that Pinch already populates.

---

### OQ-014: Three-state visual model — which actions go where? (raised 2026-05-08)

**Status**: OPEN — target v0.5.0
**Problem**: Matt's mental model is 🔴 Red / 🟡 Yellow / 🟢 Green. Arbiter has 7 actions. Mapping isn't obvious for all of them.

**Tentative mapping**:

| Action | What it means | Color in v0.5.0 |
|---|---|---|
| EXE | Ready to execute | 🟢 Green |
| CTX | Agent can self-serve missing context | 🟢 Green (debatable — agent acts, but acts in a different mode) |
| ASK | Needs human clarification | 🟡 Yellow |
| ESC | Needs human approval (authority/risk) | 🟡 Yellow |
| DEC | Too broad — needs decomposition before action | 🔴 Red |
| WAIT | Blocked by dependency or time | 🔴 Red |
| DECL | Out of scope, infeasible, or terminal (done/cancelled) | 🔴 Red |

**Open question**: Is CTX really Green? Arbiter says "agent can act on this — go gather context first, then re-assess." That's actionable but not directly executable. Two views:
- View A (CTX = Green): Anything the agent can do alone is Green. Context-gathering is action.
- View B (CTX = Yellow): Green should mean "execute the actual task." CTX requires another assessment cycle first.

**Recommendation**: View A for v0.5.0 (CTX = Green) — it matches Matt's "ready to do something" intuition. If practice shows CTX leads to false-greens, move to Yellow in v0.6.0.

The internal 7-action model stays unchanged. Only the kanban view's visual chips and the `arbiter-read` skill's display layer get the 3-color collapse.

---

### OQ-015: Approval flag — how is it set, where does it live? (raised 2026-05-08)

**Status**: OPEN — target v0.5.0
**Problem**: Matt wants a positive "I've approved this for execution" signal, distinct from priority and from `needs_matt_review`. Currently:
- `needs_matt_review: true` = "don't dispatch, Matt hasn't reviewed" (negative gate)
- No positive "approved" signal exists.

The dispatch loop needs to know: "is this card cleared by Matt to actually run, or is it just ready in principle?"

**Recommendation**: New frontmatter field `matt_approved: true` (boolean). Plugin command "Arbiter: Toggle approved" cycles. Up Next strip in kanban view requires green AND approved before showing a card.

**Important interaction**: `needs_matt_review` and `matt_approved` are not redundant.
- `needs_matt_review: true` + `matt_approved: false` = task is gated, awaiting Matt — never dispatch
- `needs_matt_review: true` + `matt_approved: true` = task was gated, Matt approved — dispatch
- `needs_matt_review: false` + `matt_approved: false` = ready in principle but Matt hasn't opted in — don't dispatch yet
- `needs_matt_review: false` + `matt_approved: true` = full green light — dispatch

This gives Matt the "explicit opt-in to autonomy" model: the autonomous loop never silently dispatches a task Matt hasn't seen. Even green tasks need approval to run unattended.

**Alternative considered (rejected)**: Re-use `needs_matt_review` as a tri-state ("unreviewed" / "approved" / "rejected"). Rejected because the field is currently boolean and used by Pinch for the existing workflow; changing semantics would break Pinch's integration.

---

### OQ-012: Priority flag + user-action mechanism (NEW, raised 2026-05-08)

**Status**: OPEN — target v0.5.0
**Raised by**: Matt, after first successful 0.4.0 assessment in the vault.

**Problem**: Two related but distinct asks on the same day:
1. **Priority flag** — Matt wants a way to mark a task "do this first" so the dispatcher (Claude / Pinch) picks it ahead of others.
2. **User-action mechanism** — Matt wants the act of flagging to be cheap: a button, a command, or a checkbox in the card. Not "edit frontmatter manually every time."

**Common confusion to resolve up front**: Matt asked "is that putting it in the 'escalation' column?" — there is **no escalation column** in Arbiter. ESC is an *action* Arbiter selects when authority/risk dims block (mapped to `BLOCKER_TO_ACTION["risk"|"capability"]`). Priority is **orthogonal** to ESC: a high-priority task may be totally agent-doable (no ESC needed). A task that needs ESC may be low priority (just awaits eventual approval). Conflating them in one column blurs concepts that should stay separate.

---

#### Design space — three independent decisions

##### Decision A — what *is* a priority signal?

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **A1**: Reuse `urgency_date` (existing) | Past date = overdue = priority | No new field; Pinch already populates this for some tasks | Date-based only — can't say "do this regardless of date." Currently the readiness assessor doesn't actually act on past dates (comment in `readiness.ts:assessDependencies` says "handled elsewhere" but elsewhere is empty) |
| **A2**: New `priority: urgent\|high\|normal\|low` enum | 4-level ordinal | Expressive; matches common Kanban conventions | New field; choice fatigue |
| **A3**: New `priority_flagged: true` boolean | Binary on/off | Simplest | Less expressive; can't differentiate urgent vs. high |
| **A4**: New `priority_until: <ISO date>` | Time-bounded urgent flag | Self-clearing | Two dates to manage |

##### Decision B — what does priority *do*?

| Option | Effect | Risk |
|---|---|---|
| **B1**: Sort order in `/arbiter-read` output (priority-bumped cards returned first) | Pure dispatcher concern; Arbiter assessment unchanged | None — the most conservative |
| **B2**: Bypasses confidence threshold gate (priority cards admit medium-confidence EXE even at default 0.7 threshold) | Faster dispatch on Matt-flagged work | Could ship medium-confidence EXEs that fail; mostly OK because Matt flagged it |
| **B3**: Sets `arbiter_action: EXE` directly, bypassing readiness | "Just do it" override | Defeats the point of Arbiter — risk of premature execution. Only consider for cases Matt has explicitly inspected |

##### Decision C — what's the user-action mechanism?

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **C1**: Edit frontmatter manually | `priority: urgent` typed in YAML | Zero plugin work | High friction; the asked-against pattern |
| **C2**: Plugin command palette entry: "Arbiter: Toggle priority" | Cycles current note's priority field | Native Obsidian UX; no extra UI | Cmd+P → type → enter every time |
| **C3**: Status bar quick-toggle button | Click once to mark priority | Always visible; one-click | Plugin UI work; only operates on active note |
| **C4**: Inline checkbox in body: `- [ ] **Priority**` | Markdown-native | Reads well in Obsidian | Plugin scans body for checkbox state; less standard than frontmatter |
| **C5**: Status-bar action menu with several toggles (priority, defer, snooze) | Future hub | Scales to other Matt-actions | Larger feature, defer past v0.5.0 |

---

#### Recommended path (subject to Matt's call)

**A2 + B1 + C2** — i.e., new `priority: urgent\|high\|normal\|low` field (default `normal`); `/arbiter-read` sorts dispatchable cards by priority before returning; plugin adds a single command "Arbiter: Toggle priority" that cycles the current note's frontmatter value.

Rationale:
- **A2 over A1**: `urgency_date` is already there but doesn't work as a priority signal today (the assessor ignores past dates). Adding `priority` as a dedicated field separates "deadline" from "Matt says first" and avoids retrofitting the existing field.
- **B1 over B2/B3**: Conservative — Arbiter's job (assessment) stays uncoupled from the dispatcher's job (ordering). If priority ever needs to override the gate, that's a future B2 decision once we see how B1 performs.
- **C2 over C1/C3/C4**: Lowest plugin work that still gives Matt a one-keystroke action. Status bar button (C3) can come later if Cmd+P friction is real.

**Out of scope for v0.5.0** (deferred to v0.6.0+): inline checkbox parsing (C4), status-bar quick-toggle (C3), priority bypassing the confidence gate (B2).

#### Implementation sketch (when greenlit)

- `types.ts`: add `priority?: "urgent" | "high" | "normal" | "low"` to `ParsedTask`; default to `"normal"` in `parseTask` when absent.
- `task-parser.ts`: read `priority` from frontmatter (case-insensitive).
- New helper `priorityRank(p): number` — `urgent=0, high=1, normal=2, low=3`. Lower = sorted first.
- `/arbiter-read` skill (NOT in this repo — it's in `MLG.Github/.claude/skills/arbiter-read/`): after Phase 6 (capacity), sort dispatchable list by `priorityRank(card.priority)` ascending, then by some tiebreak (urgency_date or filename).
- `main.ts`: new command `arbiter:toggle-priority` that reads current note frontmatter, cycles `priority` (urgent → high → normal → low → urgent), writes back. Status bar shows current priority of active note (optional).
- Test: `arbiter-read` returns priority-flagged cards first; toggle command cycles correctly.

#### What this question explicitly does NOT propose

- A new "priority" column. The Kanban model stays at proposed → next → in-progress → done. Priority is a within-column ordering signal, not a structural one.
- An "escalation" column. ESC remains an action, not a status. Cards Arbiter scores ESC can sit in `next/` with `arbiter_action: ESC` and the dispatcher (`/arbiter-read`) skips them with a clear reason.
- Bypassing readiness assessment for priority items. Even priority items must pass the gate; priority just affects dispatch order among gate-passing cards.

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
