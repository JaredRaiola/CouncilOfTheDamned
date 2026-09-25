---
name: cotd
description: "Consult whenever the user asks to plan, design, implement, fix, change, add, refactor, write tests, or review a PR/branch/diff, or says 'council', 'convene', 'council of the damned'; decides whether to convene a council of independent mixed-model agents (one winner or a flawed verdict) or to skip in one line. Not for questions. Also handles 'council config' (show or change the default roster, judge, floor and toggles) and 'council clear' (delete transcripts)."
user-invocable: true
argument-hint: "[design|build|test|review|config|clear] [--roster name|m1,m2] [--judge model] [--brief file] [--floor N] [--just-go] task"
---

# Council of the Damned

One task → N independent agents (mixed models, no cross-visibility) → blind review →
rebuttal → judge kills the weak → one winner applied uncommitted, or `flawed` and stop.
Always considered; convenes per §0. Roster size is the cost knob.

Invoked as `/cotd <args>` (`$ARGUMENTS` holds everything after the command) or by the
model when a plan/change request arrives. If the first word of `$ARGUMENTS` is `config`,
skip to §2b and do nothing else; if it is `clear`, skip to §2c and do nothing else.

## 0. Convene or skip

Always convene (review mode) for a code review: "review PR N", "review this branch/diff". A review is not skipped as "no code change".

`autoConvene: false` in the effective config (§2) turns off automatic convening: skip with `council skipped: autoConvene off` unless the user typed `/cotd`, or said "council" or "convene". Everything below still applies once one of those forces it.

Not a trigger: a question. Explanations, diagnosis, "is this a bug", "what does this do", and reading code are answered directly with no council decision. Consult this skill only when the deliverable is a plan or a change, which is usually the message after the answer.

Convene when ANY of:
- the change touches more than one file, or more than one user workflow
- it changes business logic, data shape, auth, money, or a server contract
- the request is ambiguous or has more than one reasonable approach
- the user says "council" or "convene" (this always forces it, regardless of the other criteria)

Per-request opt-out: if the request itself says "no council" or "skip council", skip with `council skipped: no council requested` even when the criteria above would convene (reviews included). Only a request typed as `/cotd` overrides that phrase.

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
| `--just-go` | "just go" | skip the brief's questions and approval (§3); `justGo: true` in the config makes this the default |

Model names are whatever the Agent tool's model list offers this session (`fable`, `opus`, `sonnet`, `haiku`). Effort is `low`, `medium`, `high` or `max`. A roster longer than 10 seats is truncated by the scripts.

## 2. Resolve config

Effective config = bundled defaults, then the user's file, then flags (§1):

1. `council.config.json` next to this SKILL.md: the bundled defaults. Never edit it in place; a plugin update replaces it.
2. `<config dir>/council.config.json`, where `<config dir>` is `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`. Optional; any key present overrides the same key from step 1 (`rosters` merges per preset name).
3. Flags and prose overrides from §1.

Then resolve seats: `roster` is a preset name looked up in `rosters` (or an explicit list from `--roster`); each seat string `model[:effort]` becomes `{ "model", "effort" }` for the scripts, and `judge` the same way. `~` in `transcriptDir` means `<config dir>`'s parent home directory.

If `fable` is not in the Agent tool's model list this session, replace every `fable` seat (roster and judge) with `opus` at the same effort before convening. A fable seat that fails mid-run (credits, availability) is retried on opus by the scripts themselves, and `verdict.models` records the model that actually answered.

## 2b. `/cotd config` — show or change the defaults

Operates only on the user's file from §2 step 2 (create it if missing, keys not mentioned stay as they were). Write the file from the Bash tool with a `cat > "<path>" <<'EOF'` heredoc or with the Write tool — never with PowerShell `>` (it writes UTF-16 with a BOM, which JSON.parse rejects). After every change print the file's full contents and its path. Forms:

| Command | Effect |
|---|---|
| `/cotd config` | print the effective config (steps 1+2 merged), marking which keys come from the user's file, and the file's path |
| `/cotd config roster <preset>` | default roster = that preset (must exist in `rosters`) |
| `/cotd config roster <preset> m1,m2,...` | define or replace preset `<preset>` with those seats, and make it the default |
| `/cotd config preset <name> m1,m2,...` | define or replace a preset without changing the default |
| `/cotd config judge model[:effort]` | default judge |
| `/cotd config floor N` | `minExamplesPerWorkflow` |
| `/cotd config <key> <value>` | any other key: `autoConvene`, `justGo`, `minWorkflows`, `rebuttalFix`, `keepWorktrees`, `keepTranscripts`, `transcriptDir` (`on`/`off`/`true`/`false` for booleans) |
| `/cotd config reset` | delete the user's file; bundled defaults apply again |

Validate before writing: seats are `model[:effort]` with a known effort, presets referenced by `roster` exist, numbers are positive integers. On a bad value, say what is wrong and write nothing.

