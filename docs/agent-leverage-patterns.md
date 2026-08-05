# Five Ways to Leverage Agents Against Memory

claude-mem's existing skills mostly point agents *at* the archive: search it,
summarize it, narrate it. These five point the archive *at* the work. Each one
is an orchestrator that fans agents out over memory, and each answers a question
you cannot ask a single session, because the evidence lives across months of
them.

The pattern common to all five: **the bundled script counts, the agents judge.**
Counting in a script is cheap, deterministic, and reviewable. Judgment in an
agent is expensive and needs evidence contracts — so every skill here refuses
reports that arrive without observation IDs and `file:line` citations.

Two verdicts get a second layer, because they're the ones that cost something
when wrong: `scar-tissue`'s **REOPENS** blocks a commit, and `truth-decay`'s
**FALSE** writes a correction that future sessions read as fact. Each goes to
three refuters prompted to *kill* the finding — with three different lenses, not
three copies of the same brief, since identical agents make identical mistakes
and return a unanimous wrong answer that then looks verified. Two of three
refute and the verdict dies. Can't-establish counts as refuted, so the tie-break
always falls toward not acting.

Everything else is deliberately single-agent. Panelling `CLEAR` would triple the
cost of the common path to catch almost nothing, and `truth-decay`'s `MOVED` is
better checked with `test -e` than with an agent. Voting on "did we find
something" is theatre; voting on "is this finding real" is not.

| Skill | Memory becomes | Fan-out unit | Output |
|---|---|---|---|
| `scar-tissue` | a regression oracle | one agent per scarred file | pre-merge verdict |
| `decision-decay` | an architectural constitution | one agent per decision | `DECISION-LEDGER.md` |
| `prompt-forensics` | a critique of the brief | one agent per cluster of sessions | a CLAUDE.md patch |
| `cross-pollinate` | a cross-repo parts bin | one agent per foreign project | transplant plan |
| `truth-decay` | an immune system | one agent per batch of suspect memories | corrections |
| `flywheel` | a pipeline that compounds | sequences the five, dispatches none | cadence + carried findings |

## 1. `scar-tissue` — the diff meets its own history

Every file carries scars: bugs fixed in it, and the reason each fix looks the way
it does. Nobody consults that history at the one moment it matters — when
someone edits those lines again.

`scars.mjs` intersects the working diff with files ranked by bugfix density, then
one agent per scarred file answers a single question: does this change reopen
something we already closed? A scar is a file a fix *modified* — files merely
read during an investigation are context, not scars, or the ranking fills up with
whatever file gets opened most.

Why it's non-obvious: memory is normally a lookup. Here it's an adversarial
reviewer with a grudge, and it only speaks to recurrence — never style, never
new bugs.

## 2. `decision-decay` — audit the constitution against the code

Decisions are the most expensive artifact in a codebase and the least
maintained. "The worker owns all writes to SQLite" gets decided, recorded, and
eighteen months later four other paths write to SQLite — not because anyone
overruled it, but because nobody checked.

One verifier per recorded decision, each establishing what the code does *now*
and classifying: HELD, DRIFTED, REVERSED, or OBSOLETE. The output is a ledger,
and the phase that matters most is the last one: every DRIFTED decision goes back
to the human to re-ratify or repeal. An audit with no disposition produces the
identical report next quarter.

Why it's non-obvious: drift is invisible from inside any single session. It is
only visible as the delta between a decision and the present, which is exactly
the pair memory can supply and code review cannot.

## 3. `prompt-forensics` — debug the human, not the code

Every other skill here debugs the codebase. This one debugs the brief.

claude-mem stores every prompt alongside what the session produced. Joined, they
expose a pattern invisible from inside any one session: a specific *shape* of
request that reliably costs fifteen turns and ends with open next_steps — and the
shape that lands in three. `forensics.mjs` ranks sessions by friction; agents
cluster the failure modes across sessions and against a control group of cheap
sessions, because without contrast every omission looks causal.

The deliverable is not advice. It's a patch to this project's CLAUDE.md — rules
that are checkable, local, and few — applied only with per-rule consent.

Why it's non-obvious: the archive is usually mined for what was built. It also
records how it was asked for, and that signal is actionable in a way no
generic prompting guide is.

## 4. `cross-pollinate` — the solution you already shipped elsewhere

Memory is project-scoped by default, and rightly so. But that scoping throws
away the most valuable asset a multi-repo developer owns: you already solved
this, in a different repo, eight months ago.

This deliberately breaks the scoping. One hunter per foreign project, each
searching its own memory for the analogue — matched on failure *mechanism*, not
topic — and each required to return the scars too, because the follow-up bugfixes
in the source project are precisely what you get to skip this time. The
synthesis is a transplant plan whose center is the delta: every way the current
repo differs and what each difference forces you to change.

