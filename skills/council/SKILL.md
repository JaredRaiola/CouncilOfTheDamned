---
name: council
description: "Consult when the deliverable is a plan or a change (design, implement, fix, refactor, write tests), in any repo, and decide whether to convene a council of independent mixed-model agents. Always consult when the user asks to plan, design, implement, fix, change, add, refactor, write tests, or review a PR/branch/diff, or says 'council', 'convene', 'council of the damned'. When it convenes: candidates work blind in isolated worktrees, then blind-review, rebut, and a judge eliminates until one winner (or a flawed verdict) remains. When it skips (single-file mechanical change, one clear approach, not explicitly requested): says so in one line and lets the work proceed normally. Not for questions: explanations, diagnosis, or reading code are answered first; the council is consulted only if a change follows. Also handles 'council config' to show or change the user's default roster, judge, floor and toggles."
user-invocable: true
argument-hint: "[design|build|test|review|config] [--roster name|m1,m2] [--judge model] [--brief file] [--floor N] [--just-go] task"
---

# Council of the Damned

One task → N independent agents (mixed models, no cross-visibility) → blind review →
rebuttal → judge kills the weak → one winner applied uncommitted, or `flawed` and stop.
Always considered; convenes per §0. Roster size is the cost knob.

Invoked as `/council <args>` (`$ARGUMENTS` holds everything after the command) or by the
model when a plan/change request arrives. If the first word of `$ARGUMENTS` is `config`,
skip to §2b and do nothing else.

## 0. Convene or skip

Always convene (review mode) for a code review: "review PR N", "review this branch/diff". A review is not skipped as "no code change".

`autoConvene: false` in the effective config (§2) turns off automatic convening: skip with `council skipped: autoConvene off` unless the user typed `/council`, or said "council" or "convene". Everything below still applies once one of those forces it.

Not a trigger: a question. Explanations, diagnosis, "is this a bug", "what does this do", and reading code are answered directly with no council decision. Consult this skill only when the deliverable is a plan or a change, which is usually the message after the answer.

Convene when ANY of:
- the change touches more than one file, or more than one user workflow
- it changes business logic, data shape, auth, money, or a server contract
- the request is ambiguous or has more than one reasonable approach
- the user says "council" or "convene" (this always forces it, regardless of the other criteria)

Skip when it is a single-file mechanical change (rename, typo, config value, obvious one-liner) with one clear approach, AND the user did not say "council" or "convene". On skip: state exactly one line —
```
council skipped: <reason>
```
— then proceed with the work normally, without the rest of this skill.

## 1. Resolve mode

| Words in the request | Mode | Script |
|---|---|---|
| plan, design, options, how should we, approach | design | `workflows/council-design.js` |
| implement, fix, change, add, refactor, build | build | `workflows/council-build.js` |
| write tests, cover, spec, prove | test | `workflows/council-test.js` |
| review (a PR, branch, or diff), test plan for a PR | review | `workflows/council-review.js` |

Explicit mode as the first word of `$ARGUMENTS` or "council <mode>" in prose wins. Build wins over design when both appear ("plan and implement").

### Flags

Flags may appear anywhere in `$ARGUMENTS` or in prose; a flag wins over the prose form. Everything that is not a mode word or a flag is the task text.

| Flag | Prose form | Effect (this run only) |
|---|---|---|
| `--roster <preset>` | "small council", "cheap council" | roster = that preset from `rosters` |
| `--roster m1,m2,...` | "council with 3 opus and 1 sonnet" | roster = exactly those seats; each seat is `model` or `model:effort`, effort defaults to `high` |
| `--judge model[:effort]` | "judge opus" | judge seat |
| `--floor N` | "floor 3" | `minExamplesPerWorkflow` = N |
| `--no-rebuttal-fix` | "no rebuttal fix" | `rebuttalFix` = false |
| `--keep-worktrees` | "keep worktrees" | `keepWorktrees` = true |
| `--brief <file>` | "brief: <file>" | use that file as the brief (§3) |
| `--just-go` | "just go" | skip the brief's questions and approval (§3) |

