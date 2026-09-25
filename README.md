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
claude plugin install council@council-of-the-damned
```

Manual:

```
git clone https://github.com/JaredRaiola/CouncilOfTheDamned
cp -r CouncilOfTheDamned/skills/council ~/.claude/skills/council
```

Either way the command is `/council`. Run `/reload-skills` after installing.

## Everything you can do

### Run a council

```
/council [mode] [flags] <task>
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
/council fix the login redirect loop
/council design --roster small how should we cache the search results
/council build --roster fable,fable,opus --judge opus --just-go add rate limiting to /api/upload
/council test --floor 3 cover the date parser
/council review PR 42
/council build --brief docs/briefs/upload-limits.md
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
| `--just-go` | "just go" | no questions, no approval step |

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
| `/council config` | show the effective config and which keys you overrode |
| `/council config roster small` | make an existing preset the default |
| `/council config roster heavy fable:max,fable:max,opus:high` | define preset `heavy` and make it the default |
| `/council config preset cheap sonnet,sonnet` | define or replace a preset, keep the current default |
| `/council config judge opus:max` | default judge |
| `/council config floor 3` | default evidence floor |
| `/council config autoConvene off` | stop the council from convening on its own (see below) |
| `/council config keepWorktrees on` | any other key the same way |
| `/council config reset` | back to shipped defaults |

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
  "minExamplesPerWorkflow": 5,
  "minWorkflows": 3,
  "rebuttalFix": true,
  "keepWorktrees": false,
  "transcriptDir": "~/.claude/council"
}
```

| Key | Meaning |
|---|---|
| `roster` | name of the default preset in `rosters` |
| `rosters` | named seat lists; each seat is `model` or `model:effort` |
| `judge` | the judge seat |
| `autoConvene` | `true`: the skill decides on every plan/change request whether to convene. `false`: only `/council`, "council" or "convene" convene it |
| `minExamplesPerWorkflow` | build/test: fewer proven examples in total than this is dead on arrival |
| `minWorkflows` | build/test: how many workflows members should cover (judge guidance, not a kill) |
| `rebuttalFix` | build/test: members may fix a confirmed bug in their worktree during rebuttal |
| `keepWorktrees` | leave member worktrees in place after a non-flawed verdict |
| `transcriptDir` | where run transcripts are written |

If `fable` is not available in your session, its seats run on `opus`.

### Control when it convenes

With `autoConvene` on, the skill is consulted whenever you ask to plan, implement, fix,
refactor, write tests, or review. It convenes when the change touches more than one file
or workflow, changes business logic, data shape, auth, money or a server contract, or has
more than one reasonable approach. Otherwise it prints `council skipped: <reason>` and
the work proceeds normally. Reviews always convene. Questions never do.

Saying "council" or "convene" always forces a run. `/council config autoConvene off` makes
that the only way. To hide the skill from the model entirely, add
`disable-model-invocation: true` to the SKILL.md frontmatter (a manual-install edit).

### Watch a run

Each run appends to `<transcriptDir>/<repo-name>/<date>-<slug>.md` as it goes: the brief,
every member's submission, every review, every rebuttal, the verdict, and which model
sat in which seat (members and judge never see model names). Same-day re-runs get a
`-2`, `-3` suffix.

### What you get back

- **build / test**: the winner's full diff applied to your main tree, uncommitted, plus
  any grafts the judge took from eliminated members, and the winner's test command run
  once in your tree. Every member's final commit is saved under `refs/council/<slug>/<label>`
  before worktrees are removed.
- **design**: the winning approach, with an offer to build it.
- **review**: findings most-severe first (each confirmed by at least one other member and
  checked by the judge), what was dropped and why, and one merged manual test plan.
- **flawed**: nothing is applied, every worktree is left in place for inspection, and the
  reasons are listed.
- **DEGRADED**: if any member, reviewer or rebuttal agent died, the report says so first
  and nothing lands without your confirmation.

## Cost

Roster size is the cost knob. A 5-seat build run is roughly 15 to 20 agent calls and can
exceed a million tokens. `--roster small` or `--roster cheap` for routine work.

## Safety notes

- Build/test members work in `council-wt-<slug>-<label>` worktrees beside the repo and
  link the main checkout's dependency dir (`node_modules`, `.venv`) into them. Removing a
  worktree while that link is present deletes the real dependency dir. The skill unlinks
  first and verifies; if you clean up by hand, do the same.
- Members and the judge may only run read-only git in the main repo. The skill records
  branch and status before a run and checks them after.
- Nothing is committed and no PR is opened. You commit.

## Files

```
.claude-plugin/plugin.json, marketplace.json   plugin + self-hosted marketplace
skills/council/SKILL.md                        orchestrator instructions
skills/council/SPEC.md                         design spec, evidence floor, gotchas from live runs
skills/council/council.config.json             shipped defaults
skills/council/workflows/council-*.js          one Workflow script per mode
```
