# Council of the Damned

A [Claude Code](https://claude.com/claude-code) skill that fans one task out to several
independent agents (mixed models, no cross-visibility), then makes them blind-review,
rebut, and eliminate each other's work until one winner remains, or the judge returns
`flawed` and nothing lands.

One task → N isolated agents → blind review → rebuttal → judge → one winner applied
uncommitted, or `flawed` and stop.

## Modes

| Request words | Mode | What members produce |
|---|---|---|
| plan, design, options, how should we | design | Approach write-ups, critiqued read-only |
| implement, fix, change, add, refactor | build | Real diffs in private git worktrees, tests run by peers |
| write tests, cover, spec, prove | test | Spec files proven RED then GREEN, mutation-checked by peers |
| review PR / branch / diff | review | Independent reviews cross-checked, merged findings + test plan |

Saying "council" or "convene" forces a run. Single-file mechanical changes are skipped
with a one-line `council skipped: <reason>`.

## Install

```
git clone <this repo> ~/.claude/skills/council-of-the-damned
```

Requirements: Claude Code with the `Workflow` and `Agent` tools, git 2.5+ (worktrees).
No dependencies; the workflows are plain JS run by the Workflow tool.

## Config

`council.config.json`:

```json
{
  "roster": [
    { "model": "fable", "effort": "high" },
    { "model": "fable", "effort": "high" },
    { "model": "opus",  "effort": "high" },
    { "model": "opus",  "effort": "high" },
    { "model": "sonnet","effort": "high" }
  ],
  "judge": { "model": "fable", "effort": "max" },
  "minExamplesPerWorkflow": 5,
  "minWorkflows": 3,
  "rebuttalFix": true,
  "keepWorktrees": false,
  "transcriptDir": "~/.claude/council"
}
```

Roster size is the cost knob. A 5-member build run is roughly 15 to 20 agent calls and
can cost well over a million tokens; use "small council" (first 3 seats) or
"council with 2 sonnet" for cheaper runs. If `fable` is not available in your session,
its seats run on `opus`.

Transcripts land in `<transcriptDir>/<repo-name>/<date>-<slug>.md` and fill in live.

## Safety notes

- Build/test members work in `council-wt-<slug>-<label>` worktrees next to the repo and
  link the main checkout's dependency dir (`node_modules`, `.venv`) into them. Removing
  a worktree while that link is present deletes the real dependency dir. The skill
  unlinks first and verifies; if you clean up by hand, do the same.
- Members and the judge may only run read-only git in the main repo. The skill records
  branch and status before a run and checks them after.
- Nothing is committed. The winner's diff is applied to the main tree uncommitted.

## Files

- `SKILL.md` — the orchestrator's instructions (trigger, brief, launch, delivery)
- `SPEC.md` — design spec, evidence floor, gotchas found in live runs
- `council.config.json` — defaults
- `workflows/council-{design,build,test,review}.js` — Workflow scripts, one per mode