## 2c. `/cotd clear` — delete transcripts

Resolve `transcriptDir` as in §2. `/cotd clear` targets `<transcriptDir>/<repoName>/` for the current repo (`repoName` as in §4); `/cotd clear all` targets the whole `<transcriptDir>`. List the files that would go (path and count), ask once for confirmation, then delete them and remove now-empty folders. `--yes` skips the confirmation. Never delete anything outside `<transcriptDir>`, and never follow symlinks out of it. If the target does not exist, say so and stop.

## 3. Summons (brief, always drafted)

The brief is ALWAYS drafted from the repo and passed to every candidate. "Just go" (the flag, the prose, or `justGo: true` in the effective config) skips only step 3's clarifying questions (go straight from the draft to §4); it never skips drafting or sending the brief itself.

**Review target (review mode only, before drafting).** Decide what is being reviewed. If it is the current working tree (uncommitted changes, "review this diff", no ref named), the checkout is the git root and no worktree is made. Otherwise resolve the ref read-only: a PR number → `git -C <git root> ls-remote origin refs/pull/<N>/head` (fetch it with `git -C <git root> fetch origin refs/pull/<N>/head` if the objects are not local; never checkout, switch or pull), a branch → `git -C <git root> rev-parse origin/<branch>` (after `fetch origin <branch>` if needed), a sha as given. Record `sha` and `base` = `git -C <git root> merge-base <sha> HEAD`. Draft the brief from `git -C <git root> diff <base>..<sha>` and `git -C <git root> show <sha>:<path>`, never from the working tree. Then create the review checkout with `bash "<skill root>/scripts/council-clean.sh" create "<git root>" <slug> none review <sha>` (a detached worktree `council-review-<slug>` beside the repo, no dependency link); a `STOP:` line means stop and tell the user. That worktree is `args.repo` for the run; the brief says the checkout has no dependency link, so members read code and do not run tests there, and lists any results (typecheck, tests) already run so nobody repeats them.

Draft the **council brief** by reading the repo (read-only):

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

Whenever the brief is shown (and once before launching under "just go"), print one cost line: `Council: <N> members (<seat list>), judge <model:effort>, about <3N+2> agent calls` — members, a review and a rebuttal per member, the judge, plus retries.

Unless "just go" applies: show the brief, ask at most 3 targeted questions only where the request is ambiguous, and let the user edit or approve it. Under "just go", skip the questions and approval step and use the drafted brief as-is. Either way, the resulting brief is passed verbatim to every candidate.

## 4. Convene

Compute `repoName` = basename of the git root, `date` = today YYYY-MM-DD, `slug` = 3-6 kebab words from the task. Transcript path = `<transcriptDir>/<repoName>/<date>-<slug>.md` (expand `~`, mkdir -p, suffix `-2`, `-3` if it exists). If the transcript needed a `-2`/`-3` suffix, append that same suffix to the `slug` value passed in `args` — worktrees are named `council-wt-<slug>-<label>`, so this keeps a same-day re-run from colliding with worktrees a previous `flawed` verdict left in place. Write the brief as the transcript's first section before launching:

```
# Council of the Damned — <slug>
Mode: <mode> · Roster: <N> members · <date>

## Brief
<brief verbatim>
```

Git root = `git rev-parse --show-toplevel`, converted to `C:\...` form on Windows (in Bash: `cygpath -w "$(git rev-parse --show-toplevel)"`) before it is passed as `args.repo` — never a `/c/...` path; the scripts only build paths from it. In review mode with a review target (§3), `args.repo` is the `council-review-<slug>` worktree in the same form, and the git root below still means the main repository. Compute `base` = `git -C <git root> rev-parse HEAD` (every worktree is created from it and delivery diffs against it; members never report it; in review mode `base` is the merge-base from §3), and `briefWorkflowCount` = the number of numbered items in the brief's "Affected workflows" section.

Pre-flight (build/test/review): `git -C <git root> worktree list` must show no `council-wt-<slug>-*` or `council-review-<slug>` worktree other than the one §3 just created. If one exists, STOP and tell the user — never launch over it. Record `git -C <git root> branch --show-current` and `git -C <git root> status --porcelain` now; §5 checks them before delivery.

**Create every worktree (build/test) before the Workflow call.** Members never run `git worktree add`, `mklink` or `ln -s`; the prompts tell them their worktree already exists. From the Bash tool, with `<depDir>` taken from the brief (`none` when the brief says none) and `L` = `A`, `B`, ... for each roster seat in order:

```
bash "<skill root>/scripts/council-clean.sh" create "<git root>" <slug> <depDir|none> <L> <base>
```

Test mode also needs one scratch worktree per seat for the reviewers' mutation checks: the same command with label `<L>-scratch`. Each call prints `created <path>`; on any `STOP:` line, run `bash "<skill root>/scripts/council-clean.sh" clean "<git root>" <slug> <depDir|none>` to undo the ones already made, then stop and tell the user. Design mode has no worktrees.

