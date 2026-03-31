---
name: Arbiter plugin project context
description: Open-source Obsidian plugin for AI agent action orchestration — key decisions, user preferences, and competitive positioning
type: project
---

## Product: Arbiter (obsidian-arbiter)

Open-source Obsidian community plugin for AI agent action orchestration. Gives agents a structured protocol to decide next actions with inspectable reasoning stored as vault-native markdown.

**Why:** AI agents in Obsidian lack a shared protocol for deciding what to do next, leading to premature execution, unnecessary questions, and silent failures.

**How to apply:** All design decisions should prioritize agent-first (Pinch via OpenClaw), vault-native storage, and the 7-action model (EXE, ASK, CTX, DEC, WAIT, ESC, DECL).

## Key Decisions from Pinch (2026-03-30)

1. **Action records**: Inline in task notes (primary), optional centralized machine log for event history
2. **Invocation**: Obsidian CLI commands primary, frontmatter-reactive secondary, NOT hot folder
3. **Task format**: Uses frontmatter (title, type, status, owner, capability_primary, needs_matt_review, urgency_date) + structured body sections
4. **Arbiter fields**: Prefixed with `arbiter_` in frontmatter, plus inline `## Agent Assessment` section

## Competitive Position (Gemini analysis, 2026-03-30)

- Classification: Innovation/Slice — introduces formal protocol missing from ecosystem
- Key differentiator: Protocol & Lifecycle vs. Prompt & Response
- Closest peers: Ogent, Copilot for Obsidian, Obsidian MCP Tools
- Risks: orchestration tax (vault bloat), tool discovery gap, hallucinated actions, decomposition loops
