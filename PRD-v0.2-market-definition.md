# PRD v0.2 — Market Definition

**Plugin**: Arbiter — Agent Action Orchestration  
**Date**: 2026-03-30  
**Status**: Complete

---

## 1. Competitive Landscape

### Direct Competitors (Agent-in-Vault)

| Plugin | What it does | How Arbiter differs |
|--------|-------------|---------------------|
| **Ogent** | LLM agent that searches, reads, updates notes autonomously | No structured protocol — agent acts freely without decision framework |
| **Copilot for Obsidian** | All-in-one AI chat + Agent Mode with RAG | Chat-first, prompt/response model — no action lifecycle or auditability |
| **Vibesidian** | Meta-agent that modifies Obsidian itself (CSS, plugins) | High-capability Execute, but no decision protocol or readiness assessment |
| **Obsidian MCP Tools** | Bridge for external agents to use Obsidian as toolset | Transport layer only — no decision logic, could be complementary |
| **Smart Connections** | RAG and semantic search over vault | Context layer — feeds into Arbiter's CTX assessment, not a competitor |

### Adjacent (Manual Task/Query Tools)

| Plugin | Layer | Arbiter's relationship |
|--------|-------|----------------------|
| **Tasks** | Visual state storage for humans | Arbiter adds decision logic on top of task state |
| **Kanban** | Visual board for human task management | Arbiter reads Kanban state as input, doesn't replace it |
| **Dataview** | Read-only query engine | Arbiter is read-write action engine; may use Dataview for assessment |
| **Templater** | Static scaffolding | Arbiter is dynamic orchestration; Templater sets stage, Arbiter plays game |

### Key Insight

No existing plugin provides a **structured action protocol** for AI agents. Current tools are either:
- Chat interfaces (prompt → response, no lifecycle)
- Agent runtimes (execute freely, no decision framework)
- Human task tools (visual boards, no agent awareness)

Arbiter fills the gap: **Protocol & Lifecycle** vs. **Prompt & Response**.

---

## 2. Product Type Classification

**Primary: Innovation** — Introduces a formal decision protocol that doesn't exist in the ecosystem.  
**Secondary: Slice** — Takes the specific slice of "action selection" from the broader AI-agent problem and makes it a robust vault-native standard.

### Why not other types?

| Type | Why not |
|------|---------|
| Clone | Nothing to clone — no existing action protocol plugin |
| Unbundle | Not extracting features from a larger product |
| Undercut | Not competing on price/simplicity with an existing solution |
| Wrapper | Not wrapping an existing API or service |

---

## 3. Market Positioning

### One-liner
**"The decision protocol that AI agents check before acting."**

### Positioning Statement
For AI agents operating in Obsidian vaults, Arbiter is the action orchestration plugin that provides a structured protocol for deciding, declaring, and recording next actions. Unlike chat-based AI plugins or free-form agent runtimes, Arbiter makes every agent decision explicit, inspectable, and auditable — stored as plain markdown in your vault.

### Wedge Opportunity
The Obsidian ecosystem is rapidly gaining AI agent plugins, but none address the **decision governance** layer. As agents get more capable, the need for structured action protocols will grow. Arbiter establishes the standard early.

---

## 4. Target Market Size

### Addressable
- Obsidian users with AI agent workflows (growing rapidly via MCP, Claude, OpenClaw)
- Estimated: 5,000-20,000 active users within 12 months of Obsidian's agent ecosystem maturing

### Beachhead
- OpenClaw users (Pinch-like agents) — dozens today, growing
- Claude Code / MCP users interacting with Obsidian vaults — hundreds
- Power users building custom agent workflows — low thousands

### Growth Vector
- As more AI tools adopt MCP and vault-based workflows, Arbiter becomes the natural governance layer
- Protocol could be adopted beyond Obsidian (the spec is tool-agnostic)

---

## 5. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Orchestration tax** — too much vault writing slows agents | High | Minimal inline records, optional verbose logging |
| **Tool discovery gap** — Arbiter can't know what other plugins can do | Medium | Start with file I/O actions only, expand via MCP |
| **Decomposition loops** — agents stuck in DEC→CTX→DEC cycles | Medium | Circuit breaker / max depth in policy engine |
| **Adoption friction** — agents need to be taught the protocol | Medium | Ship with prompt templates and example integrations |
| **Ecosystem timing** — agent-in-vault is still early | Low | Early mover advantage; protocol can wait for ecosystem |
