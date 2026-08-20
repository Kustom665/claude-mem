---
name: scar-tissue
description: Review a working diff against every bug that was ever fixed in the files it touches — memory used as a regression oracle, not a lookup. Use before committing, opening a PR, or merging, and when asked "will this reopen an old bug?", "what broke here before?", "is this file dangerous?", or for a pre-merge risk read on a change.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Task
---

# Scar Tissue

Every file in a long-lived codebase carries scars: the bugs that were fixed in
it, and the reasons the fix looks the way it does. That history lives in
claude-mem and is almost never consulted at the moment it matters — when someone
is about to edit the same lines again.

You are the **orchestrator** of a pre-merge review that reads the diff *through*
the scars. One agent per scarred file, each holding that file's bug history and
nothing else, each answering one question: **does this change reopen something we
already closed?**

You do not fix anything. You produce a verdict with citations.

## When to Use

- Before a commit, PR, or merge that touches non-trivial code
- "Will this break something we already fixed?"
- "What's the risk on this file?"
- After a large refactor, to check the blast radius against known-fragile files

Not for: general code review (use `/code-review`), or finding new bugs with no
history behind them. Scar Tissue only speaks to **recurrence**.

## Setup

The bundled script talks to the worker and to git. Resolve the skill dir once —
spawned agents don't inherit `CLAUDE_SKILL_DIR`, so paste the real path into
each brief:

```bash
echo "${CLAUDE_SKILL_DIR}"
node "${CLAUDE_SKILL_DIR}/scars.mjs" --help
```

If the worker is unreachable the script says so and exits. Start it before going
further — there is no useful degraded mode for this skill.

## Phase 1 — What the diff touches

```bash
node "${CLAUDE_SKILL_DIR}/scars.mjs" changed --base origin/main --json
```

`changed` unions the working tree, the index, untracked files, and (with
`--base`) the branch diff. Omit `--base` for uncommitted work only.

Zero changed files means there is nothing to review — say so and stop.

## Phase 2 — Rank by scar density

```bash
node "${CLAUDE_SKILL_DIR}/scars.mjs" map --project <project> --scan 3000 --top 40 --json
```

`map` walks observation history and tallies, per file, how many **bugfix** and
**security_alert** observations touched it. Intersect that map with Phase 1's
changed files. The intersection is your review set, ordered by scars.

Judgment calls that are yours, not an agent's:

- **A changed file with zero scars gets no agent.** Clean history, no recurrence
  risk to speak of. Note it and move on.
- **Cap the fan-out at ~8 files.** Past that you are reviewing a rewrite, not a
  diff — take the top 8 by scars and say plainly which files you skipped.
- Config, lockfiles, and generated output rarely carry meaningful scars even when
  they carry counts. Drop them.

## Phase 3 — One agent per scarred file (FAN OUT)

Dispatch the review agents in a single message so they run together. Each agent
gets exactly one file.

### Agent brief

> You are reviewing **one file** for bug recurrence: `<path>`.
>
> 1. Pull its scar history:
>    `node "<skill-dir>/scars.mjs" history --file "<path>" --project "<project>" --limit 40 --json`
>    Rows marked `scar: true` are past bugfixes or security alerts on this file.
> 2. Fetch the full record for the scars that look related to the current change:
>    use the `get_observations` MCP tool with those IDs. Read the narrative and
>    facts — the title alone will mislead you.
> 3. Read the current diff for this file only: `git diff -- "<path>"`
>    (add `origin/main...HEAD` if reviewing a branch).
> 4. Decide, per scar, whether the diff **reopens it, weakens the fix, or is
>    unrelated**. Unrelated is the common and correct answer — say it.
>
> Return exactly this, and nothing else:
>
> - `FILE:` the path
> - `VERDICT:` `REOPENS` | `WEAKENS` | `CLEAR`
> - `EVIDENCE:` for anything other than CLEAR — the observation ID, what the
>   original bug was, the specific diff hunk (`file:line`) that touches it, and
>   why the guard is gone or changed
> - `SCARS CONSIDERED:` the IDs you read and dismissed, one line each
> - `CONFIDENCE:` high/medium/low, plus what you could not check
>
> Do not fix anything. Do not review style, naming, or performance. Recurrence
> only. If the file's history is empty, return `CLEAR` and say the history was
> empty.

### Reject and redeploy

A report that claims `REOPENS` without an observation ID **and** a `file:line`
from the diff is not evidence. Send it back once with: "cite the observation ID
and the exact hunk, or downgrade to CLEAR."

## Phase 4 — Refute the blockers (FAN OUT)

`REOPENS` blocks a commit. A verdict that expensive should have to survive
someone trying to kill it — one agent's pattern-match is not enough to stand in
front of someone's work.

**Panel only the `REOPENS` verdicts.** Not `CLEAR`, not `WEAKENS`. Verifying a
negative means redoing the whole review, and `CLEAR` is the common case — panel
it and you triple the cost of the boring path to catch almost nothing. `WEAKENS`
is already a soft flag that blocks nobody.

