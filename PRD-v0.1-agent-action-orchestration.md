# PRD v0.1 — Agent Action Orchestration Plugin for Obsidian

**Version**: 0.1 Spark  
**Date**: 2026-03-30  
**Status**: Draft — first cycle  
**Author**: Matt + Claude (product definition), Pinch (design partner)

---

## 1. Product Definition

An Obsidian community plugin that gives AI agents a structured way to determine, declare, and execute their best next action for any task. It replaces implicit agent decision-making with an explicit, inspectable action model that lives inside the user's vault as readable Obsidian notes.

**One-liner**: A decision framework plugin that helps AI agents pick the right next move — and makes that reasoning visible in Obsidian.

---

## 2. Problem Statement

AI agents working inside Obsidian (via OpenClaw, Claude Code, or other harnesses) face a recurring problem: **they lack a shared protocol for deciding what to do next**. Without structure, agents:

- Execute prematurely when they should ask a clarifying question
- Ask unnecessary questions when context is already available in the vault
- Fail silently on blocked tasks instead of escalating or decomposing
- Cannot communicate "I should not do this" without awkward workarounds
- Leave no inspectable trace of *why* they chose an action

The result is unpredictable agent behavior, wasted cycles, and low trust from humans reviewing agent work.

**Core insight**: The problem is not that agents lack capability — it's that they lack a lightweight decision protocol that fits inside a note-based workspace.

---

## 3. Target User

### Primary: Pinch (AI Agent)

- An AI agent operating through OpenClaw in Obsidian-heavy workflows
- Works across multiple product repos and task types
- Needs to make dozens of action decisions per session
- Benefits from structured decision traces for continuity across sessions
- Cannot rely on GUI — interacts via file reads/writes and tool calls

### Secondary: Human Operators (Matt and similar)

- Reviews agent decisions asynchronously
- Needs to understand *why* an agent took or deferred an action
- Wants to set policies (e.g., "always escalate before deleting files")
- Interacts through standard Obsidian UI — notes must be human-readable

### Tertiary: Other AI Agents

- Non-OpenClaw agents that could adopt the same protocol
- Plugin should not hardcode OpenClaw-specific assumptions

---

## 4. Jobs to Be Done

| # | Job | Actor | Current Workaround |
|---|-----|-------|--------------------|
| J1 | Determine the single best next action for a task | Agent | Ad-hoc reasoning with no structure |
| J2 | Declare chosen action with rationale before executing | Agent | Implicit — action just happens |
| J3 | Surface blockers that prevent progress | Agent | Free-text notes or silent failure |
| J4 | Check whether preconditions for execution are met | Agent | Manual context gathering each time |
| J5 | Record action history for a task | Agent/Human | Scattered across conversation logs |
| J6 | Set guardrails and escalation policies | Human | Verbal instructions or CLAUDE.md rules |
| J7 | Review and audit agent decisions asynchronously | Human | Reading chat transcripts |
| J8 | Resume a task after interruption with full context | Agent | Re-reading everything from scratch |

---

## 5. Action Model (Draft v1)

The core of the plugin is a finite set of **action types** an agent can select from. Each action has defined semantics, required fields, and exit conditions.

### 5.1 Action Types

| Action | Code | When to Use | Output |
|--------|------|-------------|--------|
| **Execute** | `EXE` | Preconditions met, task is clear, agent has capability | Result artifact + completion status |
| **Ask Clarifying Question** | `ASK` | Task is ambiguous; agent needs human/agent input to proceed | Specific question(s) with options if possible |
| **Request Missing Context** | `CTX` | Agent knows what info it needs but can't find it in vault | Named context items + where to look |
| **Decompose Task** | `DEC` | Task is too large or complex for a single action | Subtask list with dependencies |
| **Wait on Dependency** | `WAIT` | Blocked by an external event, another task, or time | What is being waited on + check condition |
| **Escalate for Approval** | `ESC` | Action exceeds agent's authority or risk tolerance | What needs approval + recommended action |
| **Decline / Push Back** | `DECL` | Task is out of scope, infeasible, or contradicts policy | Reason + suggested alternative |

### 5.2 Action Record Structure

Each action decision produces a record (stored as YAML frontmatter or structured markdown):

```yaml
action_id: ACT-20260330-001
task_ref: "TASK-042"
action_type: ASK
confidence: 0.7
rationale: "Task says 'update the schema' but doesn't specify which schema or what change"
questions:
  - "Which schema: user_profiles or user_sessions?"
  - "Is this an additive change or a migration?"
blockers: []
context_used:
  - "vault://tasks/TASK-042.md"
  - "vault://schemas/README.md"
timestamp: 2026-03-30T14:22:00Z
agent: pinch
status: pending_response
```

### 5.3 Action Selection Logic (Conceptual)

```
1. Parse task definition
2. Check for explicit policy overrides (escalation rules, etc.)
3. Assess readiness (see Section 6)
4. If not ready → select appropriate non-EXE action
5. If ready → confirm execution preconditions → EXE
6. Record action decision with rationale
```

---

## 6. Readiness as Subsystem

**Readiness is not the product — it is a supporting subsystem that feeds into action selection.**

### 6.1 Role of Readiness

Readiness assessment answers: "Can this task be executed right now?" It is one input to the action model, not the final decision. A task can be "ready" but still warrant decomposition, or "not ready" in a way that maps to different non-execute actions.

### 6.2 Readiness Dimensions

| Dimension | Question | Maps to Action |
|-----------|----------|----------------|
| **Clarity** | Is the task unambiguous? | Low clarity → `ASK` |
| **Context** | Is all needed information available? | Missing context → `CTX` |
| **Scope** | Is the task atomic enough to execute? | Too broad → `DEC` |
| **Authority** | Does the agent have permission? | Exceeds authority → `ESC` |
| **Dependencies** | Are upstream tasks/events complete? | Blocked → `WAIT` |
| **Feasibility** | Can this actually be done? | Infeasible → `DECL` |

