# Arbiter Audit Model

How to reconstruct any past assessment: which file is authoritative, what the lifecycle of a record is, and how that interacts with SYNC-001.

This file resolves OQ-009 in `open-questions.md`. Behavior described here is the design contract — code changes that violate it require updating this doc.

---

## 1. Two artefacts, two lifetimes

For any task note that Arbiter has ever assessed, there are up to two records:

| Artefact | File | Lifecycle | Authoritative for |
|---|---|---|---|
| **Inline assessment** | The task note's `## Agent Assessment` section | **Overwritten** on every reassess | "What is the current decision?" |
| **Machine log entry** | `.agent-orchestrator/logs/assessment-log.md` (when `enableMachineLog: true`) | **Append-only** | "What were all decisions for this task, ever?" |

These are NOT redundant. They serve different questions:

- Inline answers "what should the agent do RIGHT NOW?" — readers want the latest, period.
- Machine log answers "why did the agent do X yesterday at 14:32?" — readers want the time-stamped decision that was current at that moment.

If you only had inline, you couldn't answer the second question (the prior assessment is overwritten). If you only had log, the task note would carry stale assessments forever (or you'd need to read the log to see "what's current"). Two files, both honest.

---

## 2. Inline assessment — current truth

### Format

Written by `action-recorder.ts` into the task note body, under the heading configured by `assessmentHeading` setting (default `## Agent Assessment`):

```markdown
## Agent Assessment
- **Action**: EXE | ASK | CTX | DEC | WAIT | ESC | DECL
- **Confidence**: high | medium | low
- **Recommended next action**: <specific actionable step>
- **Why**: Primary: <dim> — <reason>. Also: <secondary>: <reason>; ...
- **Blocker type**: none | access | risk | policy | ...
- **Human input needed**: yes | no
- **Human ask**: <if applicable>
- **Wake condition**: <if WAIT>
- **Subtasks**: <if DEC>
- **Last assessed**: 2026-05-06T17:32:00-06:00
```

Frontmatter mirrors the same fields with `arbiter_` prefix:

```yaml
arbiter_action: EXE
arbiter_confidence: high
arbiter_blocker_type: none
arbiter_needs_human: false
arbiter_last_assessed: 2026-05-06T17:32:00-06:00
arbiter_assessed_revision: a3f2bc91d4e5f6b7   # SYNC-001
```

### Lifecycle

- **First assessment**: Both the section and frontmatter are written.
- **Reassessment**: Both are overwritten in place. The OLD assessment is GONE from this file.
- **Manual edit**: If a human edits the section text directly, the next reassess will overwrite their edits. If they edit the frontmatter, that's also overwritten. (Edits to OTHER frontmatter or body content don't get touched, but they do invalidate the SYNC-001 revision pin.)

### What it's good for

- Quick visual check in Obsidian — open the note, scroll, see the answer.
- Programmatic dispatch — `/arbiter-read` parses these fields.
- Single-source consistency — there's one place to look, no version hunting.

### What it's NOT good for

- Audit trail of decisions over time. Use the machine log.
- Forensics of "why did Arbiter score this differently last week" — that data is gone unless you committed the file to git AND you know the right commit.

---

## 3. Machine log — append-only history

### When written

Only when `enableMachineLog: true` in plugin settings. Off by default to avoid log pollution in single-user vaults that don't need audit.

### Format

`action-recorder.ts:formatLogEntry()` produces a markdown block per assessment:

```markdown
---
**2026-05-06T17:32:00-06:00** | `backlog/tasks/TASK-042.md`
- Action: EXE
- Confidence: high
- Blocker: none
- Reason: All readiness dimensions are satisfied.
- Next: Run staging deployment script
- Revision (SYNC-001): a3f2bc91d4e5f6b7
```

Appended to `.agent-orchestrator/logs/assessment-log.md`. The file is created with a header on first write; subsequent writes append.

### Lifecycle

- **Strictly append-only.** Arbiter never modifies an existing entry.
- **Never garbage-collected** by the plugin. Manual rotation if it gets large is the user's call.
- **Survives reassessment.** Reassessing a task adds a NEW entry; old entries for that same path remain.

### What it's good for

- "Show me every assessment for `TASK-042.md`" — `grep` the path.
- "What did Arbiter decide between 14:00 and 16:00 yesterday?" — date filter.
- "Show me the first time Arbiter saw this task" — first matching entry.
- `/portfolio-retro` cadence — read recent log entries to capture loop accuracy.

### What it's NOT good for

- "What's the current decision?" — use inline. The log's most recent entry is current as of write-time, but if Pinch/Matt has since edited the task body, the inline assessment will reflect the staleness via `arbiter_assessed_revision` mismatch (SYNC-001), while the log entry can't.

