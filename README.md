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

The mode is inferred from the task text if you leave it out. Build wins over design when
both appear. A design winner can be handed straight to a build run ("build the winner").

Examples:

```
/cotd fix the login redirect loop
/cotd design --roster small how should we cache the search results
/cotd build --roster fable,fable,opus --judge opus --just-go add rate limiting to /api/upload
/cotd test --floor 3 cover the date parser
/cotd review PR 42
/cotd build --brief docs/briefs/upload-limits.md
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

Models: whatever your session's Agent tool offers (`fable`, `opus`, `sonnet`, `haiku`).
Effort: `low`, `medium`, `high` (default), `max`. Max 10 seats.

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

### Change the default council

Defaults ship in the plugin. Your overrides live in `~/.claude/council.config.json`
(or `$CLAUDE_CONFIG_DIR/council.config.json`) and survive plugin updates. Edit that file
by hand or with:

| Command | Effect |
|---|---|
| `/cotd config` | show the effective config and which keys you overrode |
| `/cotd config roster small` | make an existing preset the default |
| `/cotd config roster heavy fable:max,fable:max,opus:high` | define preset `heavy` and make it the default |
| `/cotd config preset cheap sonnet,sonnet` | define or replace a preset, keep the current default |
| `/cotd config judge opus:max` | default judge |
| `/cotd config floor 3` | default evidence floor |
| `/cotd config autoConvene off` | stop the council from convening on its own (see below) |
| `/cotd config justGo on` | never ask questions or wait for approval of the brief |
| `/cotd config keepTranscripts off` | delete each run's transcript after its report (flawed and degraded runs are kept) |
| `/cotd config keepWorktrees on` | any other key the same way |
| `/cotd config reset` | back to shipped defaults |

Shipped defaults:

```json
{
  "roster": "default",
  "rosters": {
    "default": ["fable:high", "fable:high", "opus:high", "opus:high", "sonnet:high"],
    "small":   ["fable:high", "opus:high", "sonnet:high"],
    "cheap":   ["sonnet:high", "sonnet:high", "sonnet:high"]
  },
  "judge": "fable:max",
  "autoConvene": true,
  "justGo": false,
  "minExamplesPerWorkflow": 5,
  "minWorkflows": 3,
  "rebuttalFix": true,
  "keepWorktrees": false,
  "keepTranscripts": true,
  "transcriptDir": "~/.claude/council"
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

Clear them with `/cotd clear` (this repo's transcripts) or `/cotd clear all`; both list what
will be deleted and ask once, `--yes` skips the question. `/cotd config keepTranscripts off`
deletes each run's transcript automatically once its report is printed.

### What you get back

- **build / test**: the winner's full diff applied to your main tree, uncommitted, plus
  any grafts the judge took from eliminated members, and the winner's test command run
  once in your tree. Every member's final commit is saved under `refs/council/<slug>/<label>`
  before worktrees are removed.
- **design**: the winning approach, with an offer to build it.
- **review**: findings most-severe first (each confirmed by at least one other member and
  checked by the judge), what was dropped and why, and one merged manual test plan. A PR or
  branch is reviewed at its own head, in a detached `council-review-<slug>` worktree, never
  in your working tree.
- **flawed**: nothing is applied, every worktree is left in place for inspection, and the
  reasons are listed.
- **DEGRADED**: if any member, reviewer or rebuttal agent died, the report says so first
  and nothing lands without your confirmation.

## Cost

Roster size is the cost knob. A run is about 3N+2 agent calls for N members (build,
review, rebuttal, judge); with more than 3 members each one reviews two peers instead of
all of them. A 5-seat build run can exceed a million tokens. `--roster small` or
`--roster cheap` for routine work.

## Safety notes

- Build/test members work in `council-wt-<slug>-<label>` worktrees beside the repo with
  the main checkout's dependency dir (`node_modules`, `.venv`) linked into them. Removing a
  worktree while that link is present deletes the real dependency dir. Only
  `skills/cotd/scripts/council-clean.sh` creates, links, removes or applies those
  worktrees: members never run `git worktree add` or `mklink`, and `clean` saves every
  worktree's commit under `refs/council/<slug>/<label>`, unlinks first, refuses to remove a
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
skills/cotd/workflows/council-*.js          one Workflow script per mode
skills/cotd/scripts/council-clean.sh        worktree create / clean / apply (and its .test.sh)
```
