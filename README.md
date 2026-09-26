# Council of the Damned

A [Claude Code](https://claude.com/claude-code) plugin. One task goes to several
independent agents (mixed models, no cross-visibility). They blind-review each other,
rebut, and a judge eliminates until one winner remains, or returns `flawed` and nothing
lands. Catches the bugs a single agent misses and surfaces the best approach instead of
the first one.

```
summons (brief) → fan-out → blind review → rebuttal → verdict → deliver
```

Standalone: no other plugins, no dependencies. Needs Claude Code with the `Workflow` and
`Agent` tools (all paid plans; on Pro enable **Dynamic workflows** in `/config`) and
git 2.5+ for worktrees.

## Install

Marketplace (recommended, gets updates):

```
claude plugin marketplace add JaredRaiola/CouncilOfTheDamned
claude plugin install cotd@council-of-the-damned
```

Manual:

```
git clone https://github.com/JaredRaiola/CouncilOfTheDamned
cp -r CouncilOfTheDamned/skills/cotd ~/.claude/skills/cotd
```

Either way the command is `/cotd`. Run `/reload-skills` after installing.

## Everything you can do

### Run a council

```
/cotd [mode] [flags] <task>
```

| Mode | Trigger words | Members produce | Peers verify by |
|---|---|---|---|
| `design` | plan, design, options, how should we | approach write-ups, read-only | critique + rebuttal rounds |
| `build` | implement, fix, change, add, refactor | real diffs in private git worktrees | running each other's tests, trying to break the diff |
| `test` | write tests, cover, spec, prove | spec files proven RED → GREEN | running every suite against a deliberately broken copy |
| `review` | review PR / branch / diff | independent reviews + manual test plans | cross-checking every finding against the code |
| `audit` | audit, find every, hunt | findings across a scope you name (no PR) + test plan | cross-checking every finding against the code |
| `decide` | decide, choose between, which option | a score for every fixed option, a ranking, and the best argument against their own pick | challenging each other's scores, then rebuttal; the judge ranks, recommends, states confidence and dissent |

The mode is inferred from the task text if you leave it out. Build wins over design when
both appear. A design winner can be handed straight to a build run ("build the winner").
`decide` changes nothing in the repo: you get a decision record, saved under
`<transcriptDir>/<repo>/decisions/` if you say yes.

Examples:

```
/cotd fix the login redirect loop
/cotd design --roster small how should we cache the search results
/cotd build --roster fable,fable,opus --judge opus --just-go add rate limiting to /api/upload
/cotd test --floor 3 cover the date parser
/cotd review PR 42
/cotd build --brief docs/briefs/upload-limits.md
/cotd build --wip finish the half-done retry logic on my working copy
/cotd build --budget 600k --review-model sonnet add pagination to /api/orders
/cotd build --stop-after fanout try three ways to split the monolith config
/cotd audit find every place we trust a client-sent user id
/cotd decide which queue should we use --options "1: Redis streams; 2: SQS; 3: Postgres LISTEN/NOTIFY"
```

### Flags

| Flag | Prose equivalent | Effect for this run |
|---|---|---|
| `--roster <preset>` | "small council", "cheap council" | use a named roster preset |
| `--roster m1,m2,...` | "council with 3 opus and 1 sonnet" | exact seats; `model` or `model:effort` |
| `--judge model[:effort]` | "judge opus" | who decides |
| `--floor N` | "floor 3" | minimum proven examples (build/test) |
| `--no-rebuttal-fix` | "no rebuttal fix" | members may concede or refute, not fix |
| `--keep-worktrees` | "keep worktrees" | leave member worktrees after delivery |
| `--brief <file>` | "brief: <file>" | your file is the brief (see below) |
| `--just-go` | "just go" | no questions, no approval step (`/cotd config justGo on` makes it the default) |
| `--retries N` | "retry up to N times" | on a flawed verdict, re-run with the judge's reasons added to the brief, up to N times |
| `--wip` | "on my working copy", "wip" | build/test on your uncommitted work: it is snapshotted to `refs/council-wip/<slug>` (HEAD, branch and index untouched) and the winner lands on top of your dirty tree |
| `--budget <N>k` | "budget 600k" | phase cap in output tokens: checked after the fan-out and as each rebuttal or cross-check is about to launch; once reached nothing further launches (judge still runs) and the run is marked DEGRADED |
| `--stop-after fanout` | "stop after fanout" | build/test/design: stop after the members; nothing lands, worktrees stay; use `/cotd runs` and `/cotd apply` |
| `--review-model <model>` | "review with sonnet" | run every review, rebuttal and cross-check on that model |
| `--review-effort <effort>` | "review at medium" | run every review, rebuttal and cross-check at that effort |
| `--options "A: ...; B: ..."` | "choose between ..." | decide: the fixed options (or a `## Options` section in your brief) |

Models: whatever your session's Agent tool offers (`fable`, `opus`, `sonnet`, `haiku`).
Effort: `low`, `medium`, `high` (default), `max`. Max 10 seats.

### Pipelines: council for some stages, solo for others

```
/cotd pipeline design:default build:solo test:small add rate limiting to /api/upload
/cotd pipeline design:small build:solo how should we cache search results, then build it
/cotd pipeline build:solo test:cheap fix the date parser
```

Each stage is `<mode>:<roster>`: the mode is `design`, `build` or `test`; the roster is a
preset name, an explicit seat list, or `solo`. `solo` means no council for that stage:
Claude does it as ordinary work, no agents, no judge. Stages chain automatically. The
design winner's plan (tasks with files, line ranges, code and commands) becomes the build
brief's `## Plan (from design stage)`, which builders execute task by task, the build winner is applied uncommitted,
and the test stage runs on that uncommitted tree via `--wip`. The brief is approved once,
up front, with a cost preview for the whole pipeline. A flawed or degraded stage stops the
pipeline; what earlier stages landed stays in your tree, uncommitted. One transcript per
council stage, plus a pipeline summary at the end. Prose works too: "design with the
council, build solo, then test with a small council".

### Skip the questions: supply the brief yourself

Every run starts with a **brief** that all members receive verbatim. By default the
skill drafts it from the repo, shows it, asks up to 3 questions, and waits for your
approval. To give it everything up front, write the brief as a file and pass `--brief`:

```markdown
## Task
<one paragraph>
## Entry points
<files / functions / routes the change touches>
## Constraints
<business rules, do-not-touch areas, repo conventions>
## Affected workflows
1. <user-facing flow>
2. <user-facing flow>
## Evidence that counts
<unit tests / driven runs / e2e available here and what each needs>
## Dependency dir to link into worktrees
<node_modules / .venv / none>
## Done criteria
- <bullet>
```

Sections you include are used as written. Sections you omit are drafted from the repo and
shown to you. A complete file launches immediately.

### Standing brief and lessons

Sections that hold for every run in a repo (constraints, evidence, dependency dir) can live
in a **standing brief**: `<repo>/.cotd/brief.md` (committed, shared with the team) or
`~/.claude/council-briefs/<repo-name>.md` (private); the first one found is used. Its
sections go into every brief verbatim; a `--brief` file beats it, and it beats anything
drafted. It does not skip the approval step, and a `## Task` section in it is ignored with
a warning. The transcript header names the file (`Standing brief: <path|none>`).
`/cotd brief save` writes the current run's brief (minus its Task) to the private location,
`/cotd brief save --shared` to `.cotd/brief.md`.

The judge may also return **lessons**: repo facts a future council needs, never task
specifics. They are appended, dated, to `<transcriptDir>/<repo-name>/lessons.md` (edit it by
hand freely) and added to every later brief of that repo as a separate
`## Lessons from past runs` section.

### Change the default council

Defaults ship in the plugin. A repo can commit `<repo>/.cotd/council.config.json` (the
project layer), limited to `roster`, `rosters`, `judge`, `rosterByMode`,
`minExamplesPerWorkflow`, `minWorkflows`, `rebuttalFix`, `reviewModel` and `reviewEffort`; any other key in
it is reported and ignored. Your overrides live in `~/.claude/council.config.json`
(or `$CLAUDE_CONFIG_DIR/council.config.json`), beat the project layer, and survive plugin
updates. Order: shipped → project → yours → `rosterByMode` → flags. Edit your file by hand or
with:

| Command | Effect |
|---|---|
| `/cotd config` | show the effective config with each key marked `bundled`, `project`, `user` or `flag`, and the standing brief that applies |
| `/cotd config roster small` | make an existing preset the default |
| `/cotd config roster heavy fable:max,fable:max,opus:high` | define preset `heavy` and make it the default |
| `/cotd config preset cheap sonnet,sonnet` | define or replace a preset, keep the current default |
| `/cotd config judge opus:max` | default judge |
| `/cotd config floor 3` | default evidence floor |
| `/cotd config autoConvene off` | stop the council from convening on its own (see below) |
| `/cotd config justGo on` | never ask questions or wait for approval of the brief |
| `/cotd config keepTranscripts off` | delete each run's transcript after its report (flawed and degraded runs are kept) |
| `/cotd config rosterByMode review cheap` | always use preset `cheap` for reviews (`--roster` still wins) |
| `/cotd config maxTokens 600k` | default budget; `0` turns it off |
| `/cotd config reviewModel sonnet` | run reviews, rebuttals and cross-checks on sonnet; `none` = each member's own seat |
| `/cotd config reviewEffort medium` | run reviews, rebuttals and cross-checks at medium effort; `none` = each member's own effort |
| `/cotd config keepWorktrees on` | any other key the same way |
| `/cotd config reset` | back to shipped defaults |

Shipped defaults:

```json
{
  "roster": "default",
  "rosters": {
    "default": ["fable:high", "fable:high", "opus:high", "opus:high"],
    "small":   ["fable:high", "opus:high"],
    "cheap":   ["sonnet:high", "sonnet:high", "sonnet:high"]
  },
  "judge": "fable:high",
  "autoConvene": true,
  "justGo": false,
  "minExamplesPerWorkflow": 5,
  "minWorkflows": 3,
  "rebuttalFix": true,
  "keepWorktrees": false,
  "keepTranscripts": true,
  "transcriptDir": "~/.claude/council",
  "maxTokens": 0,
  "maxRetries": 0,
  "rosterByMode": {},
  "reviewModel": "",
  "reviewEffort": ""
}
```

| Key | Meaning |
|---|---|
| `roster` | name of the default preset in `rosters` |
| `rosters` | named seat lists; each seat is `model` or `model:effort` |
| `judge` | the judge seat |
| `autoConvene` | `true`: the skill decides on every plan/change request whether to convene. `false`: only `/cotd`, "council" or "convene" convene it |
| `justGo` | `true`: every run behaves as if `--just-go` was given — the brief is drafted and sent without questions or approval |
| `minExamplesPerWorkflow` | build/test: fewer proven examples in total than this is dead on arrival |
| `minWorkflows` | build/test: how many workflows members should cover (judge guidance, not a kill) |
| `rebuttalFix` | build/test: members may fix a confirmed bug in their worktree during rebuttal |
| `keepWorktrees` | leave member worktrees in place after a non-flawed verdict |
| `keepTranscripts` | `false`: delete the transcript after each successful run's report |
| `transcriptDir` | where run transcripts are written |
| `maxTokens` | budget per run in output tokens (`--budget`); `0` = off. A phase cap, not a hard limit: the round in flight and the judge still finish |
| `maxRetries` | `0`: a flawed verdict stops. `N`: retry up to N times with the judge's reasons appended to the brief; degraded runs never auto-retry |
| `rosterByMode` | mode → preset name, e.g. `{ "review": "cheap", "decide": "small" }` |
| `reviewModel` | model for every review, rebuttal and cross-check call (`--review-model`); empty = each member's own seat |
| `reviewEffort` | effort for every review, rebuttal and cross-check call (`--review-effort`); empty = each member's own effort |

If `fable` is not available in your session, its seats run on `opus`; a fable seat that
fails mid-run is retried on `opus` and the transcript's `Models:` line names the model that
actually answered.

### Control when it convenes

With `autoConvene` on, the skill is consulted whenever you ask to plan, implement, fix,
refactor, write tests, or review. It convenes when the change touches more than one file
or workflow, changes business logic, data shape, auth, money or a server contract, or has
more than one reasonable approach. Otherwise it prints `council skipped: <reason>` and
the work proceeds normally. Reviews always convene. Questions never do.

Saying "council" or "convene" always forces a run; saying "no council" or "skip council" in
a request skips it for that request. `/cotd config autoConvene off` makes
forcing the only way. To hide the skill from the model entirely, add
`disable-model-invocation: true` to the SKILL.md frontmatter (a manual-install edit).

### Watch a run

Each run appends to `<transcriptDir>/<repo-name>/<date>-<slug>.md` as it goes: the brief,
every member's submission, every review, every rebuttal, the verdict, and a final
`## Result` block with the winner (or the flawed reasons), eliminations, any DEGRADED
entries, and which model sat in which seat (members and judge never see model names).
Same-day re-runs get a `-2`, `-3` suffix. Before launching, the skill prints a one-line
cost preview: members, judge and roughly how many agent calls the run will make.

Clear them with `/cotd clear` (this repo's transcripts; `lessons.md`, `decisions/` and the
ledger stay) or `/cotd clear all` (the whole transcript dir, lessons and decisions included,
plus the ledger); both list what will be deleted and ask once, `--yes` skips the question.
`/cotd config keepTranscripts off` deletes each run's transcript automatically once its
report is printed.

### Other commands

| Command | Effect |
|---|---|
| `/cotd doctor` | read-only health check: git >= 2.5, Workflow and Agent tools, `fable` available, no CR characters in the workflow scripts, every config file parses and every preset resolves, transcript dir writable, stale council worktrees and dangling dependency links. Changes nothing |
| `/cotd stats` | wins, rankings, eliminations, dead-on-arrival and deaths per `model:effort` and per mode, from the last 500 runs in `~/.claude/council-ledger.jsonl` (one line per run, written on every run; never shown to any agent) |
| `/cotd retry [<slug>]` | re-run the most recent (or named) flawed run once, with its judge's reasons added to the brief; `--roster` escalates |
| `/cotd runs [slug]` | every saved `refs/council/<slug>/<label>` with its `git diff --stat` |
| `/cotd apply <slug> <label>` | apply one saved member's work to your tree, uncommitted. Refuses if it touches a file you have uncommitted changes in, stops if it does not apply cleanly, and says so when that member was not the council's winner |
| `/cotd brief save [--shared]` | save the current run's brief (minus its Task) as the standing brief |

### What you get back

- **build / test**: the winner's full diff applied to your main tree, uncommitted, plus
  any grafts the judge took from eliminated members, and the winner's test command run
  once in your tree. Under `--wip` only the council's change is applied, on top of your
  uncommitted work. Every member's worktree (uncommitted work included) is saved under
  `refs/council/<slug>/<label>` before the verdict is acted on, flawed runs too.
- **design**: the winning approach, with an offer to build it.
- **audit**: like review, over the scope named in the task instead of a change.
- **decide**: the final ranking of your options, a recommendation with its confidence, the
  rationale and the dissent worth recording, with an offer to save it as a decision record.
- **review**: findings most-severe first (each confirmed by at least one other member and
  checked by the judge), what was dropped and why, and one merged manual test plan. A PR or
  branch is reviewed at its own head, in a detached `council-review-<slug>` worktree, never
  in your working tree.
- **flawed** (and `--stop-after fanout`): nothing is applied, every worktree is left in
  place for inspection, and the reasons are listed; `/cotd apply` can still deliver any one
  member's saved work.
- **DEGRADED**: if any member, reviewer or rebuttal agent died, or the budget ran out, the
  report says so first and nothing lands without your confirmation.

## Cost

Roster size is the cost knob. A run is up to 3N+2 agent calls for N members (build,
review, rebuttal, judge); with more than 3 members each one reviews two peers instead of
all of them, a rebuttal answers only blocker/major bugs (a member that drew none fixes its
minors instead), and a member's rebuttal starts as soon as its own reviewers return rather
than after the whole review round (review mode pipelines its cross-checks the same way).
Members prove their examples from one final test run, not one run per example, and stop
once every workflow has its floor. Reviewers see peers' proofs capped at 400 characters and
their own submission as a stub; rebuttal agents get their own stub and answer bugs by id.
The judge (design and decide included) decides on the record (reviews, rebuttals, test
tails, example inputs, the reviewers' proof-quality ratings), reads a diff only to settle a
disputed bug, and reads the winner's diff once before naming it. A 4-seat build run can still
exceed a million tokens. `--roster small` or
`--roster cheap` for routine work, `--review-model sonnet` or `--review-effort medium` to make
the review rounds cheaper, `--budget 600k` to cut the rounds short once that many output
tokens are spent, and `/cotd stats` to see which seats actually win.

## Safety notes

- Build/test members work in `council-wt-<slug>-<label>` worktrees beside the repo with
  the main checkout's dependency dir (`node_modules`, `.venv`) linked into them. Removing a
  worktree while that link is present deletes the real dependency dir. Only
  `skills/cotd/scripts/council-clean.sh` creates, links, removes or applies those
  worktrees: members never run `git worktree add` or `mklink`, and `clean` saves every
  worktree (uncommitted work included) under `refs/council/<slug>/<label>`, unlinks first, refuses to remove a
  worktree whose link survived, and verifies your dependency dir afterwards. It only ever
  touches worktrees of the run's own slug. After a `flawed` verdict the worktrees stay for
  inspection; remove them with
  `bash <plugin>/skills/cotd/scripts/council-clean.sh clean <repo> <slug> <depDir|none>`,
  never by hand.
- Members and the judge may only run read-only git in the main repo. The skill records
  branch and status before a run and checks them after. No helper agents write to the
  transcript; the skill writes the `## Result` block itself.
- The Workflow harness relays your latest message to every member as "the user request".
  If you send "continue" or an unrelated message right after launching, members are told
  that message only authorizes the run and the brief defines the task; the skill warns you
  in one line when the message it is about to relay is not the council request.
- Nothing is committed and no PR is opened. You commit.

## Files

```
.claude-plugin/plugin.json, marketplace.json   plugin + self-hosted marketplace
skills/cotd/SKILL.md                        orchestrator instructions
skills/cotd/SPEC.md                         design spec, evidence floor, gotchas from live runs
skills/cotd/council.config.json             shipped defaults
skills/cotd/workflows/council-*.js          one Workflow script per mode (design, build, test, review/audit, decide)
skills/cotd/scripts/council-clean.sh        worktrees, refs, wip snapshot, runs, stats, doctor (and its .test.sh)
skills/cotd/scripts/council-workflows.test.mjs  stub-harness self-check for every workflow script
```