Model names are whatever the Agent tool's model list offers this session (`fable`, `opus`, `sonnet`, `haiku`). Effort is `low`, `medium`, `high` or `max`. A roster longer than 10 seats is truncated by the scripts.

## 2. Resolve config

Effective config = bundled defaults, then the user's file, then flags (§1):

1. `council.config.json` next to this SKILL.md: the bundled defaults. Never edit it in place; a plugin update replaces it.
2. `<config dir>/council.config.json`, where `<config dir>` is `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`. Optional; any key present overrides the same key from step 1 (`rosters` merges per preset name).
3. Flags and prose overrides from §1.

Then resolve seats: `roster` is a preset name looked up in `rosters` (or an explicit list from `--roster`); each seat string `model[:effort]` becomes `{ "model", "effort" }` for the scripts, and `judge` the same way. `~` in `transcriptDir` means `<config dir>`'s parent home directory.

If `fable` is not in the Agent tool's model list this session, replace every `fable` seat (roster and judge) with `opus` at the same effort before convening. Same if a fable agent fails mid-run on credits/availability: resume the run (`resumeFromRunId`) with those seats as opus — finished agents replay from cache. `council-review.js` also retries a failed fable seat on opus by itself.

## 2b. `/council config` — show or change the defaults

Operates only on the user's file from §2 step 2 (create it if missing, keys not mentioned stay as they were). After every change print the file's full contents and its path. Forms:

| Command | Effect |
|---|---|
| `/council config` | print the effective config (steps 1+2 merged), marking which keys come from the user's file, and the file's path |
| `/council config roster <preset>` | default roster = that preset (must exist in `rosters`) |
| `/council config roster <preset> m1,m2,...` | define or replace preset `<preset>` with those seats, and make it the default |
| `/council config preset <name> m1,m2,...` | define or replace a preset without changing the default |
| `/council config judge model[:effort]` | default judge |
| `/council config floor N` | `minExamplesPerWorkflow` |
| `/council config <key> <value>` | any other key: `autoConvene`, `minWorkflows`, `rebuttalFix`, `keepWorktrees`, `transcriptDir` (`on`/`off`/`true`/`false` for booleans) |
| `/council config reset` | delete the user's file; bundled defaults apply again |

Validate before writing: seats are `model[:effort]` with a known effort, presets referenced by `roster` exist, numbers are positive integers. On a bad value, say what is wrong and write nothing.

## 3. Summons (brief, always drafted)

The brief is ALWAYS drafted from the repo and passed to every candidate. "Just go" skips only step 3's clarifying questions (go straight from the draft to §4); it never skips drafting or sending the brief itself. Draft the **council brief** by reading the repo (read-only):

```
## Task
<one paragraph>
## Entry points
<files / functions / routes the change touches>
## Constraints
<business rules, applicable memory rules, do-not-touch areas, repo conventions>
## Affected workflows
<numbered user-facing flows you can see; candidates may add or challenge>
## Evidence that counts
<unit tests, driven runs, e2e — which are available here and what each needs; evidence counts ONLY if it executes code in the member's OWN worktree — a server or bundle built outside it (e.g. the main checkout's dist or a running dev server) proves nothing>
## Dependency dir to link into worktrees
<node_modules / .venv / none>
## Done criteria
<bullets>
```

**User-supplied brief (`--brief <file>`).** Read the file; it uses the same headings. Sections it contains are taken verbatim and never rewritten. Only sections it omits are drafted from the repo as above. A user-supplied brief implies "just go" unless a section had to be drafted, in which case show only the drafted sections and ask about those. The file itself is never modified.

Unless the user said "just go": show it, ask at most 3 targeted questions only where the request is ambiguous, and let the user edit or approve it. If the user said "just go", skip the questions and approval step and use the drafted brief as-is. Either way, the resulting brief is passed verbatim to every candidate.

## 4. Convene

