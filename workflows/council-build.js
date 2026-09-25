export const meta = {
  name: 'council-build',
  description: 'Council of the Damned (build): isolated builders, blind review, rebuttal, verdict',
  phases: [{ title: 'Build' }, { title: 'Review' }, { title: 'Rebuttal' }, { title: 'Verdict' }],
}

const A = args
const LABELS = 'ABCDEFGHIJ'
const noModel = ({ model, ...s }) => s
let roster = A.roster
if (roster.length > LABELS.length) { log('roster truncated to 10'); roster = roster.slice(0, LABELS.length) }
const floor = { perWorkflow: A.minExamplesPerWorkflow, workflows: A.minWorkflows ?? 3 }
const win = (s) => String(s).replace(/\//g, '\\')
const wtPath = (L) => `${A.repo}/../council-wt-${A.slug}-${L}`
const linkCmd = (dir) => `on Windows ALWAYS the junction form with backslash paths only — via the Bash tool \`cmd //c mklink //J "${win(`${dir}/${A.depDir}`)}" "${win(`${A.repo}/${A.depDir}`)}"\`, or if you are in PowerShell \`cmd /c mklink /J\` with the same paths (Git Bash \`ln -s\` on Windows COPIES instead of linking; never use it there); elsewhere \`ln -s "${A.repo}/${A.depDir}" "${dir}/${A.depDir}"\``
const noPkgRule = `Never run \`npm ci\`, \`npm install\`, \`npm uninstall\` or any other package-manager mutation inside a worktree: the dependency dir is a junction into the main checkout and it would rewrite (or wipe) the real one.`
const evidenceRule = `Evidence counts ONLY if it executes code in YOUR worktree; a server, dev server or bundle built outside it (e.g. the main checkout's dist or a running dev server) proves nothing — if that is the only way to prove something, say so in \`skipped\`.`
const trim = (s) => ({ ...s, testOutput: String(s.testOutput ?? '').slice(-2000) })

const EXAMPLE = { type: 'object', properties: { input: { type: 'string' }, expected: { type: 'string' }, observed: { type: 'string' }, proof: { type: 'string' } }, required: ['input', 'expected', 'observed', 'proof'] }
const WORKFLOW = { type: 'object', properties: { name: { type: 'string' }, affected: { type: 'boolean' }, justification: { type: 'string' }, examples: { type: 'array', items: EXAMPLE } }, required: ['name', 'affected', 'examples'] }
const SUBMISSION = { type: 'object', properties: {
  summary: { type: 'string' },
  workflows: { type: 'array', items: WORKFLOW }, testCommand: { type: 'string' }, testOutput: { type: 'string' },
  risks: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'workflows', 'testCommand', 'testOutput'] }
const BUG = { type: 'object', properties: { desc: { type: 'string' }, repro: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] } }, required: ['desc', 'repro', 'severity'] }
const reviewSchema = (labels) => ({ type: 'object', properties: { reviews: { type: 'array', items: { type: 'object', properties: {
  of: { type: 'string', enum: labels }, bugs: { type: 'array', items: BUG }, weaknesses: { type: 'array', items: { type: 'string' } },
  betterThanMine: { type: 'string' }, workflowChallenges: { type: 'array', items: { type: 'string' } },
}, required: ['of', 'bugs', 'weaknesses', 'betterThanMine'] } } }, required: ['reviews'] })
const REBUTTAL = { type: 'object', properties: { responses: { type: 'array', items: { type: 'object', properties: {
  bug: { type: 'string' }, action: { type: 'string', enum: ['concede', 'refute', 'fix'] }, evidence: { type: 'string' },
}, required: ['bug', 'action', 'evidence'] } } }, required: ['responses'] }
const verdictSchema = (labels) => ({ type: 'object', properties: {
  flawed: { type: 'boolean' }, reasons: { type: 'array', items: { type: 'string' } },
  eliminated: { type: 'array', items: { type: 'object', properties: { label: { type: 'string', enum: labels }, reason: { type: 'string' } }, required: ['label', 'reason'] } },
  ranking: { type: 'array', items: { type: 'string', enum: labels } }, winner: { type: 'string', enum: [...labels, ''] },
  grafts: { type: 'array', items: { type: 'object', properties: { from: { type: 'string', enum: labels }, what: { type: 'string' }, how: { type: 'string' } }, required: ['from', 'what', 'how'] } },
}, required: ['flawed', 'reasons', 'eliminated', 'ranking', 'grafts', 'winner'] })