Why it's non-obvious: the second time you solve something should cost a tenth of
the first, and across a fleet of repos that compounds. Nothing else in the
toolchain reaches across project boundaries on purpose.

## 5. `truth-decay` — memory that garbage-collects itself

Every observation was true when written. Nothing re-checks it. Code moves, and
stale memory keeps getting injected into new sessions with the same confidence
as the day it was recorded. A memory system without garbage collection doesn't
degrade gracefully — it degrades into a confidently wrong assistant.

`rot.mjs` is the cheap prefilter: observations whose referenced files no longer
resolve, plus anything old enough to warrant a re-check. Agents then verify in
batches — related memories share one investigation — and classify TRUE, MOVED,
FALSE, or UNVERIFIABLE, defaulting to UNVERIFIABLE when unsure.

The disposition is deliberately conservative: **supersede, don't delete.** A
correcting observation is auditable and reversible; a deletion is silent and
permanent. MOVED is the most valuable verdict — the claim survives, only the
paths were wrong.

Why it's non-obvious: everyone builds memory ingestion. Almost nobody builds the
immune system, and it's the thing that decides whether the archive is still worth
trusting in year two.

## The wheel — `flywheel`

Five skills run once each is five reports. What makes them compound is that each
run starts where the last one ended, and that requires two things the individual
skills can't provide themselves: **an order**, and **a record**.

The order is a dependency chain, not a preference:

```
truth-decay ──▶ decision-decay ──▶ cross-pollinate ──▶ prompt-forensics
   clean            audit              harvest              tune

scar-tissue ──▶ runs on every diff, off the clock entirely
```

`truth-decay` goes first because every later stage reads memory — audit against
un-verified memory and you spend agent budget laundering stale claims into
confident-looking reports. `scar-tissue` is deliberately outside the cycle: it's
gated on a diff, not a clock, and putting it on a timer would be theatre.

The record is `wheel.mjs`, which keeps two, on purpose:

- **Local state** (`~/.claude-mem/flywheel/<project>.json`) — deterministic,
  survives a stopped worker, written temp-then-rename so a crash can't truncate
  it. This is what `due` and `recall` actually read, and what the cadence and
  open-item carry are built on.
- **Memory write-back** (`POST /api/memory/save`, tagged `CMFLYWHEEL`) — the
  compounding part: findings reach future sessions through ordinary context
  injection, with no skill invoked at all.

Write-back deliberately does **not** use the `memory_add` / `observation_add`
MCP tools: both call `requireServerBetaForObservationTool` and throw on a default
SQLite install. `/api/memory/save` is the path that works on both runtimes.

It is also best-effort. If the worker is down, the finding is still written to
local state and you get a warning — a lost finding is never acceptable, because
the finding is the entire product of an expensive agent fan-out.

Each stage consumes its own prior findings, which is the actual mechanism:

- **truth-decay** skips the batch it already ruled UNVERIFIABLE
- **decision-decay** sees prior repeals as REVERSED instead of re-flagging drift
- **cross-pollinate** finds the recorded transplant and skips to the answer
- **prompt-forensics** compares against its recorded baseline — the only way to
  learn whether a CLAUDE.md rule actually worked
- **scar-tissue** weights its review toward files with confirmed recurrences

## Running them

All six are Claude Code skills in `plugin/skills/`. Invoke by name
(`/scar-tissue`, `/flywheel`) or just describe the task — the descriptions are
written to trigger on natural phrasings ("will this reopen an old bug?", "are we
still following our own architecture?", "have I solved this before?", "what's
due?").

Start with the wheel, which tells you what's worth running:

```bash
node "${CLAUDE_SKILL_DIR}/wheel.mjs" due
node "${CLAUDE_SKILL_DIR}/wheel.mjs" recall --limit 30
```

The four analysis scripts need the worker running and resolve its port from
`CLAUDE_MEM_WORKER_PORT`, then `~/.claude-mem/settings.json`. The three that
can't work without it fail with one clear line:

```bash
node "${CLAUDE_SKILL_DIR}/scars.mjs" --help       # scar-tissue
node "${CLAUDE_SKILL_DIR}/forensics.mjs" --help   # prompt-forensics
node "${CLAUDE_SKILL_DIR}/rot.mjs" --help         # truth-decay
node "${CLAUDE_SKILL_DIR}/wheel.mjs" --help       # flywheel
```

`decision-decay` and `cross-pollinate` need no script — they run on the worker's
HTTP API and the MCP tools (`search`, `timeline`, `get_observations`,
`smart_search`) directly.

The wheel only compounds if it turns. Once the cadence is settled, schedule it
where the memory lives — cron (`0 9 * * 1 cd /repo && claude -p "/flywheel"`) or
a SessionStart hook that runs `wheel due` and mentions anything overdue.
