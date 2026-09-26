---
name: cotd
description: "Consult whenever the user asks to plan, design, implement, fix, change, add, refactor, write tests, review a PR/branch/diff, audit or hunt for bugs across a scope, or decide between fixed options, or says 'council', 'convene', 'council of the damned'; decides whether to convene a council of independent mixed-model agents (one winner or a flawed verdict) or to skip in one line. Not for questions. Also handles 'council config', 'council clear', 'council doctor', 'council stats', 'council runs', 'council apply' and 'council brief save'."
user-invocable: true
argument-hint: "[design|build|test|review|audit|decide|pipeline|config|clear|doctor|stats|runs|apply|brief|retry] [--roster name|m1,m2] [--judge model] [--brief file] [--floor N] [--just-go] [--wip] [--budget Nk] [--stop-after fanout] [--review-model model] [--review-effort effort] [--options \"A: ...; B: ...\"] task"
---

# Council of the Damned

One task → N independent agents (mixed models, no cross-visibility) → blind review →
rebuttal → judge kills the weak → one winner applied uncommitted, or `flawed` and stop.
Always considered; convenes per §0. Roster size is the cost knob.

Invoked as `/cotd <args>` (`$ARGUMENTS` holds everything after the command) or by the
model when a plan/change request arrives. If the first word of `$ARGUMENTS` is `config`,
skip to §2b and do nothing else; if it is `clear`, skip to §2c; if it is `doctor`, `stats`,
`runs`, `apply` or `brief`, skip to §2d and do nothing else. If it is `pipeline`, follow §6; if it is `retry`, follow §7.

`<skill root>` is the directory holding this SKILL.md; `<config dir>` is `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`.

## 0. Convene or skip

Always convene (review mode) for a code review: "review PR N", "review this branch/diff". A review is not skipped as "no code change". An audit ("audit", "find every", "hunt") and a decision between fixed options ("decide", "choose between", "which option") also always convene when asked for.

`autoConvene: false` in the effective config (§2) turns off automatic convening: skip with `council skipped: autoConvene off` unless the user typed `/cotd`, or said "council" or "convene". Everything below still applies once one of those forces it.