// ponytail: single heredoc append per agent; interleaving between parallel agents is a known ceiling,
// upgrade to per-agent fragment files + a scribe if it ever bites.
const appendRule = (section) => `
When done, append your section to the transcript ${A.transcript} with ONE bash command:
cat >> "${A.transcript}" <<'TRANSCRIPT'
${section}
TRANSCRIPT
Keep it under 80 lines. Do not edit any other part of that file.`

const mainRepoRule = `In the main repository at ${A.repo} you may only run read-only git commands (show, diff, log, ls-tree, rev-parse, worktree list) plus the single \`git -C "${A.repo}" worktree add ...\` you are told to run. NEVER run git checkout, switch, branch, push, pull, reset, stash, commit, merge, rebase, or \`gh\`, \`az\`, \`glab\` or any other hosting-CLI PR commands against the main repository. Delivery and pull requests are the orchestrator's job.`
const scribePrompt = (text) => `Your ONLY task: append the following text to the file ${A.transcript} using one \`cat >> "${A.transcript}" <<'TRANSCRIPT' ... TRANSCRIPT\` command from the Bash tool. Do not read the repository, do not run any git command, do not create branches, do not push, do not open pull requests, do not run tests. When the append is done, return the single word DONE.

cat >> "${A.transcript}" <<'TRANSCRIPT'
${text}
TRANSCRIPT`
const isolationRule = `You are ONE of several independent council members. Work only from the brief and the repository you are told to enter below. Do NOT look for other members' worktrees, branches, or council transcripts. Do not invoke the council-of-the-damned skill; you are already a member. ${mainRepoRule}`

const buildPrompt = (i) => `${isolationRule}

You are council member ${LABELS[i]}. Implement the task below.
First, create your private worktree and enter it: \`git -C "${A.repo}" worktree add "${wtPath(LABELS[i])}" ${A.base}\`. Your worktree is \`${wtPath(LABELS[i])}\`: use that absolute path in every git and link command (\`git -C "${wtPath(LABELS[i])}" ...\`) and prefix other commands with \`cd "${wtPath(LABELS[i])}" &&\` — never rely on a prior \`cd\` persisting. If \`git worktree add\` fails, STOP and return an error; never edit files outside your worktree. All your work happens there. Never run \`rm -rf\`, \`git clean\`, or \`git worktree remove\` on your own worktree; the orchestrator removes it.
${A.depDir ? `Then, if "${wtPath(LABELS[i])}/${A.depDir}" is missing, link it from the main checkout: ${linkCmd(wtPath(LABELS[i]))}.` : ''}
${noPkgRule}
Your base commit is ${A.base}. When done: \`git -C "${wtPath(LABELS[i])}" add -A && git -C "${wtPath(LABELS[i])}" commit -m council-${LABELS[i]}\` — exactly that message, no trailers (no Co-Authored-By).

## Brief
${A.brief}

## Evidence floor (fewer than ${floor.perWorkflow} proven examples IN TOTAL eliminates you; per-workflow thinness is weighed by the judge)
1. Enumerate every user-facing workflow this change touches. For each one you exclude, give a one-line justification.
2. For each affected workflow, provide at least ${floor.perWorkflow} DISTINCT proven examples: different inputs, edge values, error paths. Proven = you ran it and paste the observed output in \`proof\`. Described-but-not-run does not count.
3. Cover at least ${floor.workflows} workflows, or all affected workflows if fewer exist (guidance the judge weighs, not an automatic kill).
Evidence that counts here: ${A.evidenceNotes || 'unit tests and driven runs; say which you used'}.
${evidenceRule}

Return \`testCommand\` (the exact command, relative to the worktree root — no absolute paths) and \`testOutput\` (its tail, ~40 lines).
${appendRule(`## Build — member ${LABELS[i]}\n<summary, workflows covered with example counts, test command + result tail, risks, skipped>`)}`

const reviewPrompt = (me, others) => `${isolationRule.replace('Do NOT look for', 'You may read ONLY the submissions and worktrees listed below. Do NOT look for')}

First: cd "${A.repo}".
You are council member ${me.label}. Blind-review the other members' submissions. Authors are anonymous. Use ONLY the single-letter label (A, B, C…) in "of". Every worktree branched from base ${A.base}: for each submission read \`git -C <its worktree> diff ${A.base}\` FIRST. ${noPkgRule} Do not modify tracked files in any member's worktree; run tests only. For EACH submission: run its testCommand inside its worktree, try to break it (edge inputs, error paths, the workflows it claims are unaffected), and report confirmed bugs with a repro command, weaknesses, one thing it does better than your own submission, and any workflow-exclusion you challenge. Also state, per submission, whether any of its listed \`underFloor\` workflows actually matter for the brief, or are extras the member volunteered beyond it.

Your own submission, for comparison: ${JSON.stringify(trim(noModel(me)), null, 1)}

Other submissions:
${others.map(trim).map(o => `### ${o.label}\nworktree: ${o.worktree}\nbase: ${o.base}\n${JSON.stringify({ summary: o.summary, workflows: o.workflows, testCommand: o.testCommand, testOutput: o.testOutput, risks: o.risks, skipped: o.skipped, underFloor: o.underFloor }, null, 1)}`).join('\n\n')}
${appendRule(`## Review — by ${me.label}\n<per submission: bugs (severity, repro), weaknesses, better-than-mine, challenges>`)}`

const rebuttalPrompt = (me, reviewsOfMe) => `First: cd "${me.worktree}".
${isolationRule}

