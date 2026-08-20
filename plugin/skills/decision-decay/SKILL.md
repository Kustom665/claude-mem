---
name: decision-decay
description: Audit every architectural decision recorded in memory against what the code actually does now, and classify each as held, drifted, reversed, or obsolete. Use when asked "are we still doing what we decided?", "did we drift?", "audit our architecture decisions", before a big refactor or a rewrite, or when onboarding someone who keeps asking "why is it like this?"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Task
---

# Decision Decay

Decisions are the most expensive thing in a codebase and the least maintained.
Someone decides "the worker owns all writes to SQLite," it's recorded, and
eighteen months later four other paths write to SQLite — not because anyone
overruled the decision, but because nobody ever checked.

claude-mem has been recording those decisions the whole time. This skill turns
them into a **ledger with a current verdict on each one**: still held, quietly
drifted, deliberately reversed, or overtaken by events.

You are the orchestrator. Agents verify decisions against code. You write the
ledger and, at the end, ask the human to re-ratify or repeal the drifted ones.

## When to Use

- "Are we still following our own architecture?"
- Before a refactor, so you rebuild against decisions that still hold
- Onboarding: the ledger answers "why is it like this?" better than the code
- After a period of fast shipping, to find what got trampled

## Setup

```bash
WORKER_PORT="${CLAUDE_MEM_WORKER_PORT:-$(node -e "const fs=require('fs'),p=require('path'),os=require('os');const uid=(typeof process.getuid==='function'?process.getuid():77);const fallback=String(37700+(uid%100));try{const s=JSON.parse(fs.readFileSync(p.join(os.homedir(),'.claude-mem','settings.json'),'utf-8'));process.stdout.write(String(s.CLAUDE_MEM_WORKER_PORT||fallback));}catch{process.stdout.write(fallback);}" 2>/dev/null)}"
```

Detect the project name the way the other claude-mem skills do — in a worktree,
the data lives under the **parent** project:

```bash
git_dir=$(git rev-parse --git-dir 2>/dev/null)
git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
if [ "$git_dir" != "$git_common_dir" ]; then
  project=$(basename "$(dirname "$git_common_dir")")
else
  project=$(basename "$PWD")
fi
echo "$project"
```

## Phase 1 — Pull the decisions

Two sources, use both:

```bash
# Formatted index of decision-type observations
curl -s "http://localhost:${WORKER_PORT}/api/decisions?project=${project}&limit=60"

# Raw rows (title, narrative, facts, files, epoch) for anything you want in full
curl -s "http://localhost:${WORKER_PORT}/api/search/by-type?type=decision&project=${project}&limit=60"
```

For full records of specific IDs, use the `get_observations` MCP tool — it
batches, and the narrative is where the actual reasoning lives.

**Deduplicate before fanning out.** The same decision is often recorded several
times across sessions, sometimes with drifting wording. Collapse them by subject
and keep every ID — an agent should see all recordings of the decision it audits,
because the *diff between recordings* is itself drift evidence.

Cap the audit at ~15 decisions per run. Prefer: recent, load-bearing, and ones
whose files are still hot. Say which ones you deferred.

## Phase 2 — One verifier per decision (FAN OUT)

Dispatch in one message. Each agent owns exactly one decision.

### Agent brief

> You are auditing **one recorded decision** against the current code.
>
> **Decision (observation IDs `<ids>`):**
> `<title + narrative + facts, pasted in full>`
> **Files it named:** `<files_modified / files_read from the observation>`
> **Recorded:** `<date>`
>
> Your job is not to judge whether the decision was good. It is to establish
> **what the code does now**, and whether that still matches.
>
> 1. Read the named files at their current state. They may have moved — search
>    for the concept, not just the path (`smart_search` MCP tool, then Grep).
> 2. Find every place that *should* obey the decision, not just the place it was
>    made. A decision about "all writes go through X" is violated at the fourth
>    call site, not the first.
> 3. Look for an explicit later reversal: a newer decision observation, a commit
>    message, or a comment that overrules it.
>
> Return exactly:
>
> - `DECISION:` one line, in your own words
> - `STATUS:` `HELD` | `DRIFTED` | `REVERSED` | `OBSOLETE`
>   - HELD — code still matches
>   - DRIFTED — violated in practice, no record of anyone deciding to
>   - REVERSED — deliberately overruled later (cite the newer decision/commit)
>   - OBSOLETE — the thing it governed no longer exists
> - `EVIDENCE:` `file:line` for every claim. For DRIFTED, cite each violating
>   site. For HELD, cite the sites you checked that comply — "I looked and it's
>   fine" without paths is not a finding.
> - `BLAST RADIUS:` what depends on this decision holding
> - `CONFIDENCE:` high/medium/low, and what you could not verify

### Reject and redeploy

- `HELD` with no compliance citations → "name the sites you checked."
- `DRIFTED` with one violating site that is a comment or a test fixture →
  downgrade; tests and docs drift for benign reasons.
- Any status argued from the observation text alone, with no current-code read →
  redeploy. The whole point is the *now*.

## Phase 3 — The ledger (you write it)

Write `DECISION-LEDGER.md` at repo root (or update it in place if it exists):

```markdown
# Decision Ledger — <project>, audited <date>

| # | Decision | Recorded | Status | Evidence |
|---|----------|----------|--------|----------|
| #1234 | Worker owns all SQLite writes | 2026-01-04 | DRIFTED | src/a.ts:88, src/b.ts:210 |
```

Then, per non-HELD decision, a short section: what was decided, what the code
does now, where it diverged, and the cost of leaving it. Keep the reasoning from
the original narrative — that's the part nobody can reconstruct later.

## Phase 4 — Re-ratify or repeal

Drift is only worth auditing if something happens after. For each `DRIFTED`
decision, put the choice to the human plainly — use `AskUserQuestion` for the
clear-cut ones:

- **Re-ratify** — the decision still stands; the violations are bugs. Hand the
  violating sites to `/make-plan` as a cleanup.
- **Repeal** — reality won; the decision was wrong or overtaken. Record the
  repeal so the next audit sees `REVERSED` instead of re-flagging the same drift
  forever:

  ```bash
  node "${CLAUDE_SKILL_DIR}/../flywheel/wheel.mjs" record \
    --stage decision-decay --kind repeal \
    --summary "<decision> repealed: <what replaced it>" \
    --refs <decision observation IDs>
  ```

  Use `--kind reratified` for the other outcome, and `--open` for anything left
  undecided. Do not use the `memory_add` / `observation_add` MCP tools — they
  require the server-beta runtime and throw on a default SQLite install.

Write the outcome back into the ledger too. An audit that ends without a
recorded disposition will produce the identical report next quarter.

## Failure Modes

- **Auditing the observation, not the code** — the most common failure. Every
  status needs a current `file:line`.
- **Treating every divergence as drift** — specialization, migrations in
  progress, and deliberate exceptions are not drift. Ask whether anyone *chose*
  it; if yes, it's REVERSED, not DRIFTED.
- **No disposition** — a ledger nobody re-ratifies is a document, not an audit.
- **Fanning out on duplicates** — three agents auditing three recordings of one
  decision produce three conflicting statuses. Collapse first.
