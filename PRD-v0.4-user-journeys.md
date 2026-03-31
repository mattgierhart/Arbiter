# PRD v0.4 — User Journeys

**Plugin**: Arbiter — Agent Action Orchestration  
**Date**: 2026-03-30  
**Status**: Complete

---

## 1. Personas

### P1: Pinch (Primary — AI Agent)

- **Role**: AI agent operating through OpenClaw in Obsidian-heavy workflows
- **Model**: GPT-5.4 via OpenClaw gateway
- **Interaction mode**: CLI commands, file reads/writes, chat messages
- **Work surface**: Obsidian vault with structured task notes, Kanban board, daily notes
- **Key behavior**: Makes dozens of action decisions per session across multiple product repos
- **Pain point**: Wastes cycles on blocked tasks, executes prematurely, or asks vague questions
- **Success looks like**: Fast, accurate "Can I act? What's the first step? If not, what's missing?" answers

### P2: Matt (Secondary — Human Operator)

- **Role**: Product owner / technical lead reviewing agent work asynchronously
- **Interaction mode**: Obsidian UI (reading notes), chat with Pinch
- **Work surface**: Same vault — reviews task notes, Kanban board, daily summaries
- **Key behavior**: Sets policies, reviews decisions, provides missing inputs when asked
- **Pain point**: Reading chat transcripts to understand why an agent did/didn't do something
- **Success looks like**: Opens a task note, sees clear `## Agent Assessment` with rationale, responds to precise asks

### P3: External Agent (Tertiary — Other AI)

- **Role**: Non-OpenClaw agent (Claude Code, Codex, custom MCP client) that could adopt the protocol
- **Interaction mode**: File I/O only (reads/writes markdown in the vault)
- **Key behavior**: Needs a standardized way to declare actions without OpenClaw-specific tooling
- **Pain point**: No shared protocol — each agent invents its own decision format
- **Success looks like**: Reads Arbiter spec, writes conformant action records, interoperates with Pinch's workflow

---

## 2. User Journeys

### UJ-1: Happy Path — Task is Ready to Execute

**Actor**: Pinch  
**Trigger**: Receives task from Matt via chat, Kanban card, or task note  
**Goal**: Determine task is executable and identify the exact first step

```
Step 1: DISCOVER TASK
  Pinch reads Kanban.md or opens task note
  Input: backlog/tasks/TASK-042.md
  
Step 2: INVOKE ARBITER
  Command: obsidian arbiter:assess-task path="backlog/tasks/TASK-042.md"
  Arbiter reads: task frontmatter, body, linked context files
  
Step 3: READINESS CHECK
  Arbiter evaluates 6 dimensions:
    Clarity: ready (task is unambiguous)
    Context: ready (all referenced files exist)
    Scope: ready (task is atomic enough)
    Authority: ready (within agent permissions)
    Dependencies: ready (no upstream blockers)
    Feasibility: ready (agent has required capability)
  
Step 4: ACTION SELECTION
  All dimensions ready → EXE
  Arbiter checks policy files → no overrides
  
Step 5: WRITE ASSESSMENT
  Arbiter writes to task note:
  - Frontmatter: arbiter_action: EXE, arbiter_confidence: high
  - Inline: ## Agent Assessment with rationale and exact next step
  
Step 6: AGENT EXECUTES
  Pinch reads the assessment, performs the recommended first step
  Updates task note with progress
  
Step 7: RESOLUTION
  Task note updated with evidence
  Kanban card moved
  Daily note linked
```

**Value moment**: Step 5 — Pinch gets a clear "go" with specific first action in <5 seconds.

---

### UJ-2: Blocked Path — Missing Human Input

**Actor**: Pinch  
**Trigger**: Opens task that requires a decision only Matt can make  
**Goal**: Formulate precise ask, park task cleanly, don't thrash

```
Step 1: DISCOVER TASK
  Pinch reads backlog/tasks/Gemini-Downgrade.md
  
Step 2: INVOKE ARBITER
  Command: obsidian arbiter:assess-task path="backlog/tasks/Gemini-Downgrade.md"
  
Step 3: READINESS CHECK
  Clarity: ready
  Context: partial (billing access unknown)
  Scope: ready
  Authority: blocked (requires billing portal access Pinch doesn't have)
  Dependencies: ready
  Feasibility: partial (depends on Authority)
  
Step 4: ACTION SELECTION
  Authority blocked → ASK
  Arbiter formulates: specific question + options if possible
  
Step 5: WRITE ASSESSMENT
  Inline: ## Agent Assessment
    Action: ASK
    Human ask: "Please confirm target Gemini plan tier and complete 
    the downgrade in the billing portal, or grant billing access."
    Blocker type: access
  
Step 6: AGENT SENDS ASK
  Pinch sends the precise ask to Matt via chat
  Does NOT keep reprocessing the task
  
Step 7: WAIT STATE
  Task note updated with arbiter_action: WAIT
  Wake condition: "Matt responds with plan tier or completes downgrade"
  Kanban card → "Waiting on Matt"
```