You are council member ${me.label}. Below are anonymous peer reviews of YOUR submission. Answer every bug: 'concede', 'refute' (evidence MUST cite a file:line or a command you ran and its output), or 'fix'${A.rebuttalFix ? ` (make the fix in your worktree ${me.worktree}, commit it with \`git -C "${me.worktree}" add -A && git -C "${me.worktree}" commit -m council-${me.label}-fix\`, re-run your testCommand from inside the worktree as \`cd "${me.worktree}" && <testCommand>\` — never rely on a prior cd persisting — and paste the result as evidence)` : ' is NOT allowed this run; concede instead'}.

Your submission: ${JSON.stringify(noModel(me), null, 1)}

Reviews of you:
${JSON.stringify(reviewsOfMe, null, 1)}
${appendRule(`## Rebuttal — ${me.label}\n<per bug: action + evidence>`)}`

const judgePrompt = (subs, reviews, rebuttals, dead, unreviewed) => `First: cd "${A.repo}".
${mainRepoRule}
You are the judge of the Council of the Damned. Read everything, then decide. For every surviving submission read \`git -C <its worktree> diff ${A.base}\` first.

Rules, in order:
1. Eliminate any submission with a confirmed blocker or major bug that was neither refuted with evidence nor fixed (a fix must show a passing re-run). A missing rebuttal, or one marked died:true, is NOT a concession — weigh those bugs on the evidence yourself. Minor bugs affect ranking only, never elimination.
2. Eliminate any submission whose examples are not genuinely distinct or whose 'proof' fields are descriptions rather than output. A submission's underFloor list names workflows with too few examples: eliminate ONLY if an under-floor workflow is one the brief lists as affected or one a reviewer confirmed matters; ignore thin coverage on workflows the member volunteered beyond the brief.
3. Rank survivors on correctness, then coverage of workflows, then simplicity (smaller diff wins ties).
4. Name a winner and list grafts: specific fixes or tests from eliminated or lower-ranked submissions that the winner lacks, with 'how' = concrete steps to apply from that worktree.
5. If no survivor is acceptable, return flawed=true with reasons and an empty winner.

Use ONLY the single-letter label in every label/winner/from field and in your transcript section.

The brief lists ${A.briefWorkflowCount ?? '?'} affected workflows; affected-workflow count per member: ${JSON.stringify(Object.fromEntries(subs.map(s => [s.label, s.workflows.filter(w => w.affected).length])))}. A member that marks brief-listed workflows unaffected must have justified each; unjustified exclusions are a major flaw.
Unreviewed members: ${JSON.stringify(unreviewed)} — an unreviewed member cannot win unless you ran its tests and read its diff yourself.
Already dead on arrival (under evidence floor): ${JSON.stringify(dead)}
Submissions: ${JSON.stringify(subs.map(({ model, ...s }) => trim(s)), null, 1)}
Reviews: ${JSON.stringify(reviews, null, 1)}
Rebuttals: ${JSON.stringify(rebuttals, null, 1)}
${appendRule(`## Verdict\n<eliminated + why, ranking, winner, grafts, or FLAWED + reasons>`)}`

const floorCheck = (s) => {
  const affected = s.workflows.filter(w => w.affected)
  const total = affected.reduce((n, w) => n + w.examples.length, 0)
  return { total, underFloor: affected.filter(w => w.examples.length < floor.perWorkflow).map(w => `${w.name} (${w.examples.length}/${floor.perWorkflow})`) }
}
const doa = (c) => c.total < floor.perWorkflow ? `fewer than ${floor.perWorkflow} proven examples in total` : ''
const degraded = []

phase('Build')
const results = await parallel(roster.map((m, i) => () =>
  agent(buildPrompt(i), { label: `build:${LABELS[i]}`, phase: 'Build', model: m.model, effort: m.effort, schema: SUBMISSION })
    .then(s => s && { ...s, worktree: wtPath(LABELS[i]), base: A.base, label: LABELS[i], model: m.model })
))
results.forEach((r, i) => { if (!r) degraded.push(`member ${LABELS[i]} died during build`) })
const built = results.filter(Boolean)
if (built.length < roster.length) log(`${roster.length - built.length} member(s) died during build`)

