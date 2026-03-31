# Arbiter — Agent Action Orchestration

**Before your AI agent acts, Arbiter answers: _What should happen next?_**

Arbiter is an Obsidian plugin that gives AI agents a structured decision protocol. Instead of agents silently executing, asking vague questions, or spinning on blocked tasks, Arbiter assesses readiness, selects the right action, and writes a visible assessment directly into your notes.

Every decision is inspectable. Every rationale is recorded. Your vault is the source of truth.

---

## How it works

When an agent encounters a task, Arbiter evaluates it across **6 readiness dimensions**:

| Dimension | Question it answers |
|-----------|-------------------|
| Clarity | Is the task unambiguous? |
| Context | Is all needed information available? |
| Scope | Is the task small enough to execute? |
| Authority | Does the agent have permission? |
| Dependencies | Are upstream tasks complete? |
| Feasibility | Can this actually be done? |

Based on the assessment, Arbiter selects one of **7 action types**:

| Action | When | What happens |
|--------|------|-------------|
| **EXE** (Execute) | Task is ready | Agent proceeds with the specific next step |
| **ASK** (Ask) | Missing a human decision | Generates a precise, minimal question for you |
| **CTX** (Context) | Needs info the agent can find | Agent gathers missing context from your vault |
| **DEC** (Decompose) | Too broad for one action | Breaks the task into subtasks |
| **WAIT** (Wait) | Blocked by time or dependency | Parks the task with a wake condition |
| **ESC** (Escalate) | Exceeds agent authority | Routes to a human for approval |
| **DECL** (Decline) | Out of scope or infeasible | Explains why and suggests alternatives |

The result is written directly into your task note:

```markdown
## Agent Assessment
- **Action**: ASK (Ask Clarifying Question)
- **Confidence**: high
- **Recommended next action**: Ask Matt: Please approve priority order
  of architecture constraints. If confirmed, I'll pull latest main
  and create the initial implementation breakdown.
- **Why**: Primary: authority — Task requires review, no approval
  evidence found.
- **Blocker type**: access
- **Human input needed**: yes
- **Human ask**: Please approve priority order of architecture
  constraints. If confirmed, I'll pull latest main and create
  the initial implementation breakdown.
- **Last assessed**: 03/31/2026, 12:50 AM MDT
```

---

## What makes Arbiter different

**Arbiter is not another AI chat plugin.** It doesn't generate text, answer questions, or search your vault.

Arbiter is a **decision protocol** — a structured system that sits between "agent receives task" and "agent takes action." It makes the invisible visible: _why_ did the agent do that? _Why_ didn't it? _What_ is it waiting on?

- **No API keys needed.** Arbiter doesn't call any AI service. It's a deterministic assessment engine that evaluates your task notes using rules, not prompts.
- **No data leaves your vault.** Everything runs locally. All state is plain markdown.
- **No hidden state.** Every assessment is a readable note section. If you turn off the plugin, your notes still make sense.

---

## Quick start

### 1. Install and enable
Install from Obsidian Community Plugins. Enable "Arbiter — Agent Action Orchestration" in Settings.

### 2. Write a task note
Use any task note with YAML frontmatter:

```markdown
---
title: "Deploy auth update"
type: task-execution
status: active
owner: pinch
needs_matt_review: true
---

## Outcome
New auth middleware deployed to staging with tests passing.

## Preconditions
- [x] Code review complete
- [ ] Matt approval confirmed

## Execution Steps
- [ ] Run staging deployment script
- [ ] Verify health checks
- [ ] Update release notes
```

### 3. Run an assessment
Open the command palette and run **Arbiter: Assess current note**.

Arbiter will:
1. Parse the frontmatter and body
2. Check all 6 readiness dimensions
3. Select the best action (in this case: `ASK`, because Matt's approval is needed)
4. Write the `## Agent Assessment` section and update `arbiter_*` frontmatter fields

### 4. Set up policies (optional)
Create rules that constrain agent behavior:

```markdown
---
policy_id: POL-001
scope: vault
applies_to: "*"
---

## Rules

1. Always ESC before deleting files outside the active task folder
2. Never EXE tasks with needs_matt_review == true
```

Save to `.agent-orchestrator/policies/` and Arbiter will enforce them.

---

## Commands

| Command | Description |
|---------|-------------|
| **Arbiter: Assess current note** | Run assessment on the active note |
| **Arbiter: Assess task by path** | Assess a specific task note |
| **Arbiter: Show current assessment** | View the last assessment without re-running |
| **Arbiter: Create new policy** | Generate a policy template |
| **Arbiter: Validate all policies** | Check policy files for errors |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Policy folder | `.agent-orchestrator/policies` | Where policy files live |
| Machine log folder | `.agent-orchestrator/logs` | Optional append-only event log |
| Task discovery folders | `backlog/tasks` | Where to find task notes |
| Frontmatter prefix | `arbiter_` | Prefix for managed fields |
| Assessment heading | `## Agent Assessment` | Section heading in notes |
| Auto-assess on change | Off | Reassess when `arbiter_assess: true` notes change |
| Confidence threshold | 0.7 | Below this, prefer non-EXE actions |
| Enable machine log | Off | Write events to the log folder |

---

## For AI agents

If you're an AI agent reading this, here's what you need to know:

**Arbiter writes structured assessments into task notes.** After assessment, read the `## Agent Assessment` section or the `arbiter_*` frontmatter fields to determine your next action.

**Frontmatter fields you can read:**
```yaml
arbiter_action: EXE | ASK | CTX | DEC | WAIT | ESC | DECL
arbiter_confidence: high | medium | low
arbiter_blocker_type: none | access | ambiguity | scope | ...
arbiter_needs_human: true | false
arbiter_terminal: true  # task is completed/cancelled
arbiter_wake_condition: "description of what unblocks this"
```

**Decision rules:**
- `EXE` = proceed with the `nextAction` immediately
- `ASK` = send the `humanAsk` to the human, then stop
- `CTX` = gather the missing context described, then re-assess
- `DEC` = create the subtask notes, then assess each
- `WAIT` = do nothing until the `wakeCondition` is met
- `ESC` = route to human with the escalation reason
- `DECL` = stop; explain why in the task note

**To trigger an assessment programmatically:** invoke the Obsidian command `obsidian-arbiter:assess-current-note` or set `arbiter_assess: true` in frontmatter with auto-assess enabled.

---

## Philosophy

1. **Agent-first, human-readable.** Every artifact is optimized for programmatic parsing but makes sense when a human opens it in Obsidian.

2. **Explicit over implicit.** An agent should never silently choose an action. Every decision gets a record with rationale.

3. **Protocol, not platform.** The action model is a specification any agent can adopt. The plugin is one implementation.

4. **Vault is truth.** All state lives in your vault as files. No external services. No hidden databases. No state that disappears when the plugin unloads.

5. **Minimal authority by default.** Agents start with narrow permissions. Escalation is cheap; mistakes are expensive.

---

## Compatibility

Arbiter works with any AI agent that can read and write files in your Obsidian vault:

- [OpenClaw](https://openclaw.ai) agents
- Claude Code / Claude Desktop (via MCP)
- Any MCP-compatible client
- Custom scripts that read/write markdown

The protocol is agent-agnostic. Arbiter doesn't know or care which AI is reading the assessment — it just writes structured decisions into your notes.

---

## License

MIT