### 6.3 Readiness Score

Each dimension gets a simple assessment: `ready`, `partial`, `blocked`. The composite readiness state determines which action types are available.

A task with all dimensions `ready` is eligible for `EXE`. Any `blocked` dimension forces a specific non-execute action. `Partial` dimensions may still allow execution with caveats.

---

## 7. Blocker Taxonomy (Draft)

Blockers are the specific reasons a task cannot proceed. They map to readiness dimensions and suggest resolution actions.

| Blocker Type | Code | Example | Resolution Action |
|--------------|------|---------|-------------------|
| Ambiguous requirement | `BLK-AMB` | "Make it better" — better how? | `ASK` |
| Missing file/context | `BLK-CTX` | Referenced doc doesn't exist in vault | `CTX` |
| Too large to execute atomically | `BLK-SCOPE` | "Refactor the entire codebase" | `DEC` |
| Awaiting human input | `BLK-HUMAN` | Needs design decision from Matt | `WAIT` or `ESC` |
| Awaiting upstream task | `BLK-DEP` | Task B depends on Task A completing | `WAIT` |
| Exceeds risk tolerance | `BLK-RISK` | Deleting production data | `ESC` |
| Policy conflict | `BLK-POL` | Contradicts a stated rule | `DECL` |
| Capability gap | `BLK-CAP` | Agent cannot access required system | `DECL` or `ESC` |
| Temporal constraint | `BLK-TIME` | "Don't do this until after the release" | `WAIT` |

---

## 8. MVP Scope

### 8.1 In Scope (v1.0)

- **Action model engine**: The 7 action types with structured records
- **Readiness checker**: 6-dimension assessment that feeds action selection
- **Blocker registry**: Typed blockers with resolution mapping
- **Task intake**: Parse task definitions from Obsidian notes (frontmatter + body)
- **Action log**: Append-only action history per task as markdown
- **Policy file support**: Human-writable rules that constrain agent behavior (e.g., "always escalate deletions")
- **Vault-native storage**: All data as readable markdown/YAML in the vault
- **Agent API surface**: Functions/commands an agent can call to assess and declare actions

### 8.2 Out of Scope (Non-Goals)

- GUI dashboards or kanban views (may come later, not MVP)
- Automated execution of tasks (plugin decides the action, agent executes)
- Multi-agent coordination or handoff protocols
- Integration with specific agent harnesses beyond file I/O
- Notifications or real-time updates
- Analytics or reporting on agent performance
- Task creation or project management features
- Pricing, monetization, or commercial features
- Calendar or scheduling integration

---

## 9. Design Principles

1. **Agent-first, human-readable**: Every artifact is optimized for programmatic parsing but must also make sense when a human opens it in Obsidian.

2. **Explicit over implicit**: An agent should never silently choose an action. Every decision gets a record with rationale.

3. **Protocol, not platform**: The action model is a specification that any agent can adopt. The plugin is one implementation.

4. **Vault is truth**: All state lives in the vault as files. No hidden databases, no external services, no state that disappears when the plugin unloads.

5. **Composable actions**: Actions can chain (DEC produces subtasks, each of which goes through the action model). The model is recursive.

6. **Minimal authority by default**: Agents start with narrow permissions. Escalation is cheap, mistakes are expensive.

7. **Resumable by design**: Any agent should be able to pick up a task mid-stream by reading the action log, without needing the original conversation context.

---

## 10. Candidate Architecture Direction

### 10.1 Vault Structure

```
vault/
  .agent-orchestrator/
    policies/
      default.md          # Default escalation and authority rules
      per-agent/           # Agent-specific overrides
    templates/
      action-record.md     # Template for action records
      task-intake.md       # Template for task definitions
  tasks/
    TASK-042.md            # Task definition with frontmatter
    TASK-042.actions.md    # Action log for this task (append-only)
```

### 10.2 Plugin Components

| Component | Responsibility |
|-----------|---------------|
| **Task Parser** | Reads task notes, extracts structured fields from frontmatter |
| **Readiness Assessor** | Evaluates 6 dimensions against task state and vault context |
| **Action Selector** | Applies action model logic + policies → recommends action |
| **Action Recorder** | Writes action records to the task's action log |
| **Policy Engine** | Reads policy files, enforces constraints on action selection |
| **Agent API** | Exposes commands/functions agents can call (assess, declare, query) |

### 10.3 Integration Model

The plugin exposes its capabilities through:

1. **Obsidian commands** (for agents that can invoke commands)
2. **File-based protocol** (agent writes a request file, plugin writes a response file — lowest common denominator)
3. **Templater/Dataview compatibility** (for human querying of action logs)

### 10.4 Open Architecture Questions

- Should action records live inline in the task note or in a separate file?
- What is the right granularity for policies — per-task, per-project, per-agent?
- How does the plugin discover tasks? Tag-based? Folder-based? Frontmatter-based?
- Should the file-based protocol use a hot folder (watch for new files) or explicit triggers?

---

## 11. What This Is Not

- **Not a task manager**: Does not create, prioritize, or schedule tasks. It receives tasks and decides what to do with them.
- **Not an agent runtime**: Does not execute actions itself. It advises on the action and records the decision.
- **Not a readiness-only tool**: Readiness is one input to a richer decision model.
- **Not OpenClaw-specific**: Designed for Pinch first, but the protocol is agent-agnostic.

---

## Next: Questions for Pinch

See `open-questions.md` for the full list. The top 3 for the next cycle are listed there.
