# Arbiter Reconciliation Contract (SYNC-001)

**Status**: Stable, opt-in (`syncProtocolEnabled` setting, default false)
**Spec version**: 1.1
**Introduced**: 2026-05-03
**Last edit**: 2026-05-03 — reframed as a reconciliation contract per Symphony §8.1; adopted RFC 2119 normative language

## Normative language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

**"Implementation-defined"** means the behavior is part of the implementation contract, but this specification does not prescribe one universal policy. Implementations MUST document the selected behavior.

---

## 1. Problem this contract solves

Arbiter task notes are markdown files in an Obsidian vault. In **single-user vaults** that's fine. In **multi-actor vaults** — where a human (Matt), an assessor (Arbiter), and one or more external agents (Claude Code, OpenAI Codex, Pinch, MCP clients) all touch the same files — file-level synchronisation is **not transactional**. iCloud, Dropbox, Syncthing, and shared network drives all deliver file changes independently.

That creates a **torn cross-file snapshot**: a reader observes Kanban.md from after a board edit while the linked task note is still on the older revision. The cached `arbiter_action: EXE` no longer reflects the post-edit assessment, but the reader has no way to know.

> *"The single most likely failure is a torn cross-file snapshot: Claude reads `Kanban.md` from after Matt/Pinch reordered the board, but reads the linked task note from before the corresponding edit/reassessment synced."*  — Codex review, 2026-05-03

This contract gives any external agent a safe, file-based way to act on Arbiter's assessments without coordination services.

---

## 2. Mental model: reconciliation before dispatch

External agents that consume Arbiter's output operate in two distinct phases per dispatch attempt:

1. **Reconciliation phase** — verify cached state still reflects truth. The current task revision MUST match the revision Arbiter scored against. The board file SHOULD have been stable for at least the debounce window.
2. **Dispatch phase** — only after reconciliation passes, act on the cached `arbiter_action`.

