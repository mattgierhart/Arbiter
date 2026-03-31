# Decision Log — Agent Action Orchestration Plugin

Tracks key decisions, alternatives considered, and rationale.

---

## DEC-001: Product framing — Action Orchestration over Readiness

**Date**: 2026-03-30  
**Status**: Decided  
**Decision**: Frame the plugin as an action orchestration system, with readiness as a supporting subsystem.  
**Alternatives considered**:
- Readiness-first plugin (kanban/status board) — rejected: reduces to a task manager, misses the core agent decision problem
- Pure protocol spec (no plugin) — rejected: needs vault integration to be useful in Obsidian
- Agent runtime (executes tasks) — rejected: too much scope, agents already have execution capability  
**Rationale**: The unique problem is *action selection* — agents need help deciding what to do, not doing it. Readiness is one input to that decision.

---

## DEC-002: Primary user is AI agents, not humans

**Date**: 2026-03-30  
**Status**: Decided  
**Decision**: Design all data structures and APIs for programmatic consumption first, human readability second.  
**Alternatives considered**:
- Human-first with agent compatibility — rejected: leads to GUI-heavy design that agents can't use
- Agent-only (no human readability) — rejected: violates Obsidian philosophy and makes debugging hard  
**Rationale**: Pinch (and similar agents) is the primary consumer. Humans review asynchronously. YAML frontmatter + markdown body serves both.

---

## DEC-003: 7-action model as starting taxonomy

**Date**: 2026-03-30  
**Status**: Draft — needs validation from Pinch  
**Decision**: Start with 7 discrete action types: EXE, ASK, CTX, DEC, WAIT, ESC, DECL.  
**Alternatives considered**:
- Fewer actions (just do/don't-do binary) — rejected: too coarse, loses information
- More granular actions (15+) — deferred: start simple, expand based on real usage
- Free-form action strings — rejected: no structure means no automation  
**Rationale**: 7 covers the major decision paths observed in real agent workflows. Each maps cleanly to a blocker type and resolution pattern.

---

## DEC-004: Vault-native storage only

**Date**: 2026-03-30  
**Status**: Decided  
**Decision**: All plugin state stored as markdown/YAML files in the vault. No external databases, APIs, or hidden state.  
**Rationale**: Obsidian community plugin guidelines, portability, and transparency. Agents and humans can read the same files.

---

## DEC-005: File-based protocol as minimum integration layer

**Date**: 2026-03-30  
**Status**: Draft — architecture TBD  
**Decision**: Support a file-based request/response protocol so any agent (regardless of harness) can interact with the plugin.  
**Alternatives considered**:
- Command-only API — rejected: not all agent harnesses can invoke Obsidian commands
- WebSocket/HTTP server — rejected: overkill for local-first plugin, security concerns
- stdin/stdout protocol — rejected: Obsidian plugins don't have direct process I/O  
**Rationale**: File I/O is the universal lowest common denominator for agent communication.

---

## DEC-006: Plugin name — Arbiter: Agent Action Orchestration

**Date**: 2026-03-30  
**Status**: Decided  
**Decision**: Name the plugin `obsidian-arbiter` with display name "Arbiter — Agent Action Orchestration."  
**Alternatives considered**: See `naming-options.md` for full list. Dispatch (runner-up), Triage, Conductor, etc.  
**Rationale**: "Arbiter" means "decision-maker" — exactly the plugin's role. Subtitle makes purpose obvious to both AI and humans in the Obsidian plugin registry.

---

## DEC-007: Action records inline in task notes

**Date**: 2026-03-30  
**Status**: Decided  
**Decision**: Action records live inline in task notes under `## Agent Assessment`. Optional machine log in `.agent-orchestrator/logs/` for append-only event history.  
**Decided by**: Pinch  
**Rationale**: Task note is the canonical object. Agents and humans see the same truth in one place. Machine log is opt-in for debugging/indexing.

---

## DEC-008: CLI commands as primary invocation, frontmatter-reactive as secondary

**Date**: 2026-03-30  
**Status**: Decided  
**Decision**: Primary interface is Obsidian commands (`arbiter:assess-task`, `arbiter:assess-current-note`). Secondary: opt-in frontmatter field `arbiter_assess: true` triggers assessment on file change.  
**Decided by**: Pinch  
**Rationale**: CLI matches Pinch's preference for explicit, composable commands. Frontmatter-reactive is useful for batch/automated flows but should be opt-in to avoid accidental reprocessing.

---

## DEC-009: Feature priority — EXE, ASK, WAIT as day-one top 3

**Date**: 2026-03-30  
**Status**: Decided  
**Decision**: EXE, ASK, and WAIT are the three highest-priority action types for v1.0. DEC is close fourth. All 7 ship, but these three get the most design attention.  
**Decided by**: Pinch  
**Rationale**: EXE prevents dithering, ASK prevents vague blocking, WAIT prevents thrashing. These cover 80%+ of Pinch's real-world action decisions.

---

## DEC-010: Keep 7 actions, don't add PLAN

**Date**: 2026-03-30  
**Status**: Decided  
**Decision**: Keep the original 7 action types. Pinch suggested PLAN as a possible 8th but agreed it can fold into CTX for now.  
**Rationale**: Start with 7, expand based on real usage. CTX can absorb "I have enough info but need to structure the work" until evidence shows otherwise.

---

*Add new decisions above this line.*
