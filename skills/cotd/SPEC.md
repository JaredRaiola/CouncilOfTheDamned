# Council of the Damned — design spec


## Purpose

A skill that convenes several independent agents (mixed models) to attack one task
without seeing each other, then makes them review, rebut, and eliminate each other's
work until one survivor (or a "flawed" verdict) remains. Goal: catch the bugs a
single agent misses, and surface the best approach instead of the first approach.

Invoked whenever the user plans or changes code, in any repo. Lives at user level (a plugin or `~/.claude/skills/cotd`), nothing project-specific in it; repo gotchas go in the brief, not the skill. Always considered — it is consulted on every such request and decides, per §0 of SKILL.md, whether to
convene; roster size is the cost knob once it does.

## Modes

| Mode | Candidate produces | Peers verify by |
|------|--------------------|-----------------|
| design | Approach write-up: files touched, risks, deliberate skips, diff sketch, workflows that a build would need to prove | Rebuttal rounds only |
| build | Real diff in its own worktree + its own test/run output meeting the evidence floor | Running the candidate's tests in its worktree and trying to break it |
| test | Spec file(s) for the target, proven RED then GREEN where applicable | Running every suite against the target and against a deliberately broken copy; a suite that stays green on the broken copy is dead |

Mode inference from the request: plan / design / options / how-should-we → design;
implement / fix / change / add → build; write tests / cover / spec → test. The user
can name the mode explicitly. A design-mode winner can be handed straight into a
build-mode run ("build the winner").

## Flow

```
summons (brief always drafted) → fan-out → convene (review → rebuttal → verdict) → deliver
```

### 0. Summons (brief always drafted)

Orchestrator drafts a **council brief** from the request and the repo:

- task, one paragraph
- relevant files / entry points
- constraints: business rules, applicable memory rules, do-not-touch areas
- affected user workflows it can see
- done criteria

The brief is ALWAYS drafted and sent; only the confirmation step is skippable. It
shows the draft, asks at most a few targeted questions where the request is
ambiguous, and the user edits or approves. "Just go" skips only that step (the
questions and approval) — never the drafting or sending of the brief itself. The
approved (or "just go") brief is sent verbatim and identically to every candidate and
becomes the first section of the transcript.

### 1. Fan-out

Roster: list of `{model, effort}`; default `fable×2, opus×2, sonnet×1`. Overridable
inline ("council with 3 opus and 1 sonnet", "small council" = 3). Each candidate:

- runs as a plain Workflow `agent()` call with no `isolation` opt. Build/test members get a
  `council-wt-<slug>-<label>` worktree that the orchestrator created before the Workflow
  call with `scripts/council-clean.sh create` (detached at `args.base`, the orchestrator's
  `git rev-parse HEAD`, dependency dir linked); they `cd` into it as their first instructed
  step and stop if it is missing. Members never run `git worktree add`, `mklink` or `ln -s`.
  The script, not the member, records `worktree`/`base`. Members commit with message
  exactly `council-<label>`, no trailers. Design members `cd` straight into the target repo,
  read-only, no worktree. Test-mode reviewers get a pre-created `council-wt-<slug>-<label>-scratch`
  worktree and `checkout --force --detach` each candidate's HEAD in it for the mutation check
  (`--force` so an untracked file left by the previous candidate's suite cannot abort the checkout).
- a fable seat that fails (credits, availability) is retried once on opus by the script's
  `seat()` wrapper; `verdict.models` records the model that answered. Review and rebuttal
  rounds run at the seat's own effort.
- receives the brief, an instruction to enter the repo/worktree first, and the
  isolation line: "you are ONE of several independent council members; work only from
  the brief and the repository you are told to enter; do NOT look for other members'
  worktrees, branches, or council transcripts"
- returns a structured submission (schema below)

Candidates never see each other during this stage.

### 2. Convene

Three rounds, each appended to `~/.claude/council/<repo-name>/YYYY-MM-DD-<slug>.md` as it completes.

1. **Blind review.** Each member gets other submissions labeled A, B, C… (no model
   names): every other one at N≤3, and at N>3 a ring — the next two by index
   (`peersOf(list, i)`), so every submission still gets two reviewers at 2N calls instead
   of N(N−1). It returns, per submission: confirmed bugs with repro, weaknesses, and one
   thing it does better than mine. Every round's prompt carries the brief. In build/test mode the reviewer runs the submission's
   tests in that submission's worktree. Reviewers may also challenge a candidate's
   "workflow not affected" claims.
2. **Rebuttal.** Each member sees the reviews of its own submission and answers each
   point: concede, refute (must cite a file or a test run), or fix (build/test mode:
   commits the fix in its worktree and re-runs). Rebuttal-with-fix is configurable,
   default on.
3. **Verdict.** One judge (fable, max effort) reads all rounds and:
   - eliminates any submission with an unrefuted confirmed bug
   - eliminates any submission under the evidence floor (dead on arrival, checked before
     round 1 as well)
   - ranks survivors, names a winner
   - lists grafts: specific fixes or tests to take from eliminated submissions
   - or returns `flawed: true` with reasons and stops
   The judge never sees model names (stripped from its prompt); the orchestrator, not an
   agent, appends a `## Result` block (winner or FLAWED, eliminated, DEGRADED,
   `Models: A=<model>, …`) to the transcript after the script returns. A dead rebuttal
   agent is not a concession; only blocker/major bugs eliminate. Unreviewed survivors are
   named to the judge and cannot win unless it ran their tests and read their diff. Any
   death or unreviewed member sets `verdict.degraded`.

### 3. Deliver

- build: `council-clean.sh apply` — `git add -A` in the winner's worktree,
  `git diff --cached --binary <base>` to a patch, `git apply --check` then `git apply` in
  the main tree (STOP on a failed check) — plus grafts, uncommitted.
- test: same as build — the winner's whole diff (specs plus any testid/source edits) plus
  grafts.
- design: write the winning approach into the transcript and offer "build the winner".
- flawed: main tree untouched; every worktree (build/test) is kept — nothing is removed,
  ever, on a flawed verdict — and SKILL.md prints their paths to the user for inspection
  (not written to the transcript).
- On a non-flawed verdict (build/test, and review with a review target), unless
  `keepWorktrees`: one `council-clean.sh clean` call removes EVERY worktree of this slug,
  not just the eliminated ones (the winner's diff has already been applied to the main
  tree by then), including `-scratch` reviewer worktrees and `council-review-<slug>`.
  Before any removal every worktree's HEAD is saved as `refs/council/<slug>/<label>`.
- review with a PR/branch target: the orchestrator resolves the sha read-only, drafts the
  brief from `git show <sha>:<path>` / `git diff <base>..<sha>`, and members work in a
  detached `council-review-<slug>` worktree of that sha (no dependency link), never in
  the user's working tree.

## Evidence floor (build and test)

- **Workflow** = one user-facing flow the change touches.
- Candidates enumerate affected workflows first; each unaffected-looking workflow they
  exclude needs a one-line justification.
- **minExamplesPerWorkflow: 5** distinct proven cases per workflow (varied inputs, edge
  values, error paths). Proven = command run and output pasted, not described.
- **minWorkflows: 3** is guidance for the member prompt and the judge, not an automatic
  kill. The judge also gets `briefWorkflowCount` (counted by the orchestrator) and each
  member's affected count; marking a brief-listed workflow unaffected without a
  justification is a major flaw.
- Also dead on arrival when the total proven examples across all affected workflows falls
  below minExamplesPerWorkflow; a member is never penalised for volunteering extra
  workflows beyond the brief, or for splitting its proof across many thin workflows.
  Survivors carry an
  `underFloor` list of thin workflows, and the judge eliminates for one of those only if
  it's a workflow the brief lists as affected or a reviewer confirmed matters — the judge
  also still rejects examples that are renames of one case.
- Design mode has no floor but must list the workflows a build would need to prove.

## Config

Bundled defaults live in `council.config.json` next to SKILL.md. A user's overrides live in
`<config dir>/council.config.json` (`$CLAUDE_CONFIG_DIR` or `~/.claude`) and are edited with
`/cotd config ...`; flags override both for one run. Seats are `model[:effort]` strings,
resolved to `{ model, effort }` before the scripts see them.

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

## Files

- `<skill dir>/SKILL.md` — trigger, mode inference, summons,
  how to call the workflows with `args`, how to read and deliver the verdict
- `<skill dir>/council.config.json`
- `<skill dir>/workflows/council-design.js`, `council-build.js`, `council-test.js`, `council-review.js` — invoked via `scriptPath`, so no per-repo `.claude/workflows` entry; the
  convene stages are duplicated in each (no import, one-level nesting only)
- `<skill dir>/scripts/council-clean.sh` (`create` / `clean` / `apply`) — the only thing
  that creates, links, removes or applies worktrees; `council-clean.test.sh` is its
  self-check (temp repo, decoy slug, real links)
- `~/.claude/council/<repo-name>/YYYY-MM-DD-<slug>.md` — transcript per run

## Submission schema

Build/test (`label`/`model` added by the script after the agent returns):
```
{ label, worktree, base, summary,
  workflows: [{name, affected, justification, examples: [{input, expected, observed, proof}]}],
  testCommand, testOutput, risks, skipped }
```
Test mode adds: `specFiles: string[]`, `brokenCopyResult: string`.

Design (no worktree/base — read-only, nothing committed):
```
{ label, summary, approach, filesTouched, diffSketch, risks, skipped, workflowsToProve }
```

Review, rebuttal, and verdict schemas mirror the round descriptions above.

## Gotchas

- Workflow scripts cannot use `Date.now()`; the orchestrator passes the date and slug
  in `args`.
- **Junction hazard (found live).** Worktree builders link the main checkout's
  dependency dir (`node_modules`, `.venv`, etc.) as a junction/symlink rather than
  reinstalling; the brief names the dir for that repo. `git worktree remove --force`
  on a worktree that still holds that link FOLLOWS it and deletes the main checkout's
  real contents. Every removal
  path (member/reviewer cleanup, SKILL.md's post-delivery sweep) must unlink the
  dependency link FIRST (`rmdir`/plain `rm`, never `-r`/`-rf`, which also follows the
  link), only THEN `git worktree remove --force`, then verify the main checkout's dep
  dir is still intact before proceeding.
- **Windows links (found in self-review).** `mklink /J` with a forward slash anywhere in
  either path fails (`Invalid switch`), so no junction is ever made; `council-clean.sh`
  builds both paths with `cygpath -w`. Git Bash `ln -s` on Windows copies instead of
  linking, so the script uses `mklink /J` on MINGW/MSYS/CYGWIN and `ln -s` elsewhere.
  Under MSYS a bare `/c` is mangled, hence `cmd //c` there and `cmd /c` on Cygwin. The
  script checks the link is GONE before `git worktree remove`, else STOP. Never
  `npm ci`/`npm install` in a worktree: it empties the main checkout's dir through the
  junction.
- **Base and delivery.** `base` comes from the orchestrator, never the member (a wrong
  self-reported base empties the diff); `git diff <base>` alone drops untracked files,
  hence `add -A` + `diff --cached`. Commit trailers would leak the model.
- **Blind judge.** Model names never reach the judge prompt; `noMeta()` strips `model`,
  `effort` and the fallback marker from everything quoted to another agent, and the
  orchestrator writes `Models:` into the transcript after the script returns.
- **Scribe removed (2026-09-25).** The haiku scribe agents that appended the verdict note
  and `Models:` line are gone: an agent asked to append one line once ran `git checkout -b`,
  pushed and opened a PR. The orchestrator writes the `## Result` block itself (SKILL.md §5
  step 0), on every verdict including judge-died.
- **Cleanup script owns worktrees (2026-09-25).** Every worktree create/link/remove/apply
  goes through `scripts/council-clean.sh`; members and reviewers never run
  `git worktree add`, `mklink` or `ln -s`, and SKILL.md never hand-assembles link paths
  (hand-assembled backslash paths have silently produced wrong paths). The script STOPs (non-zero, a `STOP:` line)
  before removing a worktree whose link survived (including when `clean` was called with
  `none` but a junction into the main checkout is still there: `worktree remove --force`
  follows junctions), and after cleanup if the main checkout's dependency dir is missing
  or empty. Slug and label are validated against `[A-Za-z0-9._-]` up front, since both
  are interpolated into case globs and ref names.
- **Anchored slug.** `clean` matches worktree basenames with whole-string globs
  (`council-wt-<slug>-[A-J]`, `...-[A-J]-scratch`, `council-review-<slug>`), so slug
  `foo` never touches `council-wt-foo-2-A` from a kept flawed re-run. Scratch worktrees are
  `council-wt-<slug>-<label>-scratch`, one per reviewer, pre-created in §4; §4 pre-flight
  refuses to launch over an existing `council-wt-<slug>-*`.
- **Harness relay (2026-09-25).** The Workflow harness prepends a `[Workflow harness -
  user request]` block quoting the session's latest user message to every agent prompt
  and calls it the only user voice. If the user sent "continue" or an unrelated message
  right after the council call, every member received THAT as the user request. The
  scripts' `isolationRule`/`readOnly` now say the relayed message only authorizes the run
  and the brief defines the task; SKILL.md §4 tells the user in one line when the latest
  message is not the council request.
- **Floor.** Dead on arrival is total proven examples only; `minWorkflows` (default 3)
  and `briefWorkflowCount` are judge guidance. An automatic workflow-count kill punished
  honest members who justified excluding brief-listed workflows.
- **Agents acting on the main repo (found live).** The haiku `scribe:models` agent, asked
  only to append one line, ran `git checkout -b` in the MAIN repo, `git push -u` and
  `gh pr create` (scribes are now deleted, see above). `isolationRule` and the judge prompt
  allow only read-only git in the main repo; never
  checkout/switch/branch/worktree add/push/pull/reset/stash/commit/merge/rebase or `gh`, `az`, `glab` or any other hosting-CLI PR
  commands. SKILL.md §4 records the branch + porcelain, and §5 checks them, restores the
  branch and reports any `origin/*council*` remote branch before delivering.
- **Absolute paths.** `args.repo` is the `C:\...` form of `--show-toplevel`; member git and
  link commands use the absolute worktree path, since a `cd` does not persist between
  agent shell calls.
- Evidence counts only if it runs code in the member's own worktree; the main tree's
  dist bundle proves nothing.
- Tests that depend on a running server or a built bundle are repo-specific; the brief
  says which evidence types count, otherwise candidates stay on unit-level proof and
  say so.
- Transcript is a local file, never an artifact.

## Out of scope

- Live agent-to-agent messaging (rounds are the substitute).
- Auto-commit or PR creation (existing dev-workflow does that after delivery).
- Tournament brackets.