**Harness relay.** The Workflow harness relays the launch turn's latest user message verbatim to every member as the "user request". If that message is not the council request itself (for example "continue", "yes", or an unrelated instruction sent while the brief was being approved), say so to the user in one line before launching, so they can restate the request or accept that members will see the brief as the task and that message as mere authorization (the scripts tell members to treat it that way).

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

- **Step 0 — Result block (every mode, every verdict, judge-died included).** The scripts write nothing after the judge; append this to the transcript yourself with ONE `cat >> "<transcript>" <<'EOF'` heredoc from the Bash tool (never PowerShell `>`):
  ```
  ## Result
  Winner: <label>            (or: FLAWED — <reasons joined by '; '>)
  Eliminated: <label: reason; ...>   (omit the line when empty)
  DEGRADED: <each entry; ...>        (omit the line when absent)
  Models: A=<model>, B=<model>, ...  (from verdict.models; review mode too)
  ```
  In review mode the first line is `Findings: <count> (<blockers> blocker, <majors> major, <minors> minor)`.
- **Main-repo check (build/test/review, every verdict, before anything else)** → `git -C <git root> branch --show-current` and `git -C <git root> status --porcelain` must equal what §4 recorded. If the branch differs, restore it with `git -C <git root> checkout <recorded branch>` and report the deviation (and any porcelain difference) to the user before delivering. Also run `git -C <git root> branch -r --list 'origin/*council*'` and report any unexpected remote branch — an agent may have pushed or opened a PR it had no business opening.
- **degraded** (a member, reviewer or rebuttal agent died, a member went unreviewed, or the judge died) → print `DEGRADED: <each entry>` as the FIRST line of your report, before anything else, and ask the user before applying anything — an unreviewed diff never auto-lands.

- **flawed** → say so and list reasons. In build/test mode, also list this run's worktrees from `git -C "<git root>" worktree list | grep -E "council-(wt|review)-<slug>"` (NOT from `submissions[]` — a member that died still left its worktree and link) for inspection. Touch nothing. Tell the user: when they are done inspecting, run `bash "<skill root>/scripts/council-clean.sh" clean "<git root>" <slug> <depDir|none>` — it saves every worktree's HEAD under `refs/council/<slug>/<label>`, unlinks the dependency dir first, removes the worktrees and verifies the main checkout's dependency dir; never `git worktree remove` or delete one by hand.
- **build / test winner** → from the Bash tool run `bash "<skill root>/scripts/council-clean.sh" apply "<git root>" <slug> <depDir|none> <verdict.winner> <base>`. It stages everything in the winner's worktree (`add -A`, so untracked work counts), writes `diff --cached --binary <base>` to a patch file, runs `git apply --check` and then `git apply` in the main repo; on a `STOP:` line report it verbatim and STOP — apply nothing else, remove no worktree. Then apply each graft by hand from the named worktree (`git -C <that worktree> diff <base> -- <path>`, or `git -C <that worktree> show HEAD:<path>`) while the worktrees still exist. Run the winner's `testCommand` once in the main tree and paste the tail. Leave uncommitted.
- **review** → returns `{ reviews, checks, verdict: { findings:[{title, file, line, severity, scenario, confirmedBy}], dropped:[{title, why}], testPlan:[{area, steps, expect}], models, degraded? } }`. No winner: members review the same checkout independently, each cross-checks its peers' findings against the code (confirm/refute with file:line), and the judge keeps confirmed findings, re-checks disputed ones itself, and merges the test plans. Report findings most-severe first, then the test plan.
- **design winner** → the winning approach is already in the transcript; print its summary and offer "build the winner" (re-run this skill in build mode with the winning approach appended to the brief). Design mode has no worktrees, so no cleanup step applies.
- **Worktree cleanup** (build/test, and review with a review target; only when the verdict is NOT flawed; unless `keepWorktrees`): ONE call from the Bash tool —
  ```
  bash "<skill root>/scripts/council-clean.sh" clean "<git root>" <slug> <depDir|none>
  ```
  It touches only this run's worktrees (`council-wt-<slug>-<label>`, `council-wt-<slug>-<label>-scratch`, `council-review-<slug>`; a different slug, including `<slug>-2`, is never matched), saves each HEAD as `refs/council/<slug>/<label>` first, unlinks the dependency link before every removal and refuses to remove a worktree whose link survived, prunes, then verifies `<git root>/<depDir>` still exists and is non-empty. On any `STOP:` line, report it verbatim and stop delivery: something needs a human. Never `git worktree remove`, `rmdir`, `rm -r` or `mklink` by hand.

Report: winner label + model, who was killed and why, grafts applied, transcript path. Never commit; the user commits.

If the effective `keepTranscripts` is `false`, delete this run's transcript file after the report is printed (and its `<repoName>` folder if now empty), and say so in one line. Keep it regardless when the verdict is `flawed` or the report is DEGRADED: those transcripts are the only record of what went wrong.