Not a trigger: a question. Explanations, diagnosis, "is this a bug", "what does this do", and reading code are answered directly with no council decision. Consult this skill only when the deliverable is a plan, a change, a review, an audit or a decision, which is usually the message after the answer.

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
| audit, find every, hunt | audit (review with no PR: the brief's Task is the scope) | `workflows/council-review.js` |
| decide, choose between, which option | decide | `workflows/council-decide.js` |

Explicit mode as the first word of `$ARGUMENTS` or "council <mode>" in prose wins. Build wins over design when both appear ("plan and implement"). Decide wins over design when the request names fixed options.

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
| `--retries N` | "retry up to N times" | `maxRetries` = N for this run (§7) |
| `--wip` | "on my working copy", "wip" | build/test: run on uncommitted work; §4 snapshots the dirty tree as `base`, §5 applies the winner onto the dirty tree |
| `--budget <N>k` | "budget 600k" | `maxTokens` = N×1000: a phase cap in output tokens (§4) |
| `--stop-after fanout` | "stop after fanout" | build/test/design: return right after the members, `flawed`, nothing lands; inspect with `/cotd runs` and `/cotd apply` |
| `--review-model <model>` | "review with sonnet" | `reviewModel` = that model for review, rebuttal and cross-check calls |
| `--review-effort <effort>` | "review at medium" | `reviewEffort` = that effort for review, rebuttal and cross-check calls |
| `--options "A: ...; B: ..."` | "choose between A: ... and B: ..." | decide: the fixed options (or a `## Options` section in the brief) |

Model names are whatever the Agent tool's model list offers this session (`fable`, `opus`, `sonnet`, `haiku`). Effort is `low`, `medium`, `high` or `max`. A roster longer than 10 seats is truncated by the scripts.

## 2. Resolve config

Effective config = bundled defaults, then the project file, then the user's file, then `rosterByMode`, then flags (§1):

1. `council.config.json` next to this SKILL.md: the bundled defaults. Never edit it in place; a plugin update replaces it.
2. `<git root>/.cotd/council.config.json`: the project layer, committed and shared. Only these keys are read from it: `roster`, `rosters`, `judge`, `rosterByMode`, `minExamplesPerWorkflow`, `minWorkflows`, `rebuttalFix`, `reviewModel`, `reviewEffort`. Never `transcriptDir`, `autoConvene`, `keepTranscripts`, `maxTokens` or any other key: a disallowed key is reported in one line (`project config: <key> ignored (not allowed in a project file)`) and ignored. A file that is not valid JSON, or a value that fails the §2b validation, is reported and the whole file is ignored.
3. `<config dir>/council.config.json`: the user's file. Optional; any key present overrides the same key from steps 1-2 (`rosters` and `rosterByMode` merge per name).
4. `rosterByMode[<mode>]`, if set, replaces `roster` for this run (a preset name; it must exist in the merged `rosters`, like `roster`).
5. Flags and prose overrides from §1; `--roster` always wins over `rosterByMode`.

Then resolve seats: `roster` is a preset name looked up in `rosters` (or an explicit list from `--roster`); each seat string `model[:effort]` becomes `{ "model", "effort" }` for the scripts, and `judge` the same way. `~` in `transcriptDir` means `<config dir>`'s parent home directory. `maxTokens` 0 means no budget; `reviewModel` / `reviewEffort` empty means each review, rebuttal and cross-check call runs on the member's own model / effort.

If `fable` is not in the Agent tool's model list this session, replace every `fable` seat (roster, judge and `reviewModel`) with `opus` at the same effort before convening. A fable seat that fails mid-run (credits, availability) is retried on opus by the scripts themselves, and `verdict.models` records the model that actually answered.

## 2b. `/cotd config` — show or change the defaults

Changes operate only on the user's file from §2 step 3 (create it if missing, keys not mentioned stay as they were); the project file is edited by hand and committed. Write the file from the Bash tool with a `cat > "<path>" <<'EOF'` heredoc or with the Write tool — never with PowerShell `>` (it writes UTF-16 with a BOM, which JSON.parse rejects). After every change print the file's full contents and its path. Forms:

| Command | Effect |
|---|---|
| `/cotd config` | print the effective config (steps 1-3 merged, plus any flags on the same command line), marking each key `bundled`, `project`, `user` or `flag`; list the project keys that were ignored; print both file paths, and the standing brief file that applies to this repo (§3) or `Standing brief: none` |
| `/cotd config roster <preset>` | default roster = that preset (must exist in `rosters`) |
| `/cotd config roster <preset> m1,m2,...` | define or replace preset `<preset>` with those seats, and make it the default |
| `/cotd config preset <name> m1,m2,...` | define or replace a preset without changing the default |
| `/cotd config judge model[:effort]` | default judge |
| `/cotd config floor N` | `minExamplesPerWorkflow` |
| `/cotd config rosterByMode <mode> <preset>` | use that preset for that mode (`design`, `build`, `test`, `review`, `audit`, `decide`); `none` removes the mapping |
| `/cotd config maxTokens <N|Nk|0>` | default budget in output tokens; `0` = off |
| `/cotd config reviewModel <model|none>` | default model for review, rebuttal and cross-check calls; `none` = each member's own seat |
| `/cotd config reviewEffort <effort|none>` | default effort for review, rebuttal and cross-check calls; `none` = each member's own effort |
| `/cotd config <key> <value>` | any other key: `autoConvene`, `justGo`, `minWorkflows`, `rebuttalFix`, `keepWorktrees`, `keepTranscripts`, `transcriptDir` (`on`/`off`/`true`/`false` for booleans) |
| `/cotd config reset` | delete the user's file; bundled (and project) defaults apply again |

Keys: `roster`, `rosters`, `judge`, `autoConvene`, `justGo`, `minExamplesPerWorkflow`, `minWorkflows`, `rebuttalFix`, `keepWorktrees`, `keepTranscripts`, `transcriptDir`, `maxTokens`, `rosterByMode`, `reviewModel`, `reviewEffort`. No others.

Validate before writing: seats are `model[:effort]` with a known effort, presets referenced by `roster` or `rosterByMode` exist, `rosterByMode` keys are known modes, `reviewModel` is a model name (no effort), `reviewEffort` is a known effort, numbers are non-negative integers (`maxTokens` may be 0; the others are positive). On a bad value, say what is wrong and write nothing.

## 2c. `/cotd clear` — delete transcripts

Resolve `transcriptDir` as in §2. `/cotd clear` targets the run transcripts in `<transcriptDir>/<repoName>/` for the current repo (`repoName` as in §4) and leaves `lessons.md` and `decisions/` there, and the ledger. `/cotd clear all` targets the whole `<transcriptDir>` (lessons and decisions included) and also `<config dir>/council-ledger.jsonl`. List the files that would go (path and count), ask once for confirmation, then delete them and remove now-empty folders. `--yes` skips the confirmation. Never delete anything outside `<transcriptDir>` except that one ledger file, and never follow symlinks out of it. If the target does not exist, say so and stop.

## 2d. Other subcommands

All run from the Bash tool; `<git root>` as in §4. Report `STOP:` lines verbatim.

| Command | What to do |
|---|---|
| `/cotd doctor` | Read-only; change nothing, create nothing. Run `bash "<skill root>/scripts/council-clean.sh" doctor "<git root>"` (git >= 2.5, CR count 0 in every `workflows/*.js`, stale `council-wt-*` / `council-scratch-*` / `council-review-*` worktrees, orphan council directories, dangling dependency links). Then check yourself: the Workflow and Agent tools are available this session; `fable` is in the Agent tool's model list; the bundled, project and user config files each parse as JSON and every preset named by `roster` or `rosterByMode` resolves in the merged `rosters`; `transcriptDir` (or its nearest existing parent) is writable (`test -w`). Print one `ok:` or `problem:` line per check and nothing else. |
| `/cotd stats` | `bash "<skill root>/scripts/council-clean.sh" stats` and print its table: seated, won, ranked, eliminated, doa, died, unranked per `model:effort` and per mode over the last 500 ledger lines. |
| `/cotd runs [slug]` | `bash "<skill root>/scripts/council-clean.sh" runs "<git root>" [slug]`: every saved `refs/council/<slug>/<label>` with `git diff --stat` against its base (the run's `refs/council-wip/<slug>` snapshot when the ref was built on it, else the merge-base with HEAD). |
| `/cotd apply <slug> <label>` | `bash "<skill root>/scripts/council-clean.sh" apply "<git root>" <slug> none <label> auto ref`: delivers that saved ref as an uncommitted patch. It refuses only when the patch touches a path that is dirty in the main repo (for a `--wip` run: changed since the snapshot), stops on a failed `git apply --check`, and prints `note: <label> is not the council's winner for <slug>` when the latest ledger line for that slug names another winner. Nothing is committed. |
| `/cotd brief save [--shared]` | Take this session's most recent council brief (the `## Brief` of its transcript), drop its `## Task` and `## Lessons from past runs` sections, and write the rest to `<config dir>/council-briefs/<repoName>.md` (private), or with `--shared` to `<git root>/.cotd/brief.md` (to be committed). `mkdir -p` the folder; if the file exists, show the difference and ask before overwriting. Write with a `cat > "<path>" <<'EOF'` heredoc; print the path. |

## 3. Summons (brief, always drafted)

The brief is ALWAYS drafted from the repo and passed to every candidate. "Just go" (the flag, the prose, or `justGo: true` in the effective config) skips only step 3's clarifying questions (go straight from the draft to §4); it never skips drafting or sending the brief itself.

**Review target (review mode only, before drafting).** Decide what is being reviewed. If it is the current working tree (uncommitted changes, "review this diff", no ref named), the checkout is the git root and no worktree is made. Otherwise resolve the ref read-only: a PR number → `git -C <git root> ls-remote origin refs/pull/<N>/head` (fetch it with `git -C <git root> fetch origin refs/pull/<N>/head` if the objects are not local; never checkout, switch or pull), a branch → `git -C <git root> rev-parse origin/<branch>` (after `fetch origin <branch>` if needed), a sha as given. Record `sha` and `base` = `git -C <git root> merge-base <sha> HEAD`. Draft the brief from `git -C <git root> diff <base>..<sha>` and `git -C <git root> show <sha>:<path>`, never from the working tree. Then create the review checkout with `bash "<skill root>/scripts/council-clean.sh" create "<git root>" <slug> none review <sha>` (a detached worktree `council-review-<slug>` beside the repo, no dependency link); a `STOP:` line means stop and tell the user. That worktree is `args.repo` for the run; the brief says the checkout has no dependency link, so members read code and do not run tests there, and lists any results (typecheck, tests) already run so nobody repeats them.

**Audit (no review target).** The brief's `## Task` names the scope to hunt through (paths, a subsystem, a class of bug); the checkout is the git root, read-only, no worktree; `pr` is false (§4).

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

Decide mode adds `## Options` (one `<id>: <text>` per line, from `--options` split on `;`, or the user's own section; numbered `1`, `2`, ... when the user gave no ids) and, when the user named them, `## Criteria`. Members derive and state criteria when there are none.

**Section precedence.** Each section comes from the first of: `--brief <file>` > the standing brief > drafted from the repo.

- **User-supplied brief (`--brief <file>`).** Read the file; it uses the same headings. Sections it contains are taken verbatim and never rewritten. A user-supplied brief implies "just go" unless a section had to be drafted, in which case show only the drafted sections and ask about those. The file itself is never modified.
- **Standing brief.** `<git root>/.cotd/brief.md` (committed, shared) or `<config dir>/council-briefs/<repoName>.md` (private); the first that exists wins, the other is not read. Its sections are taken verbatim into every brief of this repo, below `--brief` in precedence. It does NOT imply "just go": drafted sections are still shown for approval. A `## Task` section in it is ignored with one line: `standing brief: ## Task ignored (<path>)`. The file is never modified except by `/cotd brief save`.
- **Lessons.** If `<transcriptDir>/<repoName>/lessons.md` exists, append its content verbatim as a separate final `## Lessons from past runs` section. Never merge it into, or rewrite, a user-supplied or standing section; if one of those already has a `## Lessons from past runs` heading, keep theirs and do not inject.

Whenever the brief is shown (and once before launching under "just go"), print one cost line: `Council: <N> members (<seat list>), judge <model:effort>, up to <3N+2> agent calls` — members, a review per member, a rebuttal per member that drew a bug (blocker/major or a bad proof rating; minors only when it drew nothing worse and `rebuttalFix` is on), the judge, plus retries — followed by `, budget <cap>k` when `maxTokens` is set.

Unless "just go" applies: show the brief, ask at most 3 targeted questions only where the request is ambiguous, and let the user edit or approve it. Under "just go", skip the questions and approval step and use the drafted brief as-is. Either way, the resulting brief is passed verbatim to every candidate.

## 4. Convene

Compute `repoName` = basename of the git root, `date` = today YYYY-MM-DD, `slug` = 3-6 kebab words from the task. Transcript path = `<transcriptDir>/<repoName>/<date>-<slug>.md` (expand `~`, mkdir -p, suffix `-2`, `-3` if it exists). If the transcript needed a `-2`/`-3` suffix, append that same suffix to the `slug` value passed in `args` — worktrees are named `council-wt-<slug>-<label>`, so this keeps a same-day re-run from colliding with worktrees a previous `flawed` verdict left in place. Write the brief as the transcript's first section before launching:

```
# Council of the Damned — <slug>
Mode: <mode> · Roster: <N> members · <date>
Standing brief: <path|none>

## Brief
<brief verbatim>
```

Git root = `git rev-parse --show-toplevel`, converted to `C:\...` form on Windows (in Bash: `cygpath -w "$(git rev-parse --show-toplevel)"`) before it is passed as `args.repo` — never a `/c/...` path; the scripts only build paths from it. In review mode with a review target (§3), `args.repo` is the `council-review-<slug>` worktree in the same form, and the git root below still means the main repository. Compute `base` = `git -C <git root> rev-parse HEAD` (every worktree is created from it and delivery diffs against it; members never report it; in review mode `base` is the merge-base from §3; under `--wip` it is the snapshot below), and `briefWorkflowCount` = the number of numbered items in the brief's "Affected workflows" section.

Pre-flight (build/test/review/audit): `git -C <git root> worktree list` must show no `council-wt-<slug>-*` or `council-review-<slug>` worktree other than the one §3 just created. If one exists, STOP and tell the user — never launch over it. Record `git -C <git root> branch --show-current` and `git -C <git root> status --porcelain` now; §5 checks them before delivery.

**`--wip` (build/test).** After recording, snapshot the dirty tree without touching HEAD, the branch or the real index: `bash "<skill root>/scripts/council-clean.sh" wip-snapshot "<git root>" <slug>`. It copies the index to a temporary file, runs `git add -A` and `git write-tree` against that copy, `git commit-tree <tree> -p HEAD -m council-wip`, and `git update-ref refs/council-wip/<slug> <sha>` (the ref keeps it through `git gc`). The last line it prints is the sha: that is `base`. The council-only view of a member's work is `git diff --stat <snapshot> refs/council/<slug>/<label>` — never `git diff refs/council-wip/<slug>` against the working tree, which shows WIP-untracked files as deletions.

**Create every worktree (build/test) before the Workflow call.** Members never run `git worktree add`, `mklink` or `ln -s`; the prompts tell them their worktree already exists. ONE Bash call creates them all, with `<depDir>` taken from the brief (`none` when the brief says none) and a comma-separated label list: `A,B,C,...` for the roster seats in order, plus in test mode one `<L>-scratch` label per seat for the reviewers' mutation checks (`A,B,C,A-scratch,B-scratch,C-scratch`). A `STOP:` mid-list leaves the worktrees already made, so the same call undoes them:

```
bash "<skill root>/scripts/council-clean.sh" create "<git root>" <slug> <depDir|none> A,B,C,D,E <base> || { bash "<skill root>/scripts/council-clean.sh" clean "<git root>" <slug> <depDir|none>; exit 1; }
```

It prints one `created <path>` line per label. If it printed a `STOP:` line, stop and tell the user. Design, decide and audit modes have no worktrees.

**Harness relay.** The Workflow harness relays the launch turn's latest user message verbatim to every member as the "user request". If that message is not the council request itself (for example "continue", "yes", or an unrelated instruction sent while the brief was being approved), say so to the user in one line before launching, so they can restate the request or accept that members will see the brief as the task and that message as mere authorization (the scripts tell members to treat it that way).

Then call the Workflow tool (audit uses `council-review.js`):

```
Workflow({ scriptPath: "<skill root>/workflows/council-<mode>.js",
  args: { brief, mode, repo: "<git root>", repoName, base, briefWorkflowCount, depDir, evidenceNotes, roster, judge,
          minExamplesPerWorkflow, minWorkflows, rebuttalFix, keepWorktrees, transcript, date, slug,
          maxTokens, stopAfter, reviewModel, reviewEffort, pr, options } })
```

`roster` is the resolved array of `{ model, effort }` objects and `judge` one such object (§2), never preset names or `model:effort` strings. `depDir` and `evidenceNotes` are taken verbatim from the brief's "Dependency dir to link into worktrees" and "Evidence that counts" sections (`depDir` is `none` → pass empty/falsy). `briefWorkflowCount` goes to the judge, which treats unjustified exclusions of brief-listed workflows as a major flaw; dead on arrival is total proven examples < `minExamplesPerWorkflow` only. `maxTokens` is the effective budget (0 = off), `stopAfter` is `"fanout"` or absent, `reviewModel` a model name or absent, `reviewEffort` an effort or absent. `pr` (review scripts only) is `true` for any review target (PR, branch, sha or working-tree diff) and `false` for an audit; the member prompt then says "Review the change" or "Review the scope". `options` (decide only) is the array of `<id>: <text>` strings from the brief's `## Options`.

**Budget.** `maxTokens` is a phase cap in output tokens spent by this run (the Workflow tool's `budget.spent()`, measured from the script's start). Each script checks it after the fan-out and again as each member's rebuttal (review mode: each cross-check) is about to launch; once reached it logs `budget: <spent>k >= <cap>k after <stage>; skipping to Verdict` once, adds `budget exhausted after <stage>` to `degraded`, and launches nothing further, so members whose reviewers returned before the cap may have a rebuttal and later ones none. The judge always runs, so a run can overshoot the cap by the calls in flight plus the judge.

Tell the user the transcript path so they can watch it fill. Wait for the task notification; do not poll.

## 5. Deliver

The workflow returns `{ submissions, verdict, transcript, ledger }` (review, audit and decide: `{ verdict, transcript, ledger }`). `submissions` is one stub per member that returned, `{ label, worktree, model, summary, testCommand }` (design: `{ label, model, summary }`, and the winner's stub also carries `approach`, `filesTouched` and `plan`); the full submissions, reviews and rebuttals live only in the transcript, never read them back into this session. `verdict` is:
```
{ flawed, reasons, eliminated:[{label, reason}], ranking:[label], winner, grafts:[{from, what, how}], lessons?:[string], models:{A:"fable",...}, degraded?:[string] }
```
Read lessons as `verdict.lessons || []`. `ledger` is one JSON line (a string) for the run ledger.

- **Step 0 — Save refs (build/test, and review with a review target; every verdict, before anything else).** `bash "<skill root>/scripts/council-clean.sh" save-refs "<git root>" <slug> <depDir|none> <base>`. For every worktree of this slug it snapshots the worktree with `git add -A`, `write-tree` and `commit-tree -p <base>` and stores it as `refs/council/<slug>/<label>`, so uncommitted member work and flawed runs are captured. It removes nothing. `/cotd runs` and `/cotd apply` read these refs.
- **Step 1 — Ledger (every mode, every verdict, whatever `keepTranscripts` says).** Write `ledger` verbatim to a scratch file (one line, trailing newline; never re-serialized) and run `bash "<skill root>/scripts/council-clean.sh" ledger-append "<config dir>/council-ledger.jsonl" <scratch file>`; a `STOP:` line means the ledger was not written, say so and continue. It records date, repoName, slug, mode, runId, agent-call count, output tokens and each seat's fate (`won`, `ranked:<n>`, `doa`, `eliminated`, `died`, or `unranked` when no member ranking exists: review, audit, decide, `--stop-after`, judge died) keyed by `model:effort`. Ledger data is never put into any brief or prompt.
- **Step 2 — Result block (every mode, every verdict, judge-died included).** The scripts write nothing after the judge; append this to the transcript yourself with ONE `cat >> "<transcript>" <<'EOF'` heredoc from the Bash tool (never PowerShell `>`):
  ```
  ## Result
  Winner: <label>            (or: FLAWED — <reasons joined by '; '>)
  Eliminated: <label: reason; ...>   (omit the line when empty)
  DEGRADED: <each entry; ...>        (omit the line when absent)
  Models: A=<model>, B=<model>, ...  (from verdict.models; review mode too)
  ```
  In review and audit mode the first line is `Findings: <count> (<blockers> blocker, <majors> major, <minors> minor)`; in decide mode it is `Recommendation: <id> (confidence <confidence>)`.
- **Step 3 — Lessons.** If `verdict.lessons || []` is non-empty, append to `<transcriptDir>/<repoName>/lessons.md` (create it; it is hand-editable) with one heredoc: a `## <date> <slug>` line, then one `- <lesson>` line each. §3 injects that file into later briefs.
- **Main-repo check (build/test/review/audit, every verdict, before delivering)** → `git -C <git root> branch --show-current` and `git -C <git root> status --porcelain` must equal what §4 recorded (under `--wip` the tree is still dirty exactly as recorded). If the branch differs, restore it with `git -C <git root> checkout <recorded branch>` and report the deviation (and any porcelain difference) to the user before delivering. Also run `git -C <git root> branch -r --list 'origin/*council*'` and report any unexpected remote branch — an agent may have pushed or opened a PR it had no business opening.
- **degraded** (a member, reviewer or rebuttal agent died, a member went unreviewed, the budget ran out, or the judge died) → print `DEGRADED: <each entry>` as the FIRST line of your report, before anything else, and ask the user before applying anything — an unreviewed diff never auto-lands.

- **flawed** (including `--stop-after fanout`) → say so and list reasons. In build/test mode, also list this run's worktrees from `git -C "<git root>" worktree list | grep -E "council-(wt|review)-<slug>"` (NOT from `submissions[]` — a member that died still left its worktree and link) for inspection. Touch nothing: the Step 0 ref writes are the only writes a flawed run makes. Tell the user they can list the saved work with `/cotd runs <slug>`, deliver one member's work with `/cotd apply <slug> <label>`, and, when they are done inspecting, run `bash "<skill root>/scripts/council-clean.sh" clean "<git root>" <slug> <depDir|none>` — it snapshots every worktree under `refs/council/<slug>/<label>` (keeping the Step 0 snapshot when nothing changed since), unlinks the dependency dir first, removes the worktrees and verifies the main checkout's dependency dir; never `git worktree remove` or delete one by hand.
- **build / test winner** → from the Bash tool run `bash "<skill root>/scripts/council-clean.sh" apply "<git root>" <slug> <depDir|none> <verdict.winner> <base>`. It stages everything in the winner's worktree (`add -A`, so untracked work counts), writes `diff --cached --binary <base>` to a patch file, runs `git apply --check` and then `git apply` in the main repo; on a `STOP:` line report it verbatim and STOP — apply nothing else, remove no worktree. Under `--wip`, `<base>` is the snapshot, so the patch holds only the council's work and lands on top of the dirty tree. Then apply each graft by hand from the named worktree (`git -C <that worktree> diff <base> -- <path>`, or `git -C <that worktree> show HEAD:<path>`) while the worktrees still exist. Run the winner's `testCommand` once in the main tree and paste the tail. Leave uncommitted.
- **review / audit** → returns `{ verdict: { findings:[{title, file, line, severity, scenario, confirmedBy}], dropped:[{title, why}], testPlan:[{area, steps, expect}], lessons?, models, degraded? } }`. No winner: members review the same checkout independently, each cross-checks its peers' findings against the code (confirm/refute with file:line), and the judge keeps confirmed findings, re-checks disputed ones itself, and merges the test plans. Report findings most-severe first, then the test plan.
- **design winner** → design members write implementation plans (tasks → files with line ranges → one-action steps with the code and commands), and the winner's plan comes back in its `submissions` stub as `plan` with `approach` and `filesTouched`. Print the summary and the task list (name and files per task), then offer "build the winner": re-run this skill in build mode with the plan appended to the brief as a `## Plan (from design stage)` section holding the `approach` line and every task verbatim (name, files, steps with their code, run and expect, proves). Build and test members then execute that plan task by task instead of re-deriving the design, and reviewers check submissions against it. Design mode has no worktrees, so no cleanup step applies.
- **decide** → `verdict` is `{ flawed, reasons, ranking:[option id], recommendation, confidence, rationale, dissent:[string], lessons?, models, degraded? }`. Nothing in the repo changes. Print the decision record: the question (the brief's Task), the options, the final ranking, the recommendation with its confidence, the rationale, and the dissent worth recording. Offer to save it to `<transcriptDir>/<repoName>/decisions/<date>-<slug>.md` (mkdir -p, one heredoc) and write it only on a yes. No worktrees, no cleanup.
- **Worktree cleanup** (build/test, and review with a review target; only when the verdict is NOT flawed; unless `keepWorktrees`): ONE call from the Bash tool —
  ```
  bash "<skill root>/scripts/council-clean.sh" clean "<git root>" <slug> <depDir|none>
  ```
  It touches only this run's worktrees (`council-wt-<slug>-<label>`, `council-wt-<slug>-<label>-scratch`, `council-review-<slug>`; a different slug, including `<slug>-2`, is never matched), saves each worktree as `refs/council/<slug>/<label>` first, unlinks the dependency link before every removal and refuses to remove a worktree whose link survived, prunes, then verifies `<git root>/<depDir>` still exists and is non-empty. On any `STOP:` line, report it verbatim and stop delivery: something needs a human. Never `git worktree remove`, `rmdir`, `rm -r` or `mklink` by hand.

Report: winner label + model, who was killed and why, grafts applied, transcript path. Never commit; the user commits.

If the effective `keepTranscripts` is `false`, delete this run's transcript file after the report is printed (and its `<repoName>` folder if now empty), and say so in one line. Never delete `lessons.md`, `decisions/` or the ledger that way. Keep the transcript regardless when the verdict is `flawed` or the report is DEGRADED: those transcripts are the only record of what went wrong.

## 6. Pipelines: `/cotd pipeline <stage> [<stage> ...] <task>`

A pipeline runs several modes in sequence on one task, each with its own roster. Each stage is `<mode>:<roster>` where `<mode>` is `design`, `build` or `test` and `<roster>` is a preset name from `rosters`, an explicit seat list `m1,m2,...`, or `solo`. Prose form: "design with the council, build solo, then test with a small council". Stages run in the order given; the same mode may not appear twice.

- **`solo`** means no council for that stage: do the stage yourself as ordinary work (design: write the approach; build: implement it in the main tree, uncommitted; test: write and run the tests), with no Workflow call, no judge and no transcript section beyond one line in the pipeline summary. The §0 convene/skip decision does not apply inside a pipeline; the stage list is the decision.
- **Council stages** run exactly as a single `/cotd <mode> --roster <roster>` run would (§3 to §5), except that the brief's approval step happens once, before the first stage, for the whole pipeline; later stages reuse the approved brief with the previous stage's output appended and are launched without further questions.
- **Chaining.** A design stage's winning plan (or the solo write-up, in the same task shape) is appended to the next brief as `## Plan (from design stage)`, exactly as the design-winner bullet in §5 describes. A build stage's winner is applied uncommitted (§5) and stays uncommitted; the following test stage runs with `--wip` so its base is the snapshot of that uncommitted tree, and its winner's specs are applied on top. Nothing is committed at any point; the user commits after the pipeline.
- **Stopping.** A `flawed` verdict, a DEGRADED report, a failed `apply --check`, or a STOP line from `council-clean.sh` ends the pipeline at that stage. Report what landed from earlier stages (still uncommitted), what stopped it, and the transcript paths; run nothing after it. `--stop-after fanout` is not allowed inside a pipeline.
- **Cost preview** (§3) is shown once for the whole pipeline: the roster and approximate agent count per council stage, and "solo" for the rest.
- **Transcripts.** One per council stage, named `<date>-<slug>-<mode>.md`; the first one also holds the brief. After the last stage, append a `## Pipeline` block to the final transcript: each stage, its roster, winner or `solo`, and what was applied.

Examples: `/cotd pipeline design:default build:solo test:small add rate limiting to the upload endpoint`; `/cotd pipeline build:solo test:cheap fix the date parser`.

## 7. Retries after a flawed verdict

Config `maxRetries` (default `0`), flag `--retries N`, prose "retry up to N times". Applies to design, build, test and decide runs and to each council stage of a pipeline. Applies to `flawed` verdicts only: a DEGRADED report (a member, reviewer, rebuttal agent or judge died, or a member went unreviewed) is never retried automatically, because it needs the user's eyes, and neither is a `--stop-after fanout` return.

On a `flawed` verdict with retries remaining:

1. Report the verdict as usual (reasons, eliminated members, transcript path), then say `retrying (<n> of <maxRetries>)` on its own line.
2. Refs for every member are already saved (§5 step 0). Run `council-clean.sh clean` for this attempt's slug so its worktrees are removed; the saved refs keep every member's work reachable through `/cotd runs`.
3. Append to the brief a section `## Previous attempt <n> (flawed)` containing the judge's `reasons` and each `eliminated[].reason`, verbatim, followed by one line: "Do not repeat these failures; address each one explicitly or explain why it does not apply."
4. Re-run the same mode with the same roster, judge and flags, slug `<slug>-r<n+1>`, a new transcript `<date>-<slug>-r<n+1>.md` whose brief section is the extended brief, and a fresh set of worktrees created by `council-clean.sh create`. Skip the approval step; the brief was approved on the first attempt.
5. On success deliver as usual and name every attempt's transcript. When retries are exhausted, report the last verdict, list the kept worktrees of the final attempt, and stop.

`/cotd retry [<slug>]` does the same once, by hand, for the most recent flawed run in this repo (or the named slug): it reads the reasons from that run's transcript `## Verdict` section, cleans that run's worktrees, and launches attempt n+1 with the extended brief. Retries never change the roster; to escalate, pass `--roster` to `/cotd retry`.