Compute `repoName` = basename of the git root, `date` = today YYYY-MM-DD, `slug` = 3-6 kebab words from the task. Transcript path = `<transcriptDir>/<repoName>/<date>-<slug>.md` (expand `~`, mkdir -p, suffix `-2`, `-3` if it exists). If the transcript needed a `-2`/`-3` suffix, append that same suffix to the `slug` value passed in `args` — the scripts name member worktrees `council-wt-<slug>-<label>`, so this keeps a same-day re-run from colliding with worktrees a previous `flawed` verdict left in place. Write the brief as the transcript's first section before launching:

```
# Council of the Damned — <slug>
Mode: <mode> · Roster: <N> members · <date>

## Brief
<brief verbatim>
```

Pre-flight (build/test): `git -C <git root> worktree list` must show no `council-wt-<slug>-*` worktree. If one exists, STOP and tell the user — never launch over it. Record `git -C <git root> branch --show-current` and `git -C <git root> status --porcelain` now; §5 checks them before delivery.

Git root = `git rev-parse --show-toplevel`, converted to `C:\...` form on Windows (in Bash: `cygpath -w "$(git rev-parse --show-toplevel)"`) before it is passed as `args.repo` — never a `/c/...` path; the scripts' `win()` only normalises slashes. Compute `base` = `git -C <git root> rev-parse HEAD` (the scripts branch every worktree from it and delivery diffs against it; members never report it), and `briefWorkflowCount` = the number of numbered items in the brief's "Affected workflows" section.

Then call the Workflow tool:

```
Workflow({ scriptPath: "<skill root>/workflows/council-<mode>.js",
  args: { brief, mode, repo: "<git root>", repoName, base, briefWorkflowCount, depDir, evidenceNotes, roster, judge,
          minExamplesPerWorkflow, minWorkflows, rebuttalFix, keepWorktrees, transcript, date, slug } })
```

`roster` is the resolved array of `{ model, effort }` objects and `judge` one such object (§2), never preset names or `model:effort` strings. `depDir` and `evidenceNotes` are taken verbatim from the brief's "Dependency dir to link into worktrees" and "Evidence that counts" sections (`depDir` is `none` → pass empty/falsy). `briefWorkflowCount` goes to the judge, which treats unjustified exclusions of brief-listed workflows as a major flaw; dead on arrival is total proven examples < `minExamplesPerWorkflow` only.

Tell the user the transcript path so they can watch it fill. Wait for the task notification; do not poll.

## 5. Deliver

The workflow returns `{ submissions, reviews, rebuttals, verdict, transcript }`. `verdict` is:
```
{ flawed, reasons, eliminated:[{label, reason}], ranking:[label], winner, grafts:[{from, what, how}], models:{A:"fable",...}, degraded?:[string] }
```

- **Main-repo check (build/test, every verdict, before anything else)** → `git -C <repo> branch --show-current` and `git -C <repo> status --porcelain` must equal what §4 recorded. If the branch differs, restore it with `git -C <repo> checkout <recorded branch>` and report the deviation (and any porcelain difference) to the user before delivering. Also run `git -C <repo> branch -r --list 'origin/*council*'` and report any unexpected remote branch — an agent may have pushed or opened a PR it had no business opening.
- **degraded** (a member, reviewer or rebuttal agent died, or a member went unreviewed) → print `DEGRADED: <each entry>` as the FIRST line of your report, before anything else, and ask the user before applying anything — an unreviewed diff never auto-lands.

