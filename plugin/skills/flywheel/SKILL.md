---
name: flywheel
description: Run the claude-mem leverage pipeline — truth-decay, decision-decay, prompt-forensics, cross-pollinate and scar-tissue — in the right order, on a cadence, with findings recorded so each run starts where the last one ended. Use for "run the memory pipeline", "memory maintenance", "what's due?", "audit everything", or when setting up recurring upkeep for a project.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Task
  - AskUserQuestion
---

# Flywheel

Five skills, run once each, is five reports. Run them in the wrong order and
some of those reports are built on memory you already know is stale.

This is the pipeline: the order, the cadence, and — the part that actually
matters — the record that makes run N+1 cheaper than run N. Without it every
run re-flags the same drifted decision, re-verifies the same unverifiable
memories, and re-discovers the same recurrence. That is a treadmill.

## The order is not arbitrary

```
truth-decay ──▶ decision-decay ──▶ cross-pollinate ──▶ prompt-forensics
   clean            audit              harvest              tune

scar-tissue ──▶ runs on every diff, off the clock entirely
```

1. **`truth-decay` first, always.** Every other stage reads memory. If memory is
   lying, all four inherit the lie and you spend agent budget laundering it into
   confident-looking reports.
2. **`decision-decay` second.** Needs trustworthy memory; produces the frame
   ("what are we even trying to be") that makes the rest legible.
3. **`cross-pollinate` third.** Now that this project's picture is accurate, it's
   worth asking what another project already solved.
4. **`prompt-forensics` last.** It tunes the human, not the code, and its
   evidence is unaffected by the other three — so it goes where it costs least.
5. **`scar-tissue` is not in the cycle.** It's gated on a diff, not a clock.
   Putting it on a timer would be theatre; it belongs at commit/PR time.

## The wheel's state

```bash
echo "${CLAUDE_SKILL_DIR}"
node "${CLAUDE_SKILL_DIR}/wheel.mjs" state
```

Two records, on purpose:

- **Local state** — `~/.claude-mem/flywheel/<project>.json`. Deterministic,
  survives a stopped worker, written temp-then-rename so a crash can't truncate
  it. This is what `due` and `recall` actually read.

  Writes take an exclusive lock, because every stage here fans agents out in
  parallel and tells each one to record what it found. Unlocked, concurrent
  `record` calls collapse to a single surviving finding — each process reads the
  same state, appends, last writer wins — silently, with every call reporting
  success. A lock left by a crashed writer is reclaimed after 30s.
- **Memory write-back** — `POST /api/memory/save`, tagged `CMFLYWHEEL`. This is
  the compounding part: findings reach future sessions through ordinary context
  injection, with no skill invoked at all.

The write-back goes through `/api/memory/save` because the `memory_add` and
`observation_add` MCP tools require the server-beta runtime and throw on a
default SQLite install. It is also best-effort — if the worker is down the
finding is still kept locally and you get a warning, never a lost finding.

Recall is honest about its guarantees: local state is the promise. The
`--memory` flag also queries the observation store, but unified search prefers
semantic ranking when Chroma is up, so a marker token is not guaranteed to rank.

## Running a cycle

### 1. Read the wheel before turning it

```bash
node "${CLAUDE_SKILL_DIR}/wheel.mjs" due
node "${CLAUDE_SKILL_DIR}/wheel.mjs" recall --limit 30
```

`due` says what the cadence wants. `recall` says what the last run left open.
**Read both to the user before dispatching anything** — if nothing is due and
nothing is open, say so and stop. A pipeline that runs because it exists is how
you burn budget producing reports nobody reads.

Default cadences (edit `cadence_days` in the state file to change):

| Stage | Cadence | Why |
|---|---|---|
| `truth-decay` | 30d | Rot accrues with merges, not hours |
| `decision-decay` | 30d | Drift is slow; monthly catches it while cheap |
| `prompt-forensics` | 14d | Needs volume, but rules should land while remembered |
| `cross-pollinate` | 60d | Mostly on-demand; the sweep is a backstop |
| `scar-tissue` | on diff | Never due on a clock |

### 2. Run the due stages in pipeline order

Invoke each skill normally (`/truth-decay`, `/decision-decay`, …) — this skill
sequences them, it does not reimplement them. **Sequential, not parallel:** each
stage's value depends on the previous one's output being real. Parallelising the
cycle gets you four reports built on the same unverified memory.

Before each stage, hand it its own history:

```bash
node "${CLAUDE_SKILL_DIR}/wheel.mjs" recall --stage <stage>
```

That's the mechanism. Each stage consumes its prior findings:

- **truth-decay** skips the batch it already ruled UNVERIFIABLE
- **decision-decay** sees prior repeals as REVERSED instead of re-flagging drift
- **cross-pollinate** finds the recorded transplant and skips to the answer
- **prompt-forensics** compares against its recorded baseline instead of
  re-deriving it — this is the only way to know whether a CLAUDE.md rule worked
- **scar-tissue** weights its review toward files with confirmed recurrences

### 3. Close each stage

```bash
node "${CLAUDE_SKILL_DIR}/wheel.mjs" complete --stage <stage> \
  --note "<one line: what it found>" --close <ids of items now resolved>
```

Only `complete` resets the cadence. A stage you ran but didn't close comes back
as due tomorrow — which is the correct failure direction.

### 4. Report the cycle, not the stages

The user does not want four reports. They want: what changed since last cycle,
what needs a decision from them, and what's carried forward. Lead with the
decisions you need — repeal-or-re-ratify, accept-or-reject a rule, confirm a
rename — and use `AskUserQuestion` for the clear-cut ones. Everything else is
detail they can read in the artifacts.

## Scheduling it

The wheel only compounds if it turns. Once the cadence is settled, schedule it
on the machine where the memory actually lives:

- **cron** — `0 9 * * 1 cd /path/to/repo && claude -p "/flywheel"` (Monday 9am)
- **Claude Code hook** — a SessionStart hook that runs `wheel due` and mentions
  anything overdue. Cheap, and it nags at the right moment. The `update-config`
  skill sets these up.

Don't schedule the whole cycle more often than the shortest cadence — the stages
self-gate, so extra runs mostly print "nothing due", but the noise trains you to
ignore it.

## Failure Modes

- **Running stages out of order.** truth-decay last means everything before it
  was audited against memory you then discovered was wrong.
- **Skipping `recall`.** The pipeline still runs and still produces output —
  it just silently stops compounding, which is invisible until you notice the
  same finding in three consecutive reports.
- **Never calling `complete`.** Cadence never resets, everything reads as
  permanently due, and `due` stops meaning anything.
- **Running the cycle because it's scheduled.** If nothing is due and nothing is
  open, the correct output is one sentence saying so.
- **Treating the local state file as disposable.** It is the wheel's memory of
  itself. Deleting it doesn't lose findings recorded to memory, but it does
  reset every cadence and every open item.
- **Parallelising the cycle.** Wall-clock is not the constraint here; ordering
  is the entire design.