const checks = built.map(s => ({ s, ...floorCheck(s) }))
const dead = checks.filter(doa).map(c => ({ label: c.s.label, reason: doa(c) }))
const alive = checks.filter(c => !doa(c)).map(c => ({ ...c.s, underFloor: c.underFloor }))
if (dead.length) log(`dead on arrival: ${dead.map(d => d.label).join(', ')}`)
if (!alive.length) {
  const reasons = built.length ? ['every member under evidence floor'] : ['every member died']
  const scribeNote = built.length ? `FLAWED — every member dead on arrival: ${reasons.join('; ')}` : `FLAWED — every member died: ${reasons.join('; ')}`
  phase('Verdict')
  await agent(scribePrompt(`## Verdict\n${scribeNote}`), { label: 'scribe', phase: 'Verdict', model: 'haiku', effort: 'low' })
  return { submissions: built, reviews: [], rebuttals: [], verdict: { flawed: true, reasons, eliminated: dead, ranking: [], winner: '', grafts: [], models: Object.fromEntries(built.map(s => [s.label, s.model])), ...(degraded.length && { degraded }) }, transcript: A.transcript }
}

let reviews = [], rebuttals = []
if (alive.length > 1) {
  phase('Review')
  const rv = await parallel(alive.map(me => () => {
    const others = alive.filter(o => o.label !== me.label)
    return agent(reviewPrompt(me, others), { label: `review:${me.label}`, phase: 'Review', model: A.reviewModel || me.model, effort: 'high', schema: reviewSchema(others.map(o => o.label)) })
      .then(r => r && { by: me.label, ...r })
  }))
  rv.forEach((r, i) => { if (!r) degraded.push(`reviewer ${alive[i].label} died`) })
  reviews = rv.filter(Boolean)

  phase('Rebuttal')
  rebuttals = await parallel(alive.map(me => () => {
    const ofMe = reviews.flatMap(r => r.reviews.filter(x => x.of === me.label).map(x => ({ by: r.by, ...x })))
    if (!ofMe.some(x => x.bugs.length || x.workflowChallenges?.length)) return Promise.resolve({ label: me.label, responses: [] })
    return agent(rebuttalPrompt(me, ofMe), { label: `rebut:${me.label}`, phase: 'Rebuttal', model: A.reviewModel || me.model, effort: 'high', schema: REBUTTAL })
      .then(r => r ? { label: me.label, ...r } : { label: me.label, responses: [], died: true })
  }))
  rebuttals.forEach(r => { if (r.died) degraded.push(`rebuttal ${r.label} died`) })
} else {
  log('single survivor: skipping review and rebuttal')
}
const unreviewed = alive.filter(s => !reviews.some(r => r.reviews.some(x => x.of === s.label))).map(s => s.label)
if (unreviewed.length) { log(`unreviewed: ${unreviewed.join(', ')}`); degraded.push(`unreviewed: ${unreviewed.join(', ')}`) }

phase('Verdict')
let verdict = await agent(judgePrompt(alive, reviews, rebuttals, dead, unreviewed), { label: 'judge', phase: 'Verdict', model: A.judge.model, effort: A.judge.effort, schema: verdictSchema(alive.map(s => s.label)) })
  || (degraded.push('judge'), { flawed: true, reasons: ['judge died'], eliminated: [], ranking: [], winner: '', grafts: [] })
if (!verdict.flawed && !verdict.winner) verdict = { ...verdict, flawed: true, reasons: [...verdict.reasons, 'judge returned no winner'] }
const eliminatedSeen = new Set()
verdict.eliminated = [...dead, ...verdict.eliminated].filter(e => (eliminatedSeen.has(e.label) ? false : (eliminatedSeen.add(e.label), true)))
if (!verdict.flawed && verdict.eliminated.some(e => e.label === verdict.winner)) verdict = { ...verdict, flawed: true, reasons: [...verdict.reasons, 'judge named an eliminated member as winner'] }
verdict.models = Object.fromEntries(built.map(s => [s.label, s.model]))
if (degraded.length) verdict.degraded = degraded
await agent(scribePrompt(`Models: ${Object.entries(verdict.models).map(([l, m]) => `${l}=${m}`).join(', ')}`), { label: 'scribe:models', phase: 'Verdict', model: 'haiku', effort: 'low' })
return { submissions: built, reviews, rebuttals, verdict, transcript: A.transcript }
