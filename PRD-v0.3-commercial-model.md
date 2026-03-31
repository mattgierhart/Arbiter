# PRD v0.3 — Commercial Model

**Plugin**: Arbiter — Agent Action Orchestration  
**Date**: 2026-03-30  
**Status**: Complete

---

## 1. Pricing Model

**Free and open source** (MIT License).

This is an Obsidian community plugin. No pricing tiers, no premium features, no SaaS backend.

### Why open source?
- Obsidian community plugin guidelines require plugins to be free
- The protocol itself should be a public standard that any agent can adopt
- Network effects: more agents using the protocol = more value for everyone
- Matt's explicit goal is community contribution, not monetization

---

## 2. Feature Priority (Validated with Pinch)

### Tier 1 — Must ship in v1.0 (Day-one value)

| Feature | Action Type | Why critical |
|---------|-------------|-------------|
| **Execute assessment** | EXE | Pinch's #1 need: "Is this ready to act on? What's the exact first step?" |
| **Ask formulation** | ASK | #2 need: Convert blockers into smallest possible human asks |
| **Wait management** | WAIT | #3 need: Park tasks cleanly with wake conditions, stop thrashing |
| **Readiness checker** | All | The 6-dimension assessment that feeds action selection |
| **Inline action records** | All | Write `## Agent Assessment` section into task notes |
| **CLI command interface** | All | `arbiter:assess-task`, `arbiter:assess-current-note` |
| **Task frontmatter parser** | All | Read Pinch's existing task format (title, type, status, owner, etc.) |
| **Policy file support** | ESC, DECL | Human-writable rules that constrain agent behavior |

### Tier 2 — Should ship in v1.0

| Feature | Action Type | Why |
|---------|-------------|-----|
| **Decompose assessment** | DEC | Break large tasks into subtasks with dependencies |
| **Context request** | CTX | Identify missing vault context needed for assessment |
| **Escalation routing** | ESC | Route decisions to appropriate human/agent |
| **Decline with reason** | DECL | Graceful "no" with rationale and alternatives |
| **Frontmatter-reactive mode** | All | Opt-in: set `arbiter_assess: true` to trigger assessment |

### Tier 3 — Post v1.0

| Feature | Why deferred |
|---------|-------------|
| Optional centralized machine log | Nice-to-have for debugging, not core flow |
| Dataview-compatible query fields | Useful for humans, not blocking agents |
| Kanban integration (auto-move cards) | Convenience, not protocol |
| Multi-agent conflict resolution | Out of MVP scope per PRD v0.1 |
| Circuit breaker / max decomposition depth | Important but can ship as policy rule first |

---

## 3. Success Metrics (KPIs)

Since this is open source, metrics focus on adoption and utility rather than revenue.

### Primary: Agent Decision Quality

| Metric | Target | How measured |
|--------|--------|-------------|
| **Action selection accuracy** | >80% of EXE assessments lead to successful execution | Review action logs vs. outcomes |
| **Ask precision** | ASK actions contain specific, answerable questions (not vague "I'm blocked") | Manual review of first 50 ASK records |
| **False EXE rate** | <10% of EXE actions hit unexpected blockers | Action log audit |

### Secondary: Adoption

| Metric | Target (6mo) | How measured |
|--------|-------------|-------------|
| **Obsidian community installs** | 500+ | Plugin stats |
| **GitHub stars** | 200+ | GitHub |
| **Active protocol adopters** | 5+ distinct agent integrations | GitHub issues/discussions |

### Tertiary: Workflow Impact

| Metric | Target | How measured |
|--------|--------|-------------|
| **Pinch session efficiency** | 30% fewer wasted cycles on blocked tasks | Before/after comparison of action logs |
| **Human review time** | Async review of agent decisions takes <2 min per task | Matt's feedback |
| **Task resumption time** | Agent picks up interrupted task in <30s by reading action log | Measured in testing |

---

## 4. Moat / Defensibility

### What makes Arbiter hard to replicate?

| Moat type | Strength | Notes |
|-----------|----------|-------|
| **Protocol standard** | Medium | If Arbiter's action model becomes the de facto protocol, switching costs rise |
| **Vault-native integration** | Medium | Deep Obsidian integration takes time to replicate |
| **Real-world validation** | High | Built with a real agent (Pinch) in production workflows — not theoretical |
| **Open-source community** | Medium | Contributors and adopters create momentum |

### Honest assessment
The moat is weak individually but compounds. The real defensibility is being first with a well-designed protocol that works in practice.

---

## 5. Go/No-Go Criteria for Build

| Criterion | Status |
|-----------|--------|
| Problem validated with primary user (Pinch) | Yes |
| Action model validated (7 types confirmed useful) | Yes |
| Integration model decided (CLI + frontmatter) | Yes |
| Task format understood (real examples from Pinch) | Yes |
| Competitive gap confirmed (no existing protocol plugin) | Yes |
| Open-source model confirmed | Yes |
| Day-one feature priority ranked | Yes |

**Decision: GO** — proceed to v0.4 (User Journeys) and then build.
