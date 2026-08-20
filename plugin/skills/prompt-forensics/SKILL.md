---
name: prompt-forensics
description: Mine your own prompt history to find which briefs cost you the most turns and rework, then emit concrete CLAUDE.md rules that would have prevented them. Use when asked "why do my sessions go sideways?", "how do I prompt this project better?", "what should be in my CLAUDE.md?", "audit my prompts", or when work keeps needing multiple attempts.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Task
  - AskUserQuestion
---

# Prompt Forensics

Every other memory skill debugs the code. This one debugs **the brief**.

claude-mem stores every prompt you have ever sent alongside what the session
actually produced. Joined, they expose a pattern you cannot see from inside any
single session: a specific *shape* of request that reliably costs you fifteen
turns and ends with open next_steps — and the shape that lands in three.

The output is not a lecture on prompting. It is a **patch to this project's
CLAUDE.md**, derived from your own failures, in your own domain.

## When to Use

- "Why does this keep taking so many tries?"
- "What should be in my CLAUDE.md?"
- Setting up a new project, using an old one's evidence
- After a session that went badly, to generalize the lesson

## Setup

```bash
echo "${CLAUDE_SKILL_DIR}"
node "${CLAUDE_SKILL_DIR}/forensics.mjs" --help
```

Spawned agents don't inherit `CLAUDE_SKILL_DIR` — paste the resolved path into
every brief.

## Phase 1 — Rank sessions by what they cost

```bash
node "${CLAUDE_SKILL_DIR}/forensics.mjs" sessions --project <project> --scan 1500 --top 25
```

Friction is deliberately simple and printed with the output: turns taken, plus a
penalty when the session ended with open `next_steps` or recorded nothing as
completed. The script only counts. **Every interpretation below is the agents'
job, and the ranking is a starting point you are allowed to overrule.**

Read the table yourself before dispatching anything. Two things to check:

- **Long ≠ bad.** A 40-turn session can be one big feature landing cleanly.
  Cross-check the opening prompt: if it was scoped and the session completed,
  drop it from the sample even though it scored high.
- **You need contrast.** Take the top ~10 high-friction sessions *and* ~5
  low-friction ones. Failure modes are invisible without the control group.

Pull the full turn sequence for any session worth reading closely:

```bash
node "${CLAUDE_SKILL_DIR}/forensics.mjs" prompts --session <content_session_id>
```

The escalation pattern inside a session — where the corrections start, what the
user had to repeat — is the richest signal in this entire skill.

## Phase 2 — Cluster the failure modes (FAN OUT)

Split the sampled sessions across 3–4 agents (not one agent per session — the
patterns only appear across sessions). Dispatch in one message.

### Agent brief

> You are analyzing **why some briefs in this project cost more than others**.
> You are looking at real prompts written by the human who owns this repo. Be
> clinical, not judgmental — the deliverable is a rule, not a critique.
>
> **Your sessions (high friction):** `<ids + opening prompts + next_steps>`
> **Control group (low friction):** `<ids + opening prompts>`
>
> For each high-friction session:
> 1. Read the full turn sequence:
>    `node "<skill-dir>/forensics.mjs" prompts --session <id>`
> 2. Find the **turn where it went sideways** — the first correction, the first
>    "no, I meant", the first rework. Quote it.
> 3. Diagnose what the opening brief left out that made that turn necessary:
>    missing constraint, unstated file/scope, undeclared success criterion,
>    ambiguous pronoun, two tasks in one, an assumed convention.
> 4. Check the control group: what did the cheap briefs do differently? If the
>    same omission appears in a session that went fine, it is not the cause.
>
> Return exactly:
>
> - `PATTERN:` the failure mode in one sentence, named (e.g. "scope stated as a
>   symptom, not a file")
> - `EVIDENCE:` ≥2 sessions, each with: session id, the opening prompt quoted,
>   and the turn number where correction started
> - `COUNTEREXAMPLE CHECK:` does this omission also appear in the control group?
>   If yes, say so and lower your confidence
> - `COST:` typical extra turns when this pattern shows up
> - `PROPOSED RULE:` one line, written as an instruction to Claude, that would
>   have removed the correction. It must be checkable — "ask before editing
>   files outside src/" is a rule; "understand context better" is not.
>
> Report at most 4 patterns. Merge near-duplicates. A pattern with one example
> is an anecdote — drop it.

## Phase 3 — Synthesize the patch (you write it)

Collapse overlapping patterns yourself. Then write **two** artifacts:

**1. `docs/prompt-forensics-<date>.md`** — the findings: each pattern, its
evidence, its cost, and the rule that answers it. This is the receipt for why
the CLAUDE.md changed.

**2. A concrete CLAUDE.md patch** — the actual diff you propose to this
project's CLAUDE.md, rules only, no preamble. Rules must be:

- **Checkable** — a reader can tell whether it was followed
- **Local** — about *this* project's conventions, not prompting in general
- **Few** — 3–6 rules. A CLAUDE.md nobody reads changes nothing

Also worth proposing, when the evidence points there rather than at wording: a
hook (`update-config` skill) that enforces the rule mechanically. "Run the
linter before declaring done" is better as a Stop hook than as a sentence.

## Phase 4 — Get consent before editing

CLAUDE.md is the user's instrument. Show the proposed rules with the evidence
next to each one and use `AskUserQuestion` to let them accept, reject, or edit
per rule. Apply only what they accept.

Then close the loop. Record which rules landed, with the friction they were
meant to remove, so the next run can measure them instead of re-deriving them:

```bash
node "${CLAUDE_SKILL_DIR}/../flywheel/wheel.mjs" record \
  --stage prompt-forensics --kind rule-applied \
  --summary "<rule> — targets <pattern>, baseline friction <n> across <m> sessions"
```

Re-run this skill in a month against sessions *after* the patch. Start by
reading `wheel recall --stage prompt-forensics` for the baseline, then compare.
If friction didn't move, the rules were wrong — record that too (`--kind
rule-ineffective`), because a rule that doesn't work should be removed from
CLAUDE.md rather than left to accumulate.

## Failure Modes

- **Generic prompting advice.** "Be more specific" is not a finding. If a rule
  could apply to any repo on earth, it isn't from this evidence — cut it.
- **No control group.** Without cheap sessions to compare against, every
  omission looks causal.
- **Blaming the human.** The output is a rule for Claude, phrased as a rule for
  Claude. Same facts, and it's the version that gets adopted.
- **Turn count as truth.** Long sessions include the good ones. Always read the
  opening prompt before calling a session a failure.
- **Patching CLAUDE.md silently.** Never edit it without explicit per-rule
  consent — an unrequested rule in a shared repo will outlive the conversation
  that justified it.
