---
name: truth-decay
description: Verify stored memories against the current codebase and quarantine the ones that are no longer true, so stale context stops being injected as fact. Use when asked to "clean up memory", "audit the memory database", "why does Claude keep believing X?", when context injection references deleted files or old architecture, or on a periodic memory health check.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Task
  - AskUserQuestion
---

# Truth Decay

Every observation in claude-mem was true when it was written. Nothing re-checks
it. The code moves — files get deleted, functions get renamed, the architecture
the memory describes gets replaced — and the memory keeps getting injected into
new sessions with the same confidence as the day it was recorded.

A memory system without garbage collection doesn't decay gracefully; it decays
into a confidently wrong assistant. This skill is the immune system: cheap
triage, then verification agents, then quarantine.

## When to Use

- Context injection is citing files or systems that no longer exist
- "Why does Claude keep thinking we use X?"
- After a large refactor, rename, or directory restructure
- Periodic hygiene on a long-lived project

## Setup

```bash
echo "${CLAUDE_SKILL_DIR}"
node "${CLAUDE_SKILL_DIR}/rot.mjs" --help
```

Spawned agents don't inherit `CLAUDE_SKILL_DIR` — paste the resolved path into
every brief.

## Phase 1 — Cheap triage (no agents)

```bash
node "${CLAUDE_SKILL_DIR}/rot.mjs" scan --project <project> --scan 1500 --top 40
node "${CLAUDE_SKILL_DIR}/rot.mjs" files --project <project> --scan 1500
```

`scan` flags observations whose referenced files no longer exist on disk, plus
anything old enough to warrant a re-check. `files` rolls that up by vanished
file, so you can see which deletion poisoned the most memories at once.

**A rot signal is a suspicion, not a verdict.** Missing files have three very
different causes:

- **Renamed or moved** — the memory's *content* may still be entirely true
- **Deleted** — the memory is probably describing something gone
- **Path form mismatch** — the file exists but was stored under a different
  root; check before you believe the signal

The `files` rollup usually makes the cause obvious: a whole directory going
missing at once is a move, not thirty deletions.

## Phase 2 — Verify the suspicious ones (FAN OUT)

Batch ~5 related observations per agent (same file, same subsystem, same
deletion event). Related observations share one investigation — one agent
establishing "this module moved to `src/services/`" resolves the whole batch.
Cap at ~8 agents; take the worst signals first and say what you deferred.

### Agent brief

> You are checking whether a small batch of stored memories is **still true**.
>
> **Observations:** `<ids>` — fetch full records with the `get_observations` MCP
> tool. Do not judge from titles.
> **Rot signal:** `<all-files-gone | some-files-gone | aged>`
> **Files that appear to be missing:** `<paths>`
>
> For each observation:
>
> 1. Establish what actually happened to the referenced code. Was it deleted, or
>    did it move? Search for the symbols and content, not just the path
>    (`smart_search` MCP tool, then Grep, then `git log --diff-filter=D
>    --name-only` for deletions and `git log --follow` for renames).
> 2. Read the memory's actual claim. A memory can reference a deleted file and
>    still state something true — the claim may be about a decision or a
>    behavior that outlived the file.
> 3. Classify against the code as it is **now**.
>
> Return one block per observation:
>
> - `ID:`
> - `STATUS:` `TRUE` | `MOVED` | `FALSE` | `UNVERIFIABLE`
>   - TRUE — the claim still holds, whatever happened to the paths
>   - MOVED — still true, but the paths are wrong (give the new ones)
>   - FALSE — the claim contradicts current code
>   - UNVERIFIABLE — cannot be checked against code (e.g. a decision about
>     process, an external service). **Default here when unsure. Deleting a true
>     memory costs more than keeping a stale one.**
> - `EVIDENCE:` `file:line` from the current tree, or the git command and its
>   output that proves the deletion/rename
> - `CORRECTED CLAIM:` for MOVED and FALSE — what is true instead, if you can
>   state it confidently
>
> Never edit, delete, or write memory. Report only.

## Phase 3 — Check what would get written (FAN OUT)

`TRUE` and `UNVERIFIABLE` change nothing, so they need no scrutiny. `MOVED` and
`FALSE` both **write to memory** — and a wrong correction is worse than the
stale memory it replaces, because it arrives with a fresh timestamp and gets
injected into future sessions as current fact. Verify in proportion to that.

### `MOVED` — mechanical check, no agent

The claim survives; only the path changed. So the only thing to verify is that
the new path is real:

```bash
test -e "<new path>" && echo present || echo MISSING
```

`MISSING` means the agent guessed. Send that one back rather than panelling it —
an agent that can't name a path that exists hasn't found where the code went.

### `FALSE` — refutation panel

`FALSE` authorizes writing "X is no longer true" into a store that future
sessions read without question. Three refuters per `FALSE`, one message,
different lenses — a wrong `FALSE` fails in three distinct ways:

| Lens | The question | The mistake it catches |
|---|---|---|
| **Claim** | Is the memory actually asserting what the verifier thinks? | Read the title, not the narrative; contradicted a claim never made |
| **Relocation** | Does the code still do this somewhere else? | Confused "moved" with "gone" |
| **Environment** | Is the tree being read the right one? | Wrong branch, dirty worktree, generated files absent, submodule not checked out |

### Refuter brief

> You are trying to **refute** a claim that a stored memory is now false.
> Assume the claim is wrong and look for the reason.
>
> **Memory `#<id>`:** fetch the full record with `get_observations` — do not
> work from the title.
> **The verdict to refute:** `<the FALSE verdict and its evidence, verbatim>`
> **Your lens: `<claim | relocation | environment>`** — `<the question above>`
>
> Return exactly:
>
> - `LENS:`
> - `REFUTED:` `true` | `false`
> - `WHY:` specific, with `file:line` or the git output you read differently.
>
> **If you cannot establish either way, return `refuted: true`.** An unproven
> `FALSE` should not become a correction. Leaving a stale memory costs a little
> confusion; writing a false correction costs the store's credibility.

**Two of three refute → the verdict drops to `UNVERIFIABLE`.** No correction gets
written, and it joins the recorded unverifiable set so the next run doesn't
re-spend agents on it.

## Phase 4 — Disposition (you decide, the user approves)

Group the verdicts and put them to the user — nothing here happens silently.

- **TRUE** — no action. Report the count; it's the reassuring number.
- **MOVED** — the highest-value outcome, once the new path passed the `test -e`
  check. Record a correction stating the current location and referencing the
  stale ID, so future retrieval surfaces the correction alongside the original:

  ```bash
  node "${CLAUDE_SKILL_DIR}/../flywheel/wheel.mjs" record \
    --stage truth-decay --kind correction \
    --summary "<old claim> is stale: <what is true now>" \
    --refs <stale observation IDs> --files <current paths>
  ```

  Use this rather than the `memory_add` / `observation_add` MCP tools — those
  require the server-beta runtime and throw on a default SQLite install.
- **FALSE** — only the ones that survived the panel. Propose the same kind of
  correction, explicitly superseding ("as of `<date>`, X is no longer true; Y
  is"), and note the vote in the summary. Ask before writing.
- **UNVERIFIABLE** — leave alone, and record the set once with `--kind
  unverifiable --open` so the next run skips it instead of re-spending agents on
  the same unresolvable batch. Panel-killed `FALSE` verdicts land here too.

**Prefer superseding over deleting.** A correction is auditable, reversible, and
carries the history of what changed; a deletion is silent and permanent. Only
raise deletion if the user explicitly wants pruning, and confirm the specific IDs
first with `AskUserQuestion`.

## Phase 5 — Report

- Scanned / flagged / verified counts, and the split across the four statuses
- How many `FALSE` verdicts the panel killed — a high kill rate means the
  verifiers are over-calling and the next run should batch more tightly
- The corrections written, with IDs
- The vanished files with the widest blast radius — usually one rename that the
  user can confirm in a second
- What you deferred, so the next run starts there

## Failure Modes

- **Trusting the file check.** `rot.mjs` proves a path doesn't resolve, nothing
  more. Every FALSE needs an agent's evidence behind it, then a panel's failure
  to refute it.
- **Deleting on suspicion.** Stale-but-recoverable beats gone. Supersede.
- **Panelling the harmless verdicts.** `TRUE` and `UNVERIFIABLE` write nothing.
  Spend the agents on what changes the store.
- **Refuters that review instead of refute.** Ask an agent whether a finding is
  good and it will usually agree. Ask it to kill the finding, and make
  can't-establish count as refuted.
- **One agent per observation.** Related memories share one investigation —
  batching is what makes this affordable.
- **Verifying against a dirty tree or the wrong branch.** Check `git status` and
  the current branch first; a half-finished refactor makes everything look false.
- **Running it on a repo that isn't the project's real root.** Pass `--root`
  explicitly when the checkout lives somewhere unusual, or every path will
  look missing.
