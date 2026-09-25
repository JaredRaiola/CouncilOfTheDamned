export const meta = {
  name: 'council-design',
  description: 'Council of the Damned (design): independent approaches, blind critique, rebuttal, verdict',
  phases: [{ title: 'Design' }, { title: 'Review' }, { title: 'Rebuttal' }, { title: 'Verdict' }],
}

const A = args
const LABELS = 'ABCDEFGHIJ'
const noModel = ({ model, ...s }) => s
let roster = A.roster
if (roster.length > LABELS.length) { log('roster truncated to 10'); roster = roster.slice(0, LABELS.length) }

const SUBMISSION = { type: 'object', properties: {
  summary: { type: 'string' }, approach: { type: 'string' }, filesTouched: { type: 'array', items: { type: 'string' } },
  diffSketch: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'string' } },
  workflowsToProve: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'approach', 'filesTouched', 'risks', 'skipped', 'workflowsToProve'] }
const BUG = { type: 'object', properties: { desc: { type: 'string' }, where: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] } }, required: ['desc', 'severity'] }
const reviewSchema = (labels) => ({ type: 'object', properties: { reviews: { type: 'array', items: { type: 'object', properties: {
  of: { type: 'string', enum: labels }, bugs: { type: 'array', items: BUG }, weaknesses: { type: 'array', items: { type: 'string' } },
  betterThanMine: { type: 'string' }, workflowChallenges: { type: 'array', items: { type: 'string' } },
}, required: ['of', 'bugs', 'weaknesses', 'betterThanMine'] } } }, required: ['reviews'] })
const REBUTTAL = { type: 'object', properties: { responses: { type: 'array', items: { type: 'object', properties: {
  bug: { type: 'string' }, action: { type: 'string', enum: ['concede', 'refute'] }, evidence: { type: 'string' },
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

const mainRepoRule = `In the main repository at ${A.repo} you may only run read-only git commands (show, diff, log, ls-tree, rev-parse, worktree list) plus the single \`git -C "${A.repo}" worktree add ...\` you are told to run. NEVER run git checkout, switch, branch, push, pull, reset, stash, commit, merge, rebase, or \`gh\`/\`az\` PR commands against the main repository. Delivery and pull requests are the orchestrator's job.`
const scribePrompt = (text) => `Your ONLY task: append the following text to the file ${A.transcript} using one \`cat >> "${A.transcript}" <<'TRANSCRIPT' ... TRANSCRIPT\` command from the Bash tool. Do not read the repository, do not run any git command, do not create branches, do not push, do not open pull requests, do not run tests. When the append is done, return the single word DONE.

cat >> "${A.transcript}" <<'TRANSCRIPT'
${text}
TRANSCRIPT`
const isolationRule = `You are ONE of several independent council members. Work only from the brief and the repository you are told to enter below. Do NOT look for other members' worktrees, branches, or council transcripts. Do not invoke the council-of-the-damned skill; you are already a member. ${mainRepoRule}`

const buildPrompt = (i) => `First: cd "${A.repo}" — that is the repository under discussion; read it there.

${isolationRule}

You are council member ${LABELS[i]}. Propose ONE approach for the task below. Read the repo (read-only, do not edit files). Return: summary, approach (how it works, why this over alternatives), filesTouched, a diffSketch (pseudo-diff, key lines only), risks, what you deliberately skip and why, and workflowsToProve (user-facing flows a build would have to prove, one line each).

## Brief
${A.brief}
${appendRule(`## Design — member ${LABELS[i]}\n<summary, approach, files touched, risks, skipped, workflows to prove>`)}`

const reviewPrompt = (me, others) => `First: cd "${A.repo}" — that is the repository under discussion; read it there.

${isolationRule.replace('Do NOT look for', 'You may read ONLY the submissions listed below. Do NOT look for')}

You are council member ${me.label}. Blind-review the other members' submissions. Authors are anonymous. Use ONLY the single-letter label (A, B, C…) in "of". Critique each approach: where would it break, what does it miss, what hidden cost does it carry, and what does it do better than yours. Cite files you checked.

Your own submission, for comparison: ${JSON.stringify(noModel(me), null, 1)}

Other submissions:
${others.map(o => `### ${o.label}\n${JSON.stringify({ summary: o.summary, approach: o.approach, filesTouched: o.filesTouched, diffSketch: o.diffSketch, risks: o.risks, skipped: o.skipped, workflowsToProve: o.workflowsToProve }, null, 1)}`).join('\n\n')}
${appendRule(`## Review — by ${me.label}\n<per submission: bugs (severity, where), weaknesses, better-than-mine, challenges>`)}`

const rebuttalPrompt = (me, reviewsOfMe) => `First: cd "${A.repo}".
${isolationRule}

You are council member ${me.label}. Below are anonymous peer reviews of YOUR submission. Answer every bug: 'concede' or 'refute' (evidence MUST cite a file:line or a command you ran and its output).

Your submission: ${JSON.stringify(noModel(me), null, 1)}

Reviews of you:
${JSON.stringify(reviewsOfMe, null, 1)}
${appendRule(`## Rebuttal — ${me.label}\n<per bug: action + evidence>`)}`

const judgePrompt = (subs, reviews, rebuttals, unreviewed) => `First: cd "${A.repo}" — that is the repository under discussion; read it there.

${mainRepoRule}
You are the judge of the Council of the Damned. Read everything, then decide.

Rules, in order:
1. Eliminate any approach with a reviewer-identified blocker or major flaw that the author neither refuted with evidence nor conceded with a workable mitigation. A missing rebuttal, or one marked died:true, is NOT a concession — weigh those flaws yourself. Minor flaws affect ranking only, never elimination.
2. Eliminate any approach that contradicts the repo's existing patterns without justification, or that hand-waves away a risk a reviewer identified.
3. Rank survivors on correctness of reasoning, then fit with the repo's existing patterns, then simplicity.
4. Name a winner and list grafts: specific ideas from eliminated or lower-ranked submissions that the winner lacks, with 'how' = one sentence.
5. If no survivor is acceptable, return flawed=true with reasons and an empty winner.

Use ONLY the single-letter label in every label/winner/from field and in your transcript section.

Unreviewed members: ${JSON.stringify(unreviewed)} — an unreviewed member cannot win unless you checked its approach against the repo yourself.
Submissions: ${JSON.stringify(subs.map(({ model, ...s }) => s), null, 1)}
Reviews: ${JSON.stringify(reviews, null, 1)}
Rebuttals: ${JSON.stringify(rebuttals, null, 1)}
${appendRule(`## Verdict\n<eliminated + why, ranking, winner, grafts, or FLAWED + reasons>`)}`

const degraded = []
phase('Design')
const results = await parallel(roster.map((m, i) => () =>
  agent(buildPrompt(i), { label: `design:${LABELS[i]}`, phase: 'Design', model: m.model, effort: m.effort, schema: SUBMISSION })
    .then(s => s && { ...s, label: LABELS[i], model: m.model })
))
results.forEach((r, i) => { if (!r) degraded.push(`member ${LABELS[i]} died during design`) })
const built = results.filter(Boolean)
if (built.length < roster.length) log(`${roster.length - built.length} member(s) died during design`)

if (!built.length) {
  const reasons = ['every member died']
  phase('Verdict')
  await agent(scribePrompt(`## Verdict\nFLAWED — every member dead on arrival: ${reasons.join('; ')}`), { label: 'scribe', phase: 'Verdict', model: 'haiku', effort: 'low' })
  return { submissions: built, reviews: [], rebuttals: [], verdict: { flawed: true, reasons, eliminated: [], ranking: [], winner: '', grafts: [], models: Object.fromEntries(built.map(s => [s.label, s.model])), ...(degraded.length && { degraded }) }, transcript: A.transcript }
}

const alive = built

let reviews = [], rebuttals = []
if (alive.length > 1) {
  phase('Review')
  const rv = await parallel(alive.map(me => () => {
    const others = alive.filter(o => o.label !== me.label)
    return agent(reviewPrompt(me, others), { label: `review:${me.label}`, phase: 'Review', model: me.model, effort: 'high', schema: reviewSchema(others.map(o => o.label)) })
      .then(r => r && { by: me.label, ...r })
  }))
  rv.forEach((r, i) => { if (!r) degraded.push(`reviewer ${alive[i].label} died`) })
  reviews = rv.filter(Boolean)

  phase('Rebuttal')
  rebuttals = await parallel(alive.map(me => () => {
    const ofMe = reviews.flatMap(r => r.reviews.filter(x => x.of === me.label).map(x => ({ by: r.by, ...x })))
    if (!ofMe.some(x => x.bugs.length || x.workflowChallenges?.length)) return Promise.resolve({ label: me.label, responses: [] })
    return agent(rebuttalPrompt(me, ofMe), { label: `rebut:${me.label}`, phase: 'Rebuttal', model: me.model, effort: 'high', schema: REBUTTAL })
      .then(r => r ? { label: me.label, ...r } : { label: me.label, responses: [], died: true })
  }))
  rebuttals.forEach(r => { if (r.died) degraded.push(`rebuttal ${r.label} died`) })
} else {
  log('single survivor: skipping review and rebuttal')
}
const unreviewed = alive.filter(s => !reviews.some(r => r.reviews.some(x => x.of === s.label))).map(s => s.label)
if (unreviewed.length) { log(`unreviewed: ${unreviewed.join(', ')}`); degraded.push(`unreviewed: ${unreviewed.join(', ')}`) }

phase('Verdict')
let verdict = await agent(judgePrompt(alive, reviews, rebuttals, unreviewed), { label: 'judge', phase: 'Verdict', model: A.judge.model, effort: A.judge.effort, schema: verdictSchema(alive.map(s => s.label)) })
  || (degraded.push('judge'), { flawed: true, reasons: ['judge died'], eliminated: [], ranking: [], winner: '', grafts: [] })
if (!verdict.flawed && !verdict.winner) verdict = { ...verdict, flawed: true, reasons: [...verdict.reasons, 'judge returned no winner'] }
const eliminatedSeen = new Set()
verdict.eliminated = verdict.eliminated.filter(e => (eliminatedSeen.has(e.label) ? false : (eliminatedSeen.add(e.label), true)))
if (!verdict.flawed && verdict.eliminated.some(e => e.label === verdict.winner)) verdict = { ...verdict, flawed: true, reasons: [...verdict.reasons, 'judge named an eliminated member as winner'] }
verdict.models = Object.fromEntries(built.map(s => [s.label, s.model]))
if (degraded.length) verdict.degraded = degraded
await agent(scribePrompt(`Models: ${Object.entries(verdict.models).map(([l, m]) => `${l}=${m}`).join(', ')}`), { label: 'scribe:models', phase: 'Verdict', model: 'haiku', effort: 'low' })
return { submissions: built, reviews, rebuttals, verdict, transcript: A.transcript }