- **flawed** → say so and list reasons. In build/test mode, also list this run's worktrees from `git -C "<args.repo>" worktree list | grep -E "council-(wt|scratch)-<slug>-"` (NOT from `submissions[]` — a member that died still left its worktree and junction) for inspection, with the warning: before deleting any of them by hand, unlink `<worktree>\<depDir>` first (`cmd /c rmdir` / `cmd //c rmdir`, backslash paths, or `rm` without `-r`) and confirm it is gone — `git worktree remove --force` on a worktree that still holds the junction wipes the main checkout's `<depDir>` (design mode has no worktrees). Touch nothing.
- **build / test winner** → find the submission whose `label` equals `verdict.winner`: `submissions.find(s => s.label === verdict.winner)`; take its `base` and `worktree`. Run these via the Bash tool (PowerShell 5.1 `>` writes UTF-16 and corrupts the patch). (1) `git -C <winner.worktree> add -A` (captures untracked and uncommitted work); (2) `git -C <winner.worktree> diff --cached --binary <base> > <patch>` (`<patch>` = a file in your scratch dir); (3) `git -C "<args.repo>" apply --check <patch>` — on failure report the error and STOP: apply nothing, remove no worktree; (4) `git -C "<args.repo>" apply <patch>`. Then apply each graft by hand from the named worktree. Run the winner's `testCommand` once in the main tree and paste the tail. Leave uncommitted.
- **review** → returns `{ reviews, checks, verdict: { findings:[{title, file, line, severity, scenario, confirmedBy}], dropped:[{title, why}], testPlan:[{area, steps, expect}], degraded? } }`. No worktrees, no winner: members review the same checkout independently, each cross-checks the others' findings against the code (confirm/refute with file:line), and the judge keeps confirmed findings, re-checks disputed ones itself, and merges the test plans. Report findings most-severe first, then the test plan. The brief names the checkout (a worktree of the PR head, deps installed) and results already run (typecheck, tests) so members don't repeat them.
- **design winner** → the winning approach is already in the transcript; print its summary and offer "build the winner" (re-run this skill in build mode with the winning approach appended to the brief). Design mode has no worktrees, so no cleanup step applies.
- **Building the link path (proven 2026-09-24):** never hand-assemble backslash paths in bash (`"$W\$DEP"` silently produced a wrong path twice and `rmdir` printed "cannot find the file"). Build it with `LINK=$(cygpath -w "<worktree>/<depDir>")` and pass `"$LINK"` to `cmd //c rmdir`. The link-still-present check after step (a) is what saves you when this goes wrong.
- **Worktree cleanup** (build/test mode only, and only when the verdict is NOT flawed): unless `keepWorktrees`, remove every submission worktree, plus any leftover `council-wt-<this run's slug>-*` or `council-scratch-<this run's slug>-*` worktree (this run's member and reviewer worktrees that a failed step may have left behind). Before ANY removal, save every candidate's work: for each `council-wt-<slug>-<label>` run `git -C "<args.repo>" update-ref refs/council/<slug>/<label> $(git -C <worktree> rev-parse HEAD)`. Then use this exact order **per worktree** — never skip step (a): (a) if `depDir` is set, unlink the dependency junction/symlink FIRST, with BACKSLASH paths only on Windows (forward slashes inside the path make cmd read `/x` as a switch and fail) — from the Bash tool `cmd //c rmdir "<worktree>\<depDir>"`, from PowerShell `cmd /c rmdir "<worktree>\<depDir>"` (`cmd //c` in PowerShell is a silent no-op: banner, exit 0, link still there); elsewhere `rm "<worktree>/<depDir>"` (no `-r`, no `-rf` — a recursive delete on a junction follows it into the main checkout and destroys the real contents; `rmdir`/plain `rm` on a junction/symlink removes only the link); (a2) check the link is GONE — Bash `[ -e "<worktree>/<depDir>" ] && echo STILL-THERE`, PowerShell `Test-Path "<worktree>\<depDir>"` must be `False`; if it is still present, STOP — do not run (b) for this or any other worktree, and tell the user; (b) `git worktree remove --force <worktree>`; then `git worktree prune` once all worktrees are gone. Never touch `council-wt-*` worktrees from a different slug — those belong to another run, possibly one that ended `flawed` and is keeping its worktrees on purpose. After all removals, if `depDir` is set, verify `<args.repo>/<depDir>` still exists and is non-empty; if it does not, STOP immediately — do not continue delivery — and tell the user exactly what appears to have been deleted. On a `flawed` verdict, leave every worktree in place — nothing is removed, ever — and list their paths instead; if the user later deletes one of those worktrees by hand, they must `rmdir` the `depDir` link first, before `git worktree remove`.

Report: winner label + model, who was killed and why, grafts applied, transcript path. Never commit; the user commits.