For each `REOPENS`, dispatch **three refuters in one message**, each with a
different lens, because a false blocker fails in three distinct ways:

| Lens | The question | The mistake it catches |
|---|---|---|
| **Bug** | Is the old bug what the reviewer thinks it is? | Misread the observation; matched on topic, not mechanism |
| **Diff** | Does the change actually touch that guard? | Misread the hunk; the lines moved but the logic didn't |
| **Codebase** | Is the guard still present somewhere else? | Missed that protection relocated — extracted, hoisted, moved to a caller |

Three identical skeptics would all make the same mistake. These three can't.

### Refuter brief

> You are trying to **refute** a claim that a code change reopens an old bug.
> Assume it is wrong and look for the reason. You are not reviewing the code.
>
> **Claim:** `<the REOPENS verdict, verbatim>`
> **Original bug:** observation `#<id>` — fetch it with `get_observations`
> **The hunk:** `<file:line>`
> **Your lens: `<bug | diff | codebase>`** — `<the question from the table>`
>
> Return exactly:
>
> - `LENS:`
> - `REFUTED:` `true` | `false`
> - `WHY:` the specific reason, with `file:line` or the observation text you're
>   reading differently. "Seems fine" is not a refutation; neither is "seems bad."
>
> **If you cannot establish either way, return `refuted: true`.** A blocker that
> can't be demonstrated shouldn't block. The cost of a wrong block is someone's
> good work stopped and their trust in this review gone; the cost of a missed
> one is a bug we already know how to find.

**Two of three refute → the blocker dies.** Downgrade it to `WEAKENS`, keep it
in the report as a soft flag with the refuters' reasoning, and say it was
downgraded. Don't delete it silently — the reviewer's instinct was worth
recording even when the panel overruled it.

**The asymmetry is real and you should name it.** A false `CLEAR` — a missed
regression — gets no panel. The only guard against it is the `SCARS CONSIDERED`
list every agent must return: if an agent cleared a file without naming the
scars it dismissed, that's a lazy CLEAR, and redeploying it costs one agent
rather than three.

## Phase 5 — The verdict (you write it)

Synthesize yourself; do not delegate this. Lead with the answer:

1. **Blockers** — every `REOPENS` that survived the panel, one paragraph each:
   the old bug, the new hunk, what will break. Cite `#<id>` and `file:line`, and
   note the vote (e.g. "0 of 3 refuted").
2. **Soft flags** — every `WEAKENS`: what got thinner and whether that's
   deliberate. Include blockers the panel downgraded, with the refuters' reason.
3. **Cleared** — one line: "N files reviewed against M scars, no recurrence."
4. **Not reviewed** — files you dropped, and why (no scars / over the cap /
   generated).

If everything is CLEAR, say so in two sentences. A clean review that reads like
a clean review is the point; padding it with hedges destroys the signal.

## Close the loop — leave the scar in memory

When the review finds a genuine recurrence, record it so the *next* review
inherits it:

```bash
node "${CLAUDE_SKILL_DIR}/../flywheel/wheel.mjs" record \
  --stage scar-tissue --kind recurrence-confirmed \
  --summary "<what reopened, in one line> (panel: <n> of 3 refuted)" \
  --refs <original observation IDs> --files <path> --open
```

Only record recurrences that survived Phase 4. A finding the panel killed is not
a scar, and writing it back would poison every future review of that file with a
recurrence that never happened.

That writes to the wheel's local state *and* back into memory, so a future
session sees it through ordinary context injection without running this skill.
Do not use the `memory_add` / `observation_add` MCP tools for this — they
require the server-beta runtime and throw on a default SQLite install.

A scar that keeps reopening is the strongest refactor argument you will ever
have, and `wheel recall --stage scar-tissue` is where that argument accumulates.

## Failure Modes

- **Reviewing the whole diff in one agent** — the context blurs together and
  every file gets the same generic verdict. One file, one agent.
- **Trusting titles** — observation titles compress hard. An agent that didn't
  call `get_observations` didn't read the bug.
- **Scar count as risk score** — a file with 40 scars may be a hot path that is
  fine; a file with one scar may be the exact line being deleted. Rank the
  fan-out by count, judge by content.
- **Verdict inflation** — if every file comes back `REOPENS`, the agents are
  pattern-matching on topic, not mechanism. Redeploy with: "the same *failure*
  must recur, not the same subject area."
- **Panelling everything** — three refuters on every `CLEAR` triples the cost of
  the common path to catch almost nothing. Panel what blocks.
- **A panel of clones** — three agents given the same brief make the same
  mistake and return a unanimous wrong answer that now *looks* verified. The
  three lenses are the point, not the number three.
- **Refuters that review instead of refute** — an agent asked "is this finding
  good?" will usually say yes. Ask it to kill the finding, and make
  can't-establish count as refuted.