---

## 4. SYNC-001 interaction

The reconciliation contract (`SYNC-PROTOCOL.md`) intersects the audit model in one specific way:

- **`arbiter_assessed_revision`** in the inline assessment captures the `task_revision` at the moment Arbiter scored. Same field is logged in the machine entry.
- When an external reader (`/arbiter-read`, Codex, future agent) computes a fresh `task_revision` and sees a mismatch, the inline assessment is **stale-current** — still authoritative for "what Arbiter said," but **not safe to dispatch**.
- The machine log entry remains forensically valid: it captures what Arbiter scored when, and against which revision. A reader investigating "why did Claude dispatch this task on Tuesday?" can compare the log entry's revision to the file's revision at the time of dispatch.

In short: **SYNC-001 is the freshness check; the audit model is the historical record.** They're orthogonal.

---

## 5. Reconstruction recipes

### "Show me what Arbiter is currently saying about TASK-042"

Read `backlog/tasks/TASK-042.md`. Look at frontmatter `arbiter_*` fields and the `## Agent Assessment` section. That's the current truth.

### "Show me what Arbiter has ever said about TASK-042"

```bash
grep -A 6 "TASK-042" .agent-orchestrator/logs/assessment-log.md
```

If `enableMachineLog` was off when an assessment was made, that assessment is lost (only the inline version existed, and that's been overwritten if reassessed). For audit-critical use, keep the machine log on.

### "Reconstruct the decision Claude was acting on yesterday at 14:32"

1. Find the log entry for that time: `grep "2026-05-05T14:" .agent-orchestrator/logs/assessment-log.md` (adjust date)
2. The `Revision (SYNC-001)` field shows what `task_revision` Arbiter scored against.
3. If the task file is git-tracked, `git log --before="2026-05-05T14:35"` then `git show <sha>:<path>` to see the file content at that revision.
4. Combination of those gives you: "at this time, Arbiter scored against this content and reached this conclusion."

### "Did the assessment change between Pinch creating the task and Claude reading it?"

1. The first machine log entry for that path = the original assessment.
2. Subsequent entries for the same path = reassessments.
3. Compare `Revision (SYNC-001)` across entries — if they change, the body content changed (someone edited).
4. The current inline assessment's revision is the most recent.

---

## 6. Edge cases

### Reassessment without machine log enabled

You lose the prior assessment. The inline overwrite is destructive. If you care about audit, turn on `enableMachineLog`.

### Manual edit to `## Agent Assessment` section

This is technically supported but invalidates the audit story for that file: the inline content no longer matches what Arbiter wrote. Recommendation: don't manually edit the assessment section. If you disagree with Arbiter's call, edit the task body to make it more assessable, then reassess.

### Manual edit to `arbiter_*` frontmatter

Same concern. Plus, the SYNC-001 revision pin will become invalid (because frontmatter edits don't change `task_revision` since `arbiter_*` keys are excluded from the hash, but `arbiter_assessed_revision` is now lying about what was scored).

### Log file accidentally deleted

You've lost history before that point. The current inline assessment is unaffected. Future assessments will recreate the log file with a fresh header.

### Plugin disabled mid-session

Both inline and log entries persist as plain markdown. They're just static — no further updates until the plugin is re-enabled.

---

## 7. What this model is not

- **Not a versioned database.** Markdown files don't have row versioning. We rely on git for time-travel if the user commits regularly.
- **Not enforceable across external writers.** Arbiter writes both files atomically; if a third party (Pinch, Codex, hand) appends to the log, that's outside contract. Don't.
- **Not a replacement for git.** If you want true revisioned history of task content, commit the vault. The audit model just helps you reconstruct *Arbiter's decisions* on top of whatever versioning your storage provides.

---

## 8. Settings reference

| Setting | Default | Effect on audit |
|---|---|---|
| `enableMachineLog` | `false` | Off → no audit history. On → full append-only log. |
| `logFolderPath` | `.agent-orchestrator/logs` | Where the log file lives. Change at your own risk; old log won't auto-migrate. |
| `assessmentHeading` | `## Agent Assessment` | Where inline lives. Same caveat — change breaks parsing of older notes. |
| `frontmatterPrefix` | `arbiter_` | Same. |
| `syncProtocolEnabled` | `false` | When on, the revision pin gets written into both inline and log. When off, audit still works, just without the freshness check tie-in. |

---

*Resolves OQ-009. See `PRD.md` §10 for v1.0 acceptance criteria; this doc satisfies criterion 7 ("Audit story is clear").*