This mirrors how Symphony (OpenAI's coding-agent orchestrator) reconciles running tasks before dispatching new ones (see Symphony §8.1). Arbiter does not run the dispatch loop itself; it provides the contract that any dispatcher SHOULD follow.

---

## 3. The contract

### 3.1 Required frontmatter fields

When `syncProtocolEnabled` is true, every task note MUST carry the following fields:

| Field | Written by | Required | Meaning |
|---|---|---|---|
| `arbiter_assessed_revision` | Arbiter | After first assessment | The `task_revision` that existed at the moment Arbiter recorded its current `arbiter_action`. |

The `task_revision` value itself is **not stored on disk** — it is recomputed by every reader on every read using the algorithm in §3.2. This makes the protocol stateless from the writer's perspective.

### 3.2 How `task_revision` MUST be computed

`task_revision = sha256(stable_payload).slice(0, 16)` where `stable_payload` is:

1. `JSON.stringify(userFrontmatter)` — frontmatter keys NOT prefixed `arbiter_`, sorted alphabetically by key
2. literal `\n---\n` separator
3. The body content with the `## Agent Assessment` section removed (heading line through next `## ` heading or end of file)

Implementations MUST exclude `arbiter_*` frontmatter keys and the `## Agent Assessment` section. Including them would cause Arbiter's own writes to invalidate the assessment it just produced.

### 3.3 Reader contract

External agents that read task notes for dispatch decisions MUST:

1. Parse the note (extract frontmatter and body separately).
2. Compute `task_revision` using §3.2.
3. Read `arbiter_assessed_revision` from the parsed frontmatter.
4. **MUST NOT** act on the cached `arbiter_action` if either of these is true:
   - `arbiter_assessed_revision` is missing (task has never been assessed).
   - `arbiter_assessed_revision !== task_revision` (substantive content changed since assessment).
5. **SHOULD** enforce a board-level debounce: if the Kanban file was modified less than `boardDebounceMs` (default 60 000 ms) ago, treat all top-of-board tasks as not-yet-actionable until the window elapses.

Implementations MAY skip step 5 if their dispatch granularity is per-note (not per-board), since the per-note revision check in step 4 is sufficient for single-task safety. The board debounce protects against the orthogonal case where the board moves a card to "Now" but the note's edit hasn't synced yet.

### 3.4 Writer contract (Arbiter and any other writer)

When the sync protocol is enabled, writers MUST:

1. Compute `task_revision` from the note state they are reading (using §3.2).
2. If updating substantive content (anything outside `arbiter_*` frontmatter and the assessment section), write the new state. Other readers will recompute the new revision on next read; no field write is needed.
3. If running an assessment (Arbiter only), write `arbiter_assessed_revision` set to the `task_revision` just computed, alongside the new `arbiter_action` and other `arbiter_*` fields. Both writes SHOULD happen in a single file-write operation to avoid producing a torn note.

Writers MUST NOT alter the `## Agent Assessment` section AND substantive body content in the same write — those are different lifecycle operations. Combining them would violate the contract by appearing to be a substantive edit while really being just an assessment refresh.

---

## 4. Reference implementation

### 4.1 TypeScript

The canonical implementation is exported from `obsidian-arbiter/sync-protocol`:

```typescript
import { isAssessmentFresh, isBoardSettled } from "obsidian-arbiter/sync-protocol";

// Reconciliation phase
const check = isAssessmentFresh(task, settings);
if (!check.fresh) {
  log.warn("Skipping task — sync protocol mismatch:", check.reason);
  return;
}

const board = isBoardSettled(boardMtimeMs, settings);
if (!board.settled) {
  log.info(`Waiting ${board.waitMs}ms for board to settle`);
  return;
}

// Dispatch phase
dispatch(task);
```

### 4.2 Other languages

The algorithm in §3.2 is small enough to reimplement directly. See `src/sync-protocol.ts` (~80 lines, MIT-licensed alongside the plugin). Conformant implementations MUST produce byte-identical revision strings for byte-identical inputs.

---

## 5. Settings

| Setting | Default | Purpose |
|---|---|---|
| `syncProtocolEnabled` | `false` | Off by default — single-user vaults don't need it and benefit from the slight write overhead being skipped. Turn on when a second writer touches the vault. |
| `boardDebounceMs` | `60_000` | How long Kanban.md MUST be untouched before reads are trusted. Tune higher for slow-syncing storage (Google Drive desktop sync is typically slower than iCloud Drive). |

---

## 6. Non-goals

These remain the reader's responsibility:

- **Concurrent writes by two external agents.** If Claude on machine A and Codex on machine B both decide to dispatch the same task at the same time, both will see the same fresh assessment. Use task-level advisory locks (e.g., write a `dispatched_by:` frontmatter field before starting) if this matters for your workflow.
- **Board reordering during dispatch.** A reader that has already started executing a task can be moved to the bottom of the board mid-execution. The protocol does not reach into running work.
- **Network partitions during sync.** If iCloud is unreachable, neither side sees the other's writes. The protocol will eventually catch up; it does not accelerate sync.

These are intentional non-goals. The protocol's scope is **detecting** torn snapshots cheaply, not preventing all distributed-systems failure modes.

---

## 7. Versioning

This document defines protocol version 1.1. The wire format (frontmatter field names, hash algorithm) is unchanged from v1.0; v1.1 only updates documentation framing.

Future versions SHOULD be additive — readers that implement v1 MUST continue to work against vaults written by v2-aware Arbiter installations. If a breaking change becomes necessary, it MUST go through:

1. A new field (e.g., `arbiter_protocol_version: 2`) added by writers.
2. A deprecation period where readers are expected to handle both.
3. A removal of v1 only after all known consumer projects have migrated.

External consumers SHOULD declare their supported protocol version in their own documentation so users know the integration is current.

---

## 8. Diagnostic credit

The torn-snapshot risk that motivated this contract was identified by an OpenAI Codex (gpt-5.5) architecture review of an early Claude-authored integration plan, on 2026-05-03. The mitigation pattern (monotonic revision pin + debounce window) was Codex's suggestion. The reframing as a "reconciliation contract" (rather than a "freshness check") was inspired by reading [OpenAI Symphony §8.1](https://github.com/openai/symphony/blob/main/SPEC.md), which uses the same architectural framing for its own multi-actor dispatch loop.

We've kept the attribution because it is a clean example of the value of a second-model review for distributed-systems design — both Claude and a human reviewer had previously missed this failure mode.
