# PRD — Arbiter (Agent Action Orchestration)

**Version**: 0.7 Build Execution (mid-stage)
**Plugin**: Arbiter — Agent Action Orchestration (`obsidian-arbiter`)
**Released**: v0.2.0 (last shipped 2026-05-03)
**Repo**: [mattgierhart/Arbiter](https://github.com/mattgierhart/Arbiter) (public, MIT)
**Last PRD update**: 2026-05-21
**Owner**: Matt (single-author, personal usage)

> **Scope shift from earlier cycles**: This is now a **personal-usage tool**, not a community plugin submission. KPIs around community installs / GitHub stars / external adopters from v0.3 are dropped. The acceptance bar is "Matt trusts it to run unattended in the autonomous loop." See §6.

---

## 1. Why this exists

AI agents working inside Matt's Obsidian vault — Pinch (OpenClaw/GPT-5.4), Claude Code, and OpenAI Codex — share the same files but lack a shared protocol for deciding what to do next. Without structure, agents execute prematurely, ask vague questions, fail silently on blocked tasks, or thrash on partial context. The result is wasted cycles and low trust.

Arbiter is a **deterministic decision protocol** that sits between "agent receives task" and "agent takes action." It assesses readiness across 6 dimensions, selects one of 7 action types (EXE/ASK/CTX/DEC/WAIT/ESC/DECL), writes a visible assessment into the task note, and is **the only sanctioned entry point** for autonomous dispatch from the Arbiter Kanban board.

**What's deliberately not Arbiter**: it's not a runtime (doesn't execute tasks), not an agent (no LLM calls — pure rules), not a task manager (doesn't create or schedule).

---

## 2. Lifecycle position & honest stage

PRD methodology stage: **v0.7 Build Execution, mid-stage**.

| Stage | Status | Notes |
|---|---|---|
| v0.1 Spark | ✅ Complete | See `PRD-v0.1-agent-action-orchestration.md` |
| v0.2 Market Definition | ✅ Complete | See `PRD-v0.2-market-definition.md` |
| v0.3 Commercial Model | ⚠️ Superseded | Open-source community framing dropped — see §6 |
| v0.4 User Journeys | ✅ Complete | See `PRD-v0.4-user-journeys.md` — UJ-1…UJ-5 still valid |
| v0.5 Red Team Review | 🟡 Implicit | Codex review on 2026-05-03 surfaced torn-snapshot risk → SYNC-001 contract |
| v0.6 Architecture | 🟡 Implicit | Captured in `SYNC-PROTOCOL.md` and `src/` layout — never written as standalone artifact |
| v0.7 Build Execution | 🔵 In progress | v0.2.0 released; ~96KB of TS in `src/`; Vitest test suite |
| v0.8 Deployment & Ops | ⏳ Next | BRAT-based personal release flow not yet set up |
| v0.9 GTM | ❌ N/A | Personal usage — no launch |
| v1.0 Live | ⏳ Pending | Defined as "Matt trusts it for autonomous loop dispatch" — see §10 |

The v0.1–v0.4 PRD files are preserved as **historical audit trail** under their original names. This `PRD.md` is the current source of truth and supersedes any conflict with those files.

---

## 3. What's actually built (current state)

### 3.1 Source modules (`src/`)

| Module | Purpose | Lines | Last changed |
|---|---|---|---|
| `main.ts` | Plugin entry, command registration, assess loop | 391 | 2026-05-03 |
| `action-selector.ts` | Core: maps readiness → action type, applies policies | ~22K | 2026-05-03 |
| `readiness.ts` | 6-dimension scoring (Clarity, Context, Scope, Authority, Dependencies, Feasibility) | ~10K | 2026-03-31 |
| `task-parser.ts` | Frontmatter + body parsing, body section extraction | ~6K | 2026-05-03 |
| `action-recorder.ts` | Writes `## Agent Assessment` block + machine log | ~6K | 2026-05-03 |
| `kanban-view.ts` | Visual board surface (added v0.2.0) | ~12K | 2026-04-11 |
| `policy-parser.ts` | Reads `.agent-orchestrator/policies/*.md` rule files | ~4K | 2026-03-30 |
| `sync-protocol.ts` | SYNC-001 reconciliation contract (revision pin + board debounce) | ~6.5K | 2026-05-03 |
| `settings.ts` + `settings-validator.ts` | User settings + safe migration on schema change | ~8K | 2026-05-03 |
| `types.ts` | All interface definitions | ~9K | 2026-05-03 |
| `__tests__/` | Vitest unit tests | (multiple) | 2026-05-03 |

### 3.2 Commands registered

- `Arbiter: Assess current note`
- `Arbiter: Assess task by path` (intended for agent invocation)
- `Arbiter: Show current assessment`
- `Arbiter: Create new policy`
- `Arbiter: Validate all policies`
- `Arbiter: Open Kanban view` (+ ribbon icon)

### 3.3 Settings exposed

`syncProtocolEnabled` (default off), `boardDebounceMs` (60s), `confidenceThresholdEXE`, `decompositionMaxDepth`, `policyFolderPath`, `logFolderPath`, `frontmatterPrefix` (`arbiter_`), `assessmentHeading` (`## Agent Assessment`), `autoAssessOnChange` (off), `enableMachineLog` (off).

### 3.4 What ships in the manifest

> "A structured decision protocol for AI agents. Assesses task readiness across 6 dimensions, selects from 7 action types (EXE/ASK/CTX/DEC/WAIT/ESC/DECL), writes visible assessments into your notes, and surfaces the board in a Kanban view. **Enforces Definition-of-Ready confidence thresholds and a max decomposition depth with learning feedback.** No API keys needed — runs locally, all state is plain markdown."

The bolded items resolve **OQ-006** (DEC composability via depth cap, learning feedback loop) and **partially resolve OQ-007** (DoR threshold exists; tuning is open).

---

## 4. Architecture (consolidated from `SYNC-PROTOCOL.md` and code)

```
┌─────────────────────────────────────────────────────────────────┐
│  Vault (canonical state)                                         │
│  ├── backlog/tasks/TASK-XXX.md       (frontmatter + body         │
│  │                                    + ## Agent Assessment)     │
│  ├── Kanban.md                        (board state)              │
│  ├── .agent-orchestrator/policies/    (rule files)               │
│  └── .agent-orchestrator/logs/        (optional machine log)     │
└─────────────────────────────────────────────────────────────────┘
            ▲                                        ▲
            │ writes assessment                      │ reads & dispatches
            │                                        │
┌───────────┴───────────────┐         ┌─────────────┴─────────────┐
│ Arbiter (this plugin)     │         │ External agents           │
│ ┌─────────────────────┐   │         │ ┌──────────────────────┐  │
│ │ task-parser         │   │         │ │ Claude Code          │  │
│ │   ↓                 │   │         │ │  └── /arbiter-read   │  │
│ │ readiness (6 dims)  │   │         │ │      (sanctioned     │  │
│ │   ↓                 │   │         │ │       reader skill)  │  │
│ │ action-selector     │   │         │ ├──────────────────────┤  │
│ │   ↓ (policies)      │   │         │ │ Pinch (OpenClaw)     │  │
│ │ action-recorder     │   │         │ │  └── direct file I/O │  │
│ └─────────────────────┘   │         │ ├──────────────────────┤  │
│   + sync-protocol         │         │ │ Codex (read-only)    │  │
│     (SYNC-001 contract)   │         │ │  └── via Claude      │  │
│   + kanban-view           │         │ │      /codex-* skills │  │
└───────────────────────────┘         │ └──────────────────────┘  │
                                      └───────────────────────────┘
```

### Key architecture decisions (locked)

| ID | Decision | Source |
|---|---|---|
| ARC-001 | Vault-native storage only — no external DB, no API | `decision-log.md` DEC-004 |
| ARC-002 | Action records inline in task notes; optional append-only machine log | DEC-007 (Pinch) |
| ARC-003 | Obsidian commands as primary invocation; frontmatter-reactive opt-in secondary | DEC-008 (Pinch) |
| ARC-004 | Agent-first data structures, human-readable rendering — both in same files | DEC-002 |
| ARC-005 | File-based protocol = lowest common denominator for cross-agent compat | DEC-005 |
| ARC-006 | SYNC-001 reconciliation contract (revision pin via SHA-256 + board debounce) for multi-writer safety | `SYNC-PROTOCOL.md` |
| ARC-007 | 7 action types, not 8 (PLAN folds into CTX) | DEC-010 |
| ARC-008 | Definition-of-Ready confidence thresholds + DEC max-depth as plugin-enforced floors | manifest.json |

---

## 5. User journeys (carried forward from v0.4)

UJ-1…UJ-5 from `PRD-v0.4-user-journeys.md` remain valid as-is. Brief reminder:

- **UJ-1 Happy path** — task ready → EXE → first step recommended
- **UJ-2 Blocked** — Authority blocked → ASK formulated → WAIT until human responds
- **UJ-3 Decompose** — Scope blocked → DEC into subtasks (now bounded by max-depth)
- **UJ-4 Human review** — Matt opens note, reads `## Agent Assessment`, evaluates in <2 min
- **UJ-5 Resumption** — agent reads existing assessment, picks up without rereading conversation

**New UJ-6 (added 2026-05-06): Autonomous loop dispatch**
- Trigger: Routine (cron) fires `portfolio-readiness.sh`
- Pinch consumes JSON, creates task notes in `mattgierhart/workspace` Obsidian vault
- Arbiter assesses each (rules-based, no LLM)
- Claude Code's `/arbiter-read` skill applies SYNC-001 reconciliation, validates blocked_by chains, checks `needs_matt_review` gate, enforces `agent_dispatch_hints` capacity caps
- Only `EXE`-tagged, fresh-revision tasks reach Claude dispatch
- `/portfolio-retro` captures what fired vs. what should have fired

This is now the **load-bearing case** — the one that has to work for Arbiter to be useful in personal practice.

---

## 6. Personal-usage scope (replaces v0.3 commercial model)

### 6.1 What this means in practice

| Question | Earlier answer (v0.3) | Current answer |
|---|---|---|
| Submit to Obsidian Community Plugins? | Yes (target 500+ installs) | **No.** Personal install via BRAT or manual copy. |
| Public marketing / launch? | Yes — establish protocol standard | **No.** Public repo only because GitHub Releases are the cleanest BRAT source. |
| Multi-agent conflict resolution? | Out of MVP | **Required.** SYNC-001 already addresses torn-snapshot; advisory write-locks open. |
| Optimize for "any agent" adopters? | Yes | **No.** Optimize for Pinch + Claude Code + Codex specifically, plus whatever Matt adds next. |
| Track community KPIs (stars, installs, adopters)? | Yes | **No.** Drop entirely. |
| Sync-protocol "v1.0 forever" stability? | Yes | **Soft yes** — single user means breaking changes are tractable, but try not to. |

### 6.2 Why this scope is right

Three real constraints made the community framing wrong:

1. **The plugin only matters because of the autonomous loop.** That loop is Matt-specific (his vault, his agents, his portfolio repos). Generalizing the plugin would dilute the thing that makes it load-bearing.
2. **Community submission has overhead** — registry review, support burden, semver discipline, breaking-change deprecation cycles — for zero personal upside.
3. **The honest moat was always weak** (per v0.3 §4). Trying to defend a moat we didn't have was wasted attention.

### 6.3 What we keep from v0.3

| Carried forward | Why |
|---|---|
| MIT license | Frictionless personal usage; allows future re-scope |
| Free / no SaaS | Architecture decision (vault-native) makes this implicit |
| Public GitHub repo | BRAT installs require a public repo |
| Action-quality KPIs | Still meaningful — see §7 |

---

## 7. Acceptance KPIs (revised for personal use)

### 7.1 Primary — autonomous loop reliability

| Metric | Target | Measured by |
|---|---|---|
| **Dispatch correctness** | ≥95% of `EXE` outputs Claude actually dispatches lead to successful task completion | `/portfolio-retro` weekly review |
| **False-EXE rate** | <5% | Same — count "Claude started, then hit unforeseen blocker" |
| **Torn-snapshot incidents** | 0 (with SYNC-001 enabled) | Manual incident log |
| **ASK precision** | ≥80% of ASK outputs are answerable in one Discord reply | Subjective review of last 20 ASK records |
| **Autonomous loop wake → action latency** | <90s from Routine fire to Claude dispatch (fresh-revision case) | Routine logs |

### 7.2 Secondary — Matt's confidence

| Metric | Target | Measured by |
|---|---|---|
| **Routine block survival** | ≥4 of 5 weekday morning routines complete without Matt intervention | Discord channel review |
| **Override rate** | <15% of Arbiter assessments are manually overridden | Frontmatter audit |
| **Time to triage `## Agent Assessment`** | <30s per note | Self-report |

### 7.3 Dropped from v0.3

Community installs, GitHub stars, external protocol adopters, "active integrations" — all out of scope.

---

## 8. Open questions (current status)

### Resolved or scoped-out

| ID | Status | Note |
|---|---|---|
| OQ-001 | ✅ Resolved | Action records inline + optional log |
| OQ-002 | ✅ Resolved | CLI commands primary, frontmatter-reactive secondary |
| OQ-003 | ✅ Resolved | Frontmatter + structured body |
| OQ-006 | ✅ Resolved (v0.2.0) | DEC max-depth cap + learning feedback shipped |
| OQ-008 | 🟡 Deferred — personal use doesn't need Dataview compat | Consider later if Pinch starts running Dataview queries |
| OQ-010 | 🟡 Partially resolved | SYNC-001 handles torn-snapshot; advisory locks for true concurrent dispatch deferred to §10 |
| OQ-011 | ❌ Out of scope | Not submitting to community registry |

### Still open & relevant for personal-use v1.0

| ID | Question | Why it matters now |
|---|---|---|
| **OQ-004** | Policy granularity — vault / folder / agent / task-type? | Multi-agent reality means per-agent policy is now load-bearing (e.g., "Codex is read-only, never EXE writes") |
| **OQ-005** | Are 6 readiness dimensions equally weighted, or is Authority a hard block? | Affects autonomous dispatch — most ESC cases trace to Authority. Recommend: Authority=hard block, Feasibility=hard block, others contribute weighted score |
| **OQ-007** | EXE confidence threshold — per-policy or per-agent? Default? | DoR threshold exists at plugin level; tuning per-agent (Claude Code higher than Pinch?) is the real question |
| **OQ-009** | Action records: append-only audit trail vs. amendable? | Affects retro accuracy. Recommend: latest assessment overwrites in note (current behavior); machine log is append-only (already implemented when enabled) |

These four are the targets of recommendation #3.

---

## 9. Risks (revised for personal use)

| Risk | Severity | Status / mitigation |
|---|---|---|
| Torn cross-file snapshots between Kanban and task notes | High | ✅ Mitigated by SYNC-001 (2026-05-03) |
| DEC infinite loop | Medium | ✅ Mitigated by max-depth cap (v0.2.0) |
| Two agents dispatch the same task simultaneously | Medium | 🟡 Sync-protocol detects after-the-fact; advisory `dispatched_by:` lock pattern documented but not enforced |
| Settings schema drift breaks plugin load | Low | ✅ Mitigated by `settings-validator.ts` (2026-05-03) |
| Code drifts from PRD (PRD becomes lying document) | Medium | 🟡 This document is the corrective; subsequent PRD edits MUST happen in PR-with-code, not after-the-fact |
| Plugin version installed in vault drifts from `mattgierhart/Arbiter` HEAD | Medium | ⏳ Addressed by recommendation #2 (BRAT release flow) |
| Autonomous loop has never been tested end-to-end | High | ⏳ Addressed by recommendation #1 |

---

## 10. Definition of v1.0 (personal-use)

Arbiter ships v1.0 when **all** of the following hold:

1. ✅ Code: 7 action types, 6 readiness dimensions, kanban view, sync protocol, settings validator — already shipped in v0.2.0.
2. ⏳ End-to-end autonomous loop has run successfully on ≥5 real tasks without Matt intervention beyond responding to ASKs.
3. ✅ BRAT release flow is set up — released as **v0.3.0** (2026-05-06) with workflow + release script. Matt's vault auto-updates after BRAT install.
4. 🟡 Per-agent policies work (OQ-004 deferred to v0.5.0 — design ambiguity around invoking-agent vs. owner identity needs resolving).
5. ✅ Authority + Feasibility are hard-block dimensions (OQ-005, v0.4.0): `isStructurallyExecutable` requires both ready; partial drops confidence to low.
6. ✅ Per-agent EXE confidence floors (OQ-007, v0.4.0): `confidenceThreshold` plus `perAgentExeThreshold` map; selector enforces via `passesConfidenceGate`.
7. ✅ Audit story is clear (OQ-009): see [`AUDIT.md`](AUDIT.md) — inline = current truth, machine log = append-only history.
8. ⏳ Routine + retro cadence is in place: morning Routine fires, evening (or weekly) `/portfolio-retro` runs, gaps feed back into `phase-actions.json`.

Items #2–#7 map to the three recommendations and four open questions in this PRD.

---

## 11. Forward plan (the three recommendations, in order)

### #1 Close the dispatch loop with an end-to-end test (NEXT)

**Goal**: prove the loop works before optimizing it.

**Test design**:
- Create one synthetic task note in `mattgierhart/workspace` Obsidian vault
- Trigger `portfolio-readiness.sh` manually (don't wait for cron)
- Observe Pinch creating the Arbiter task
- Confirm Arbiter assessment is written with SYNC-001 fields
- Confirm `/arbiter-read` skill in Claude Code parses correctly and either dispatches or correctly skips
- Run `/portfolio-retro` to confirm retro tooling captures it

**Acceptance**: full loop runs, retro shows expected outcome, no torn-snapshot warnings.

**Blockers**: portfolio-readiness.sh must be reachable from this Mac (it lives in MLG.Github root); `mattgierhart/workspace` vault must be in sync with iCloud.

### #2 Set up BRAT-compatible release flow

**Goal**: deploying personal updates is one command.

**Steps**:
- Verify `manifest.json`, `main.js`, `styles.css`, and `versions.json` are all build outputs that ship in releases (not committed source, except manifest)
- Create `.github/workflows/release.yml` that runs `npm run build` and uploads the three asset files to a GitHub Release on tag push
- Set up BRAT in Matt's Obsidian vault, point at `mattgierhart/Arbiter`
- Tag `v0.2.1` (or `v0.3.0` if scope warrants) as the test release; confirm BRAT pulls it

**Acceptance**: `git tag vX.Y.Z && git push --tags` results in BRAT-installable update within 5 minutes.

### #3 Resolve OQ-004, OQ-005, OQ-007, OQ-009

**Goal**: encode per-agent policy + dimension weighting + audit story so Arbiter behavior is consistent.

Concrete edits anticipated (subject to confirmation when we get there):
- `readiness.ts`: mark `authority` and `feasibility` as `hardBlock: true` dimensions; downstream `action-selector` short-circuits on either
- `policy-parser.ts`: support `applies_to_agent: claude-code | pinch | codex | "*"` field
- `action-selector.ts`: per-agent EXE confidence threshold, falling back to plugin default
- Settings: `perAgentDefaults: { agent: { exeThreshold, hardBlocks } }`
- Add a brief `AUDIT.md` at repo root explaining the inline-vs-log audit model

**Acceptance**: open-questions.md fully resolved or explicitly deferred with rationale; one new test in `__tests__/` per change; v0.3.0 release.

---

## 12. v0.5.0 Roadmap — "Clarity" (planning, raised 2026-05-08)

After the v0.4.0 install in Matt's vault, three usability concerns surfaced. This section captures the plan to address them. Open design questions are tracked as OQ-013/014/015 in `open-questions.md`.

### 12.1 Three concerns + diagnosis

| # | Matt's observation | Diagnosis |
|---|---|---|
| **1** | "Assess all" produces a list of errors — unclear if real | Two compounding issues: (a) `walkFolder` recurses into `backlog/tasks/arbiter-test-suite/` (12 fixture files + 1 README.md), assessing each one and firing one Notice per file. (b) Every successful assessment ALSO fires a Notice. Net: 31 task notes + 13 test-suite files = ~44 rapid-fire Notices, plus parse warnings on the README. The "errors" are mostly noise. |
| **2** | Can't tell which tasks are about to be executed | The kanban view groups by `arbiter_action` (EXE/ASK/CTX/etc.) but the EXE column doesn't differentiate "ready and approved and priority" from "ready, just one of many." The dispatch queue isn't visually surfaced. |
| **3** | Readiness model is too complex (7 columns) — Matt suggests 3 colors (Red/Yellow/Green) + project column + approval indicator | The 7-action model is correct internally but over-detailed for human scanning. Three buckets is enough for the human eye. |

### 12.2 Side observation worth noting

Sample assessments dated 2026-05-08T11:20 show `arbiter_action: "EXE"` on tasks with `status: done`. The `done`/`resolved` terminal-state fix shipped in v0.4.0 (commit `fe97c31`) **after** those assessments ran. To pick up the fix, **reload Obsidian** (Cmd+R or quit/reopen). Subsequent assessments will correctly DECL on `status: done` tasks.

### 12.3 v0.5.0 scope — recommended

Theme: **make the current model usable + trustworthy without changing the action model**.

| Component | Effort | Why now |
|---|---|---|
| **A. Quiet "Assess all"** | Small | Single biggest UX pain reported. Fix: silent mode in batch (no per-file Notice), single summary at end, exclude `README.md` and other non-task files via opt-in via `taskDiscoveryFolders` exclusions or skip files lacking minimum frontmatter (title + type + status). |
| **B. "Up Next" strip in Kanban view** | Medium | Top-of-view section showing the actual dispatch queue: cards that are ready AND approved AND not blocked, sorted by priority. Click to open. Makes "what runs next" obvious. |
| **C. 3-state visual readiness** | Medium | Map 7 actions to 3 colors on each card: 🟢 Green = agent-actionable (EXE, CTX); 🟡 Yellow = needs human (ASK, ESC); 🔴 Red = not actionable now (DEC, WAIT, DECL). Internal action model unchanged — only the kanban view's color system simplifies. Card detail still shows the precise action. |
| **D. Approval flag** | Small | New frontmatter field `matt_approved: true` (boolean). Plugin command "Arbiter: Toggle approved" cycles current note's flag. "Up Next" requires green AND approved; without approval, ready tasks don't auto-dispatch. |
| **E. Priority flag** | Small | OQ-012's recommendation: `priority: urgent\|high\|normal\|low`. Plugin command "Arbiter: Cycle priority". Sorts "Up Next" strip. |

**Out of scope for v0.5.0** (deferred to v0.6.0):
- **Project facet/grouping** in kanban view (Matt's "column list that reflects the related project") — simple to add as a filter chip strip, but not blocking. Can ship in v0.6.0 once 3-state + Up Next prove out.
- **OQ-004 per-agent policies** (still deferred from v0.4.0) — design ambiguity unresolved.
- **Status bar quick-toggle** for priority/approval — keystroke-via-command-palette is enough for v0.5.0; UI button can come later if friction proves real.

### 12.4 v0.5.0 dispatch-queue logic (the integration)

A card is **dispatchable** (and shows in Up Next) when ALL of the following hold:

1. `arbiter_action` ∈ {EXE} (post-3-state mapping = Green) — strict for v0.5.0; CTX may join in v0.6.0 if "agent self-serves context" is accepted as auto-dispatchable
2. `matt_approved: true` (no implicit dispatch — Matt opts in per card)
3. `arbiter_assessed_revision` matches current `task_revision` (SYNC-001 freshness)
4. No `blocked_by` chain failure (per `/arbiter-read` Phase 3)
5. `needs_matt_review: false` OR has Matt's ack (per `/arbiter-read` Phase 4)

Sort order: priority (urgent → high → normal → low) → urgency_date overdue → urgency_date soon → last_assessed (oldest first, so unattended tasks bubble up).

### 12.5 v0.5.0 release plan

- Single milestone, one git tag `0.5.0`, single GitHub Release via existing workflow
- Code changes scoped to: `kanban-view.ts` (B, C, A), `main.ts` (D, E commands), `task-parser.ts` (D, E fields), `types.ts` (D, E type definitions), 1 README skip in `walkFolder`
- Tests: 4-6 new test cases covering Up Next sort, color mapping, terminal status enforcement (already in v0.4.0), approval flag toggle
- No SoT-breaking changes — frontmatter additions are backward-compatible (default values when fields absent)

### 12.6 v0.6.0 sketch (lightly held — revisit after v0.5.0 ships)

> **Superseded 2026-05-21 by §13.** v0.6.0 has been re-scoped to the "Why" release (evidence pointers + lane-aware templates). Of the items below, project facet and status bar quick-toggle remain deferred; per-agent policies move to v0.7.0 alongside per-column gate floors; CTX-as-auto-dispatchable is reframed as a question v0.6.0's evidence visibility will answer rather than a parallel decision.

- **Project facet** in kanban view (filter chips by `project_tag` or path-derived project name)
- **OQ-004 per-agent policies** with the model decided
- **CTX as auto-dispatchable** (or not) — informed by v0.5.0 dispatch log review
- **Status bar quick-toggle** for priority/approval if Cmd+P friction is real

Past v0.6.0 is too speculative to scope.

---

## 13. v0.6.0 Roadmap — "Why" (planning, raised 2026-05-21)

After v0.5.0 ("Clarity" — Up Next strip, approval flag, 3-state colors, quiet batch assess) restores trust at the kanban *surface*, v0.6.0 makes the underlying assessment legible: every readiness score cites its evidence, and the `## Agent Assessment` block reads in the dialect of the column the card is sitting in. Theme: **the eye trusts the 3 colors; the click reveals the receipts**.

Inspiration: Routa's "lane specialists get stricter downstream" pattern — same engine, different output discipline per stage. Arbiter runs no LLM, so the engine output is unchanged; only the rendering shifts. This section supersedes the v0.6.0 sketch in §12.6.

### 13.1 Premise — two trust gaps v0.5.0 won't close

| Gap | Why v0.5.0 doesn't fix it |
|---|---|
| **"Trust the number" gap** — `clarity: 0.8` is opaque. Matt can't tell *why* it's 0.8 without re-reading the task and reconstructing the rubric. | v0.5.0 collapses 7 actions to 3 colors for scanning, but doesn't change what's inside the assessment block. The opacity persists at click-through. |
| **"Same block for every column" gap** — a card in `proposed/` and a card in `in-progress/` get structurally identical assessments, even though they need different things from Matt (gap analysis vs. dispatch envelope vs. verification). | v0.5.0's Up Next strip surfaces *which* cards are next; it doesn't change what the assessment says when you open one. |

### 13.2 In-scope

| Component | Module(s) | Effort | Acceptance |
|---|---|---|---|
| **A. Evidence pointers per readiness dimension** | `readiness.ts`, `types.ts`, `action-recorder.ts` | Medium | Each dimension's score is accompanied by 1-3 evidence atoms: `{kind, ref, note?}`. Renders as a sublist under each dimension in the assessment block. |
| **B. Lane-aware assessment templates** | `action-recorder.ts`, new `column-resolver.ts` | Medium | The `## Agent Assessment` block emits one of four templates based on the card's current column: `proposed`, `next`, `in-progress`, `done`. Engine produces the same `Readiness` + `Action` structs; the recorder picks the template. |
| **C. Column detection helper** | new `column-resolver.ts` | Small | Given a task path, returns its current column from the configured kanban roots. Used by (B). Falls back to "no column" (renders generic template) if path doesn't resolve. |
| **D. Generic-template fallback + opt-out** | `settings.ts` | Small | Setting `laneAwareAssessments: true \| false` (default `true`). When `false`, all cards get the v0.5.0-style template — preserves the simpler block as an escape hatch. |

### 13.3 Out of scope (deferred to v0.7.0 or later)

- **OQ-004 per-agent policies** — the natural home is a new policy file model, which is v0.7.0's "Promotion" release (per-column gate floors). Doing both at once risks a sprawling release.
- **Project facet / filter chip strip in kanban view** — useful, but cosmetic relative to evidence-and-lanes. Defer.
- **CTX as auto-dispatchable** — should be answered *by* v0.6.0's evidence visibility ("can I see the CTX gathering the right things?"), not in parallel with it. Revisit after v0.6.0 ships.
- **Status bar quick-toggle** — same reasoning as §12.3. Cmd+P stays sufficient.

### 13.4 Spec — evidence pointers per readiness dimension

Each dimension currently returns `{score, blocking, reasons: string[]}`. The new shape:

```ts
type EvidenceAtom = {
  kind: "frontmatter" | "body-section" | "link" | "policy" | "missing";
  ref: string;                  // e.g. "frontmatter.acceptance_criteria"
                                //      "body §Acceptance (lines 12-18)"
                                //      "[[OTHER-TASK]]"
                                //      "policy:dor-defaults.md"
                                //      "missing: done definition"
  note?: string;                // short freeform if needed
};

type DimensionResult = {
  score: number;
  blocking: boolean;
  evidence: EvidenceAtom[];     // replaces `reasons: string[]`
};
```

Rendering in the assessment block:

```markdown
### Clarity — 0.8
- ✅ Title is specific (`frontmatter.title`)
- ✅ Acceptance criteria present (`body §Acceptance, lines 12-18`)
- ⚠️ No "done definition" found (`missing: done definition`)
```

Migration: `reasons: string[]` is removed from the engine output in this release. Historical assessments already written into vault notes are not re-rendered (per ARC-002 inline = current truth, machine log = append-only history). Machine log readers must accept both shapes during the transition window.

No frontmatter schema change on task notes — evidence lives in the assessment block + machine log only.

### 13.5 Spec — lane-aware assessment templates

Four templates, selected by the card's current column.

**Template: `proposed/` — "Gap analysis"**
- Emphasis: *what's missing to make this ready*
- Headline: `Refinement needed: <top 1-2 gaps>` or `Promotion-eligible — no gaps detected`
- Dimension order: lowest-scoring blocking dimensions first
- Suppressed: dispatch envelope, first-step recommendation
- Footer: `When ready, move to next/` (or, if all v0.7.0 gates pass once shipped, `Promotion-eligible per gate policy`)

Example:

```markdown
## Agent Assessment
**Refinement needed: scope unbounded, no done definition**

Action: `DEC` (decompose) · Confidence: 0.42

### Scope — 0.3 ⛔
- ⚠️ Body mentions "auth, billing, and reporting" (`body §Goals, lines 4-6`)
- ⚠️ No subtask links (`missing: blocked_by or subtasks frontmatter`)
- ✅ Owner identified (`frontmatter.owner`)

### Clarity — 0.6
- ✅ Title is specific (`frontmatter.title`)
- ⚠️ No "done definition" found (`missing: done definition`)

[... other dimensions ...]

— When ready, move to `next/`
```

**Template: `next/` — "Dispatch envelope"**
- Emphasis: *who runs this, where, with what*
- Headline: action type + confidence + agent assignment
- Dimension order: Authority + Feasibility first (the hard-blocks from OQ-005)
- Includes: first-step recommendation, `agent_dispatch_hints` summary, blocked_by chain status
- Footer: `Approved + dispatchable` (if `matt_approved: true`) or `Awaiting approval`

Example:

```markdown
## Agent Assessment
**EXE — dispatch to claude-code · Confidence: 0.87**

### Authority — ready ✅
- ✅ Owner is Matt (`frontmatter.owner`)
- ✅ No external sign-off required (`policy:authority-defaults.md`)

### Feasibility — ready ✅
- ✅ Repo `arbiter/` reachable (`agent_dispatch_hints.workspace`)
- ✅ All `blocked_by` resolved (`[[TASK-104]] status: done`)

[... other dimensions ...]

**First step**: Add `EvidenceAtom` type to `src/types.ts` (file exists at line ~120)
**Dispatch envelope**: claude-code · branch `arbiter/v0.6.0/evidence`

— Approved + dispatchable
```

**Template: `in-progress/` — "Verification"**
- Emphasis: *what to check before marking done*
- Headline: `In flight with <agent> since <timestamp>`
- Dimension order: Feasibility evidence first (did the agent actually have what it needed?)
- Includes: done-criteria checklist (derived from acceptance criteria if present), suggested verifier
- Suppressed: re-recommending the first step
- Footer: pointer to retro on completion

**Template: `done/` — "Audit footprint"**
- Emphasis: *what was decided and what fired*
- Headline: terminal action + duration
- Dimension order: as-of-dispatch snapshot, no re-scoring
- Includes: dispatching agent, completion ack, link to retro session
- Read-only — never overwritten by re-assessment (per ARC-002 + `AUDIT.md`)

### 13.6 Integration with v0.5.0

- **3-state colors stay on the card surface.** Green/Yellow/Red mapping from §12.3 unchanged.
- **Evidence + lane template live inside the note**, revealed on click-through. No new visual density on the kanban board.
- **Up Next strip is unchanged.** Eligibility logic from §12.4 unchanged (action ∈ {EXE}, approved, fresh, unblocked, no review gate).
- **Approval flag is unchanged.** The `next/` template surfaces approval status more prominently in the headline footer, but doesn't add new approval semantics.
- **3-color and lane-template are orthogonal.** A green card in `proposed/` still gets the gap-analysis template (it's promotion-eligible but hasn't been promoted). A yellow card in `next/` still gets the dispatch-envelope template (it explains *why* dispatch is blocked).

### 13.7 Open questions raised by v0.6.0 scope

Add to `open-questions.md` as OQ-016 / OQ-017 / OQ-018:

- **OQ-016**: Source of truth for "current column" when a card has been hand-moved in `Kanban.md` but its file path hasn't moved (or vice versa). Recommendation: file path wins; SYNC-001 board debounce reconciles. Contested by Pinch's `proposed→next` move pattern — needs alignment.
- **OQ-017**: Should evidence atoms be machine-comparable across assessments (so retro can ask "did Clarity evidence change between assessment N-1 and N?"), or human-readable freeform? Recommendation: structured `{kind, ref}` is comparable; `note` is freeform.
- **OQ-018**: Lane templates assume the four-column model (`proposed/next/in-progress/done`). If a user adds intermediate columns (`review/`, `staging/`), do we generate a template, fall back to generic, or fail? Recommendation: generic fallback + warn once per session.

### 13.8 Release plan

- Single milestone, one git tag `0.6.0`, GitHub Release via existing workflow.
- Code changes scoped to: `readiness.ts` (evidence shape), `types.ts` (new types), `action-recorder.ts` (template dispatch + rendering), new `column-resolver.ts`, `settings.ts` (opt-out flag), `__tests__/` (template snapshot tests per column, evidence rendering, opt-out, column detection edge cases).
- Tests: ~10-15 new cases (4 template snapshots, evidence rendering for each dimension's success/blocking paths, opt-out fallback, column detection edge cases including OQ-016 path-vs-board conflict).
- Backward compatibility: existing assessments in vault notes are not re-rendered; new assessments use new shape. Machine log readers must accept both `reasons: string[]` (historical) and `evidence: EvidenceAtom[]` (v0.6.0+).
- No SYNC-001 contract change. No frontmatter schema change on task notes.

### 13.9 Acceptance — when v0.6.0 is done

1. Open any card in `proposed/`; the assessment block reads as gap analysis with evidence pointers on every dimension. Matt can answer "what's missing?" without re-reading the task body.
2. Open any card in `next/`; the assessment block leads with dispatch envelope and surfaces approval state in the headline footer.
3. Open any card in `in-progress/`; the assessment block reads as verification, not as re-evaluation.
4. `/portfolio-retro` can read the machine log and answer "did Clarity evidence change between assessments?" for any card with ≥2 historical assessments.
5. `laneAwareAssessments: false` falls back to v0.5.0 rendering with no visual regression.

### 13.10 Risks specific to v0.6.0

| Risk | Severity | Mitigation |
|---|---|---|
| Evidence pointers add noise instead of signal (Matt scans past them) | Medium | Cap at 3 evidence atoms per dimension; lowest-scoring dimension surfaces first; collapse passed dimensions to one-liner. |
| Column detection misfires when file is mid-move (path transient) | Medium | OQ-016 resolution + generic-template fallback + opt-out (Component D). |
| Lane templates make the block harder to scan, not easier (more structure ≠ more readable) | Medium | Snapshot tests pinned to expected length per template; if any template exceeds ~30 lines in the common case, redesign before release. |
| Migration confusion — old machine log entries with `reasons: string[]` break retro tooling | Low | Retro reader accepts both shapes; documented in `AUDIT.md` update. |

---

## 14. Session state — loop diagnosis (2026-05-06)

End-to-end dispatch loop verified at the infrastructure level. **Result: loop has never closed.** Detailed gaps:

| # | Gap | Severity | Owner |
|---|---|---|---|
| 1 | Plugin installed in vault is the **2026-04-11 build** — predates sync-protocol (2026-05-03). `~/workspace/.obsidian/plugins/obsidian-arbiter/main.js` lacks SYNC-001 fields. | 🔴 HIGH | Resolved by recommendation #2 (BRAT release) |
| 2 | **Zero of 32** cards in `~/workspace/arbiter/proposed/` have `arbiter_action` set — Arbiter has never assessed any | 🔴 HIGH | Resolved after #1 + manual assess pass |
| 3 | `next/`, `in-progress/`, `done/` columns are **empty** — no card has ever advanced | 🔴 HIGH | Resolved after #1, #2, #5 |
| 4 | Plugin `data.json` has `taskDiscoveryFolders: ["backlog/tasks"]` — does NOT include `arbiter/proposed/` where the autonomous-loop cards actually live | 🔴 HIGH | Edit `data.json` after #1 |
| 5 | No proposed→next promotion mechanism observed in vault or scripts. `/arbiter-read` SKILL.md describes Pinch moving cards "after Matt approves" — but no automation observed | 🟡 MEDIUM | Structural decision — Pinch policy + Matt ack flow |
| 6 | Resolved card (`HYG-01-fold-in-pending-repos.md`, `resolved_at: 2026-05-03`) is stuck in `proposed/` with `status: active` | 🟡 MEDIUM | Hand-clean once #5 is decided |
| 7 | No `~/workspace/arbiter/Kanban.md` exists — `/arbiter-read` Phase 2 board-debounce check degrades to "log warning and skip" | 🟡 MEDIUM | Decide: file-based debounce vs. skip-with-warning |
| 8 | `portfolio-readiness highConfidenceReadyCount: 0` (10 of 10 repos non-ready) — even with loop fixed, nothing currently dispatches | 🟡 MEDIUM | Orthogonal — strict-by-design readiness model; verify no false negatives |

### Healthy parts (confirmed)

- `bash scripts/portfolio-readiness.sh --json` runs clean, valid JSON, calibration captured (codex 0.128.0, gpt-5.5, xhigh)
- Vault plugin install structure is correct (`~/workspace/.obsidian/plugins/obsidian-arbiter/`)
- All 32 proposed cards have proper Pinch frontmatter (`arbiter_assess: true`, `capability_primary`, `needs_matt_review`, etc.) — they're well-formed inputs, just unscored
- Test suite covers all engine modules: `action-recorder`, `action-selector`, `policy-parser`, `readiness`, `sync-protocol`, `task-parser`
- `/arbiter-read` skill exists and is fully specified

### Where work resumed after diagnosis

The original recommendation order (#1 loop test → #2 BRAT → #3 P2 questions) inverts in practice because gap #1 makes a true runtime loop test impossible until current code is in the vault. New order: **#2 BRAT release first → re-run #1 runtime portion → then #3**. PRD §11 retains the original semantic ordering for the work plan; this section documents the operational reality.

---

## 15. References

| File | Role |
|---|---|
| [`README.md`](README.md) | User-facing description (Obsidian audience — slightly out-of-date with personal-use scope) |
| [`SYNC-PROTOCOL.md`](SYNC-PROTOCOL.md) | SYNC-001 normative spec |
| [`decision-log.md`](decision-log.md) | DEC-001…DEC-010 architectural decisions |
| [`open-questions.md`](open-questions.md) | OQ-001…OQ-011 with current status |
| [`naming-options.md`](naming-options.md) | Historical (resolved → "Arbiter") |
| [`PRD-v0.1-agent-action-orchestration.md`](PRD-v0.1-agent-action-orchestration.md) | Spark — preserved as audit trail |
| [`PRD-v0.2-market-definition.md`](PRD-v0.2-market-definition.md) | Market definition — preserved |
| [`PRD-v0.3-commercial-model.md`](PRD-v0.3-commercial-model.md) | Commercial model — superseded by §6 |
| [`PRD-v0.4-user-journeys.md`](PRD-v0.4-user-journeys.md) | UJs still valid; UJ-6 added in §5 |
| `MLG.Github/.claude/skills/arbiter-read/` | Claude Code's sanctioned reader |
| `MLG.Github/scripts/portfolio-readiness.sh` | Routine entry point |
| `mattgierhart/workspace` (Obsidian vault) | Where this all runs |

---

*Future PRD changes happen in this file. Increment `Last PRD update` and amend in place — do not branch into PRD-v2.md.*