**Value moment**: Step 5 — Instead of vague "I'm blocked," Pinch sends Matt one precise, actionable question.

---

### UJ-3: Complex Task — Needs Decomposition

**Actor**: Pinch  
**Trigger**: Receives broad task like "Refactor the auth middleware"  
**Goal**: Break into executable subtasks before attempting work

```
Step 1: DISCOVER TASK
  Task note says: "Refactor auth middleware for new compliance requirements"
  
Step 2: INVOKE ARBITER
  Command: obsidian arbiter:assess-task path="backlog/tasks/auth-refactor.md"
  
Step 3: READINESS CHECK
  Clarity: ready (compliance requirements are documented)
  Context: ready
  Scope: blocked (too broad for single action)
  Authority: ready
  Dependencies: ready
  Feasibility: ready
  
Step 4: ACTION SELECTION
  Scope blocked → DEC
  
Step 5: WRITE ASSESSMENT
  Inline: ## Agent Assessment
    Action: DEC
    Reason: Task scope too broad for atomic execution
    Subtasks:
      1. Audit current auth middleware for compliance gaps
      2. Design new session token storage pattern
      3. Implement migration from old to new pattern
      4. Update tests for new auth flow
    Each subtask gets its own note → enters Arbiter cycle independently
  
Step 6: SUBTASK CREATION
  Pinch creates subtask notes
  Each goes through assess → select → execute cycle
```

**Value moment**: Step 5 — Prevents premature execution of a task that would fail or produce bad results.

---

### UJ-4: Human Reviews Agent Decision

**Actor**: Matt  
**Trigger**: Opens Obsidian to check on agent progress  
**Goal**: Understand what Pinch decided and why, in under 2 minutes

```
Step 1: OPEN TASK NOTE
  Matt opens backlog/tasks/TASK-042.md in Obsidian
  
Step 2: READ ASSESSMENT
  Scrolls to ## Agent Assessment section
  Sees: action type, rationale, confidence, blocker info
  
Step 3: EVALUATE
  If agrees → no action needed, Pinch continues
  If disagrees → edits the note or sends Pinch a correction
  If ASK pending → answers the question inline or via chat
  
Step 4: POLICY UPDATE (optional)
  If a pattern emerges (e.g., "Pinch keeps trying to execute 
  billing tasks"), Matt writes a policy:
  .agent-orchestrator/policies/billing.md:
    "Always ESC tasks involving billing portal access"
```

**Value moment**: Step 2 — Matt gets full context in one glance without reading chat logs.

---

### UJ-5: Session Resumption

**Actor**: Pinch  
**Trigger**: New session begins, needs to pick up where previous session left off  
**Goal**: Resume work without re-reading entire conversation history

```
Step 1: SCAN ACTIVE TASKS
  Read Kanban.md for in-progress and waiting cards
  
Step 2: READ ASSESSMENTS
  For each active task, read ## Agent Assessment
  Instantly know: what action was selected, what's pending, what's next
  
Step 3: TRIAGE
  EXE tasks → resume execution
  WAIT tasks → check wake conditions
  ASK tasks → check if human responded
  
Step 4: CONTINUE
  Pick up the highest-priority executable task and proceed
```

**Value moment**: Step 2 — Full context recovery in seconds, not minutes.

---

## 3. Screen Flows (Plugin UI)

Arbiter is primarily a **headless plugin** (no GUI required for core function). However, it exposes these surfaces:

### SF-1: Settings Tab

Standard Obsidian plugin settings panel:
- **Policy folder path**: Default `.agent-orchestrator/policies/`
- **Log folder path**: Default `.agent-orchestrator/logs/` (optional machine log)
- **Task discovery**: How Arbiter finds tasks — folder-based (`backlog/tasks/`), tag-based, or frontmatter-based
- **Frontmatter prefix**: Default `arbiter_` — configurable to avoid conflicts
- **Assessment section heading**: Default `## Agent Assessment`
- **Auto-assess on file change**: Toggle for frontmatter-reactive mode
- **Confidence threshold for EXE**: Default `0.7` — below this, suggest non-EXE action

### SF-2: Command Palette Commands

| Command | Description |
|---------|-------------|
| `Arbiter: Assess current note` | Run readiness + action selection on the active note |
| `Arbiter: Assess task by path` | Assess a specific task note (for CLI/agent use) |
| `Arbiter: Show assessment history` | Display past assessments for current note (from machine log) |
| `Arbiter: Create policy` | Open a new policy file from template |
| `Arbiter: Validate policies` | Check all policy files for syntax/logic errors |

### SF-3: Status Bar (Optional)

