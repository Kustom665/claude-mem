---
name: cross-pollinate
description: Search every OTHER project in claude-mem for a problem you already solved elsewhere, then produce a transplant plan for bringing that solution into the current repo. Use when stuck on something that feels familiar, when asked "have I solved this before?", "did I do this in another project?", "how did I handle this at the other client?", or when starting a new repo that should inherit patterns from old ones.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Task
---

# Cross-Pollinate

claude-mem scopes memory to a project by default, and for good reason — you want
*this* repo's context, not everything you have ever done. But that scoping
quietly throws away the most valuable thing a multi-project developer owns: the
fact that **you already solved this, in a different repo, eight months ago.**

This skill deliberately breaks the scoping. One agent per foreign project, each
hunting its own memory for the analogue of your current problem, then a
transplant plan that says what to port, what to change, and what to leave.

Especially valuable when you run many repos that rhyme — client sites, service
templates, a fleet of small apps. The second time you solve something should
cost a tenth of the first.

## When to Use

- Stuck on something that feels like déjà vu
- "Have I done this before?" / "How did I handle auth at the other client?"
- Bootstrapping a new repo that should inherit hard-won patterns
- Estimating: "how long did this take me last time?" (past sessions know)

## Setup

```bash
WORKER_PORT="${CLAUDE_MEM_WORKER_PORT:-$(node -e "const fs=require('fs'),p=require('path'),os=require('os');const uid=(typeof process.getuid==='function'?process.getuid():77);const fallback=String(37700+(uid%100));try{const s=JSON.parse(fs.readFileSync(p.join(os.homedir(),'.claude-mem','settings.json'),'utf-8'));process.stdout.write(String(s.CLAUDE_MEM_WORKER_PORT||fallback));}catch{process.stdout.write(fallback);}" 2>/dev/null)}"

curl -s "http://localhost:${WORKER_PORT}/api/projects"
```

That's the full list of projects claude-mem knows about — the search space.

## Phase 1 — State the problem precisely

Do this before touching memory. Write, in two or three lines:

- **The problem** in solution-neutral terms. "Uploads over 10MB time out behind
  the proxy" travels between repos; "fix `uploadHandler.ts`" does not.
- **The constraints** that must hold here (runtime, framework, hosting, data
  shape).
- **What you already tried** in this repo, so agents don't hand it back.

Confirm this framing with the user in one line before fanning out. A vague
problem statement produces five agents returning five different things.

## Phase 2 — One hunter per foreign project (FAN OUT)

Pick the candidate projects from `/api/projects`. Skip the current one — that's
`mem-search`'s job, and you should run it first anyway to be sure the answer
isn't already local. Cap at ~8 hunters; prefer projects with real volume and
technical kinship.

Dispatch in one message.

### Agent brief

> You are searching **one project's memory** for a solved analogue of a problem
> in a different repo. Your project: **`<project>`**.
>
> **The problem (in the other repo):** `<solution-neutral statement>`
> **Constraints there:** `<constraints>`
>
> Search only within `<project>`:
>
> 1. `search(query="<problem terms>", project="<project>", limit=25)` — try 2–3
>    phrasings, including the symptom and the mechanism.
> 2. Narrow by type where it helps: `obs_type="bugfix"` for "it broke",
>    `"decision"` for "how should this work", `"feature"` for "build this".
> 3. `timeline(anchor=<id>, project="<project>")` around anything promising —
>    the fix that stuck is usually a few observations after the first attempt,
>    and the first attempt is often the wrong one.
> 4. `get_observations(ids=[...])` for full narratives on the real candidates.
> 5. If the observations name files and that repo is on this machine, read the
>    actual code. Memory says what was decided; code says what shipped.
>
> Return exactly:
>
> - `MATCH:` `STRONG` | `PARTIAL` | `NONE` — be willing to return NONE; a
>   forced match wastes the orchestrator's time and pollutes the plan
> - `WHAT WAS SOLVED:` the analogous problem, in that project's terms
> - `HOW:` the actual mechanism, concretely. Name files, functions, libraries,
>   config. Include the code if you could read it.
> - `EVIDENCE:` observation IDs and dates; `file:line` for anything you read
> - `WHY IT MIGHT NOT TRANSFER:` the honest version — different framework,
>   different scale, a constraint that only existed there
> - `SCARS:` anything in that project's memory showing this solution later
>   caused trouble. This is as valuable as the solution.

## Phase 3 — The transplant plan (you write it)

Only `STRONG` and `PARTIAL` matches survive. If everything came back `NONE`, say
so plainly — "you have not solved this before" is a real, useful answer, and it
means the work ahead is genuinely new.

Write the plan:

1. **Source** — which project, which observations, why it's the analogue
2. **The mechanism** — what actually solved it there, in enough detail to build
3. **The delta** — every place the current repo differs, and what each
   difference forces you to change. This section is the whole plan; the rest is
   framing.
4. **What NOT to port** — the parts that were local accidents. Copying a
   solution wholesale across repos is how you inherit someone else's
   constraints, including your own past self's.
5. **Known scars** — what went wrong with this approach afterward, from Phase 2
6. **Handoff** — a ready-to-paste `/make-plan` prompt to implement it here

## Phase 4 — Close the loop

After the transplant lands, record an observation (`memory_add` MCP tool) that
names both projects and the fact that this pattern travelled. The next
cross-pollination run finds *that* observation first and skips straight to the
answer. Repeat this a few times and the fleet starts compounding.

## Failure Modes

- **Skipping the local search.** Run `mem-search` on the current project first.
  Importing a solution you already have here is embarrassing and slow.
- **Topic matching.** "Also about authentication" is not an analogue. The
  *failure mechanism* or *design pressure* has to match — insist on that in the
  brief and reject reports that don't show it.
- **Porting the code instead of the mechanism.** Different repo, different
  framework version, different constraints. Port the idea, rebuild the code.
- **Ignoring the scars.** The follow-up bugfixes in the source project are
  exactly what you get to skip this time. An agent that returns a solution with
  no scar check did half the job.
- **Client-boundary blindness.** If projects belong to different clients or
  employers, licensing and confidentiality apply to code, snippets, and
  proprietary specifics — port your general approach, not their material, and
  flag it when the line is close.