Minimal status bar widget showing:
- Last assessment result: `Arbiter: EXE ✓` or `Arbiter: WAIT ⏳`
- Click to jump to `## Agent Assessment` section

### SF-4: Inline Assessment Block

Not a UI screen — this is the markdown block that Arbiter writes into task notes:

```markdown
## Agent Assessment
- **Action**: EXE | ASK | CTX | DEC | WAIT | ESC | DECL
- **Confidence**: high | medium | low
- **Recommended next action**: [specific, actionable step]
- **Why**: [1-2 sentence rationale]
- **Blocker type**: none | access | time | scope | ambiguity | dependency | policy | capability
- **Human input needed**: yes | no
- **Last assessed**: 2026-03-30 20:50 MDT
```

### SF-5: Policy File Format

```markdown
---
policy_id: POL-001
scope: vault  # vault | folder | agent | task-type
applies_to: "*"
---

## Rules

1. Always ESC before deleting files outside the active task folder
2. Always ASK before modifying files owned by another agent
3. Never EXE tasks with `needs_matt_review: true` unless Matt has responded in the note
4. WAIT threshold: if urgency_date is >7 days away and no explicit priority, defer
```

---

## 4. Task Frontmatter Schema (Arbiter-aware)

### Required fields (from existing Pinch format)
```yaml
title: "Task title"
type: task-execution | task-research
status: active | waiting | completed | cancelled
owner: pinch | matt | <agent-name>
```

### Optional existing fields (Arbiter reads but doesn't require)
```yaml
capability_primary: software-dev-management | research-synthesis | ...
needs_matt_review: true | false
urgency_date: 2026-03-30
project_tag: [tag1, tag2]
```

### Arbiter-managed fields (plugin writes these)
```yaml
arbiter_action: EXE | ASK | CTX | DEC | WAIT | ESC | DECL
arbiter_confidence: high | medium | low
arbiter_blocker_type: none | access | time | scope | ambiguity | dependency | policy | capability
arbiter_needs_human: true | false
arbiter_last_assessed: 2026-03-30T20:50:00-06:00
arbiter_wake_condition: "description of what unblocks this task"
arbiter_assess: true | false  # opt-in trigger for reactive mode
```

---

## 5. Action State Machine

```
                    ┌─────────────┐
                    │  TASK NOTE   │
                    │  (incoming)  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   ASSESS    │◄──── arbiter:assess-task
                    │  (readiness │      arbiter:assess-current-note
                    │   check)    │      frontmatter trigger
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         All ready    Some partial   Any blocked
              │            │            │
        ┌─────▼─────┐     │     ┌──────▼──────┐
        │    EXE    │     │     │ Map blocker  │
        │ (execute) │     │     │ to action    │
        └─────┬─────┘     │     └──────┬──────┘
              │            │            │
              │      ┌─────▼─────┐     │
              │      │  EXE with │     ├──► ASK  (ambiguity)
              │      │  caveats  │     ├──► CTX  (missing info)
              │      └─────┬─────┘     ├──► DEC  (too broad)
              │            │           ├──► WAIT (dependency/time)
              │            │           ├──► ESC  (authority/risk)
              │            │           └──► DECL (infeasible/policy)
              │            │
              └─────┬──────┘
                    │
             ┌──────▼──────┐
             │   RECORD    │
             │ (write to   │
             │  task note)  │
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │   AGENT     │
             │   ACTS      │
             │ (outside    │
             │  Arbiter)   │
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │  WRITEBACK  │
             │ (update     │
             │  task note) │
             └─────────────┘
```

---

## 6. Integration Points

| System | How Arbiter connects |
|--------|---------------------|
| **OpenClaw CLI** | `obsidian arbiter:assess-task path="..."` via Obsidian command URI or obsidian-cli |
| **Obsidian Kanban** | Reads Kanban.md for task discovery; Pinch manually updates card state |
| **Dataview** | Arbiter frontmatter fields are Dataview-queryable by design |
| **Templater** | Policy and task templates can use Templater syntax |
| **MCP** | Future: expose Arbiter as MCP tool server for external agents |
| **Git** | Action records in markdown = full git history of decisions |

---

## 7. V0.4 Checkpoint Summary

### What we know
- Product is well-defined: 7-action orchestration protocol for AI agents in Obsidian
- Primary user (Pinch) has validated the action model, invocation pattern, and data format
- No existing competition in this specific niche
- Open source, community plugin
- Five user journeys cover the core workflows
- Plugin is primarily headless with CLI commands as primary interface

### What's ready for build
- Task frontmatter schema
- Action record format (inline + optional log)
- Command interface specification
- Policy file format
- Readiness assessment dimensions
- State machine logic

### Open items for architecture (v0.6)
- Obsidian plugin API specifics (command registration, file watching, settings)
- TypeScript project structure
- Testing strategy (how to test without full Obsidian runtime)
- Whether to ship as single file or modular components
