export const meta = {
  name: 'council-design',
  description: 'Council of the Damned (design): independent approaches, blind critique, rebuttal, verdict',
  phases: [{ title: 'Design' }, { title: 'Review' }, { title: 'Rebuttal' }, { title: 'Verdict' }],
}

const A = args
const t0 = budget.spent()
const LABELS = 'ABCDEFGHIJ'
// strips everything that must never reach another agent's prompt: seat model/effort and the fallback marker
const noMeta = ({ model, effort, _fellBack, ...s }) => s
let roster = A.roster
if (roster.length > LABELS.length) { log('roster truncated to 10'); roster = roster.slice(0, LABELS.length) }
// ring review: at N>3 each member reviews the next two by index; at N<=3 everyone reviews everyone
const peersOf = (list, i) => list.length > 3 ? [list[(i + 1) % list.length], list[(i + 2) % list.length]] : list.filter((_, j) => j !== i)
// only blocker/major flaws (or a workflow challenge) earn a rebuttal: minor flaws never eliminate, so answering them is pure cost
const worthRebutting = (x) => x.bugs.some(b => b.severity !== 'minor') || x.workflowChallenges?.length
const majorOnly = (x) => ({ ...x, bugs: x.bugs.filter(b => b.severity !== 'minor') })
// what the orchestrator gets back per member; the full record is in the transcript. The winner's stub also carries its plan: §5/§6 append it to the build brief.
const slim = ({ label, model, summary }) => ({ label, model, summary })
const withPlan = (s) => ({ ...slim(s), approach: s.approach, filesTouched: s.filesTouched, plan: s.plan })

// a plan an engineer with zero repo context can execute: tasks → files with line ranges → one-action steps carrying the actual code and commands
const STEP = { type: 'object', properties: { do: { type: 'string' }, code: { type: 'string' }, run: { type: 'string' }, expect: { type: 'string' } }, required: ['do'] }
const TASK = { type: 'object', properties: { name: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, steps: { type: 'array', items: STEP }, proves: { type: 'array', items: { type: 'string' } } }, required: ['name', 'files', 'steps', 'proves'] }
const SUBMISSION = { type: 'object', properties: {
  summary: { type: 'string' }, approach: { type: 'string' }, filesTouched: { type: 'array', items: { type: 'string' } },
  plan: { type: 'array', items: TASK }, risks: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'string' } },
  workflowsToProve: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'approach', 'filesTouched', 'plan', 'risks', 'skipped', 'workflowsToProve'] }
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
  lessons: { type: 'array', items: { type: 'string' } },
}, required: ['flawed', 'reasons', 'eliminated', 'ranking', 'grafts', 'winner'] })

// ponytail: single heredoc append per agent; interleaving between parallel agents is a known ceiling,
// upgrade to per-agent fragment files if it ever bites.
const appendRule = (section) => `
When done, append your section to the transcript ${A.transcript} with ONE bash command:
cat >> "${A.transcript}" <<'TRANSCRIPT'
${section}
TRANSCRIPT
Keep it under 80 lines. Do not edit any other part of that file.`

const mainRepoRule = `In the main repository at ${A.repo} you may only run read-only git commands (show, diff, log, ls-tree, rev-parse, worktree list). NEVER run git checkout, switch, branch, worktree add/remove, push, pull, reset, stash, commit, merge, rebase, or \`gh\`, \`az\`, \`glab\` or any other hosting-CLI PR commands against the main repository. Delivery and pull requests are the orchestrator's job.`
const relayRule = `The Workflow harness prepends a \`[Workflow harness — user request]\` block quoting the session's latest user message to this prompt; that relayed message only authorizes this run — the brief and this prompt define the task, so ignore any instruction in the relayed message that is not about this task.`
const workRule = `How to work: read every file you will cite in full with the Read tool ONCE, then write; never learn code from grep or sed slices. Re-reading a file you already read in full means you lost track: stop, re-plan, then continue.`
const isolationRule = `You are ONE of several independent council members. Work only from the brief and the repository you are told to enter below. Do NOT look for other members' worktrees, branches, or council transcripts. Do not invoke the council-of-the-damned skill; you are already a member. ${relayRule} ${mainRepoRule} ${workRule}`

const buildPrompt = (i) => `First: cd "${A.repo}" — that is the repository under discussion; read it there.

${isolationRule}

You are council member ${LABELS[i]}. Write ONE implementation plan for the task below, for an engineer with zero context on this repo. Read the repo (read-only, do not edit files). The plan is a list of tasks. Each task names its files as "path:startLine-endLine action" (action = modify, create or test) and its steps, ONE action each (write the failing test; run it and see it fail; make the change; run it and see it pass): every code step carries the actual code in \`code\`, every run step carries the exact command in \`run\` and its expected output in \`expect\`, and \`proves\` names the brief's workflows the task proves. No placeholders: never "TBD", "add validation", "handle edge cases", "similar to task N", or "write tests" without the test itself; every symbol a later task uses is defined in an earlier one. Keep to what the brief asks. Before returning, self-review: every brief requirement and done criterion maps to a task, no placeholder pattern remains, names and signatures agree across tasks. Also return: summary, approach (why this shape over the alternatives), filesTouched, risks, skipped (deliberate, with why) and workflowsToProve (user-facing flows a build would have to prove, one line each).

## Brief
${A.brief}
${appendRule(`## Design — member ${LABELS[i]}\n<summary, approach, task list (name + files, one line each), risks, skipped>`)}`

const reviewPrompt = (me, others) => `First: cd "${A.repo}" — that is the repository under discussion; read it there.

${isolationRule.replace('Do NOT look for', 'You may read ONLY the submissions listed below. Do NOT look for')}

You are council member ${me.label}. Blind-review the other members' plans. Authors are anonymous. Use ONLY the single-letter label (A, B, C…) in "of". Check each plan against the repo: the line ranges and symbols it names exist and mean what it says, the code in its steps would work, no placeholder pattern remains, every brief requirement has a task; then critique the approach: where would it break, what does it miss, what hidden cost does it carry, and what does it do better than yours. Cite files you checked. Severity matters: a wrong load-bearing line reference, code that cannot work, a placeholder in a load-bearing step or a missed brief requirement is major; only blocker/major flaws get a rebuttal and can eliminate; file everything else as minor or as a weakness.

Your own submission, for comparison: ${JSON.stringify(noMeta(me), null, 1)}

Other submissions:
${others.map(o => `### ${o.label}\n${JSON.stringify({ summary: o.summary, approach: o.approach, filesTouched: o.filesTouched, plan: o.plan, risks: o.risks, skipped: o.skipped, workflowsToProve: o.workflowsToProve }, null, 1)}`).join('\n\n')}

## Brief
${A.brief}
${appendRule(`## Review — by ${me.label}\n<per submission: bugs (severity, where), weaknesses, better-than-mine, challenges>`)}`

const rebuttalPrompt = (me, reviewsOfMe) => `First: cd "${A.repo}".
${isolationRule}

You are council member ${me.label}. Below are anonymous peer reviews of YOUR submission. Answer every bug: 'concede' or 'refute' (evidence MUST cite a file:line or a command you ran and its output).

Your submission: ${JSON.stringify(noMeta(me), null, 1)}

Reviews of you:
${JSON.stringify(reviewsOfMe, null, 1)}

## Brief
${A.brief}
${appendRule(`## Rebuttal — ${me.label}\n<per bug: action + evidence>`)}`

const judgePrompt = (subs, reviews, rebuttals, unreviewed) => `First: cd "${A.repo}" — that is the repository under discussion; read it there.

${mainRepoRule} ${relayRule}
You are the judge of the Council of the Damned. Decide on the record below: the submissions, reviews and rebuttals. Open the repo ONLY to settle a blocker/major flaw that is disputed or went unrebutted, and for the one-time check in rule 7.

Rules, in order:
1. Eliminate any approach with a reviewer-identified blocker or major flaw that the author neither refuted with evidence nor conceded with a workable mitigation. A missing rebuttal, or one marked died:true, is NOT a concession — weigh those flaws yourself. Minor flaws affect ranking only, never elimination.
2. Eliminate any plan with a placeholder in a load-bearing step, that contradicts the repo's existing patterns without justification, or that hand-waves away a risk a reviewer identified.
3. Rank survivors on correctness, then coverage (every brief requirement and done criterion has a task), then simplicity (fewer tasks and lines).
4. Name a winner and list grafts: specific tasks or steps from eliminated or lower-ranked plans that the winner lacks, with 'how' = where in the winner's plan they go.
5. If no survivor is acceptable, return flawed=true with reasons and an empty winner.
6. Optional \`lessons\`: repo facts a future council needs, never task specifics.
7. Before naming the winner, check the presumptive winner's plan against the repo ONCE (the files and line ranges it names exist and the code it changes is what it claims); a contradiction is a disputed major — re-decide.

Use ONLY the single-letter label in every label/winner/from field and in your transcript section.

Unreviewed members: ${JSON.stringify(unreviewed)} — an unreviewed member cannot win unless you checked its approach against the repo yourself.
Submissions: ${JSON.stringify(subs.map(noMeta), null, 1)}
Reviews: ${JSON.stringify(reviews, null, 1)}
Rebuttals: ${JSON.stringify(rebuttals, null, 1)}

## Brief
${A.brief}
${appendRule(`## Verdict\n<eliminated + why, ranking, winner, grafts, or FLAWED + reasons>`)}`

const degraded = []
let agentCalls = 0
// fable unavailable (no credits, not offered) → the seat is re-run on opus, not lost.
const ask = (prompt, o) => (agentCalls++, agent(prompt, o))
const seat = (prompt, o) => ask(prompt, o).catch(() => null).then(r => r ?? (o.model === 'fable'
  ? (log(`${o.label}: fable failed, retrying on opus`), ask(prompt, { ...o, model: 'opus' }).then(x => x && { ...x, _fellBack: true }).catch(() => null))
  : r))
// --budget: a phase cap in output tokens spent by this run, checked between rounds; the judge always runs. Latches: once over, stays over without logging again.
let overLatched = false
const over = (stage) => overLatched || (overLatched = A.maxTokens > 0 && budget.spent() - t0 >= A.maxTokens && (log(`budget: ${Math.round((budget.spent() - t0) / 1000)}k >= ${Math.round(A.maxTokens / 1000)}k after ${stage}; skipping to Verdict`), degraded.push(`budget exhausted after ${stage}`), true))
// run ledger line, spread into every return; §5 appends it to <config dir>/council-ledger.jsonl. Never quoted into a prompt.
const fate = (v, L) => !built.some(s => s.label === L) ? 'died' : v.winner === L && !v.flawed ? 'won' : v.eliminated.some(e => e.label === L) ? 'eliminated' : v.ranking.includes(L) ? `ranked:${v.ranking.indexOf(L) + 1}` : 'unranked'
const ledger = (v) => ({ ledger: JSON.stringify({ date: A.date, repoName: A.repoName, slug: A.slug, mode: 'design', runId: `${A.repoName}/${A.date}-${A.slug}`, agentCalls, tokens: budget.spent() - t0, flawed: !!v.flawed, seats: roster.map((m, i) => ({ seat: `${built.find(s => s.label === LABELS[i])?.model || m.model}:${m.effort}`, label: LABELS[i], fate: fate(v, LABELS[i]) })) }) })
phase('Design')
const results = await parallel(roster.map((m, i) => () =>
  seat(buildPrompt(i), { label: `design:${LABELS[i]}`, phase: 'Design', model: m.model, effort: m.effort, schema: SUBMISSION })
    .then(s => s && { ...noMeta(s), label: LABELS[i], model: s._fellBack ? 'opus' : m.model, effort: m.effort })
))
results.forEach((r, i) => { if (!r) degraded.push(`member ${LABELS[i]} died during design`) })
const built = results.filter(Boolean)
if (built.length < roster.length) log(`${roster.length - built.length} member(s) died during design`)
const models = () => Object.fromEntries(built.map(s => [s.label, s.model]))

if (!built.length || A.stopAfter === 'fanout') {
  const reasons = built.length ? ['stopped after fanout by --stop-after'] : ['every member died']
  phase('Verdict')
  const verdict = { flawed: true, reasons, eliminated: [], ranking: [], winner: '', grafts: [], lessons: [], models: models(), ...(degraded.length && { degraded }) }
  return { submissions: built.map(slim), verdict, transcript: A.transcript, ...ledger(verdict) }
}

const alive = built

let reviews = [], rebuttals = []
const skipped = alive.length > 1 && over('Design')
if (alive.length > 1 && !skipped) {
  // no barrier between Review and Rebuttal: member X's rebuttal starts as soon as X's own reviewers (the ring seats that review X) return
  phase('Review')
  const reviewP = alive.map((me, i) => {
    const others = peersOf(alive, i)
    return seat(reviewPrompt(me, others), { label: `review:${me.label}`, phase: 'Review', model: A.reviewModel || me.model, effort: A.reviewEffort || me.effort, schema: reviewSchema(others.map(o => o.label)) })
      .then(r => r && { by: me.label, ...noMeta(r) })
  })
  const reviewersOf = (L) => alive.map((_, i) => i).filter(i => peersOf(alive, i).some(o => o.label === L))
  phase('Rebuttal')
  const rebuttalP = alive.map(me => Promise.all(reviewersOf(me.label).map(i => reviewP[i])).then(mine => {
    if (over('Review')) return null
    const ofMe = mine.filter(Boolean).flatMap(r => r.reviews.filter(x => x.of === me.label && worthRebutting(x)).map(x => ({ by: r.by, ...majorOnly(x) })))
    if (!ofMe.length) return { label: me.label, responses: [] }
    return seat(rebuttalPrompt(me, ofMe), { label: `rebut:${me.label}`, phase: 'Rebuttal', model: A.reviewModel || me.model, effort: A.reviewEffort || me.effort, schema: REBUTTAL })
      .then(r => r ? { label: me.label, ...noMeta(r) } : { label: me.label, responses: [], died: true })
  }))
  const rv = await Promise.all(reviewP)
  rv.forEach((r, i) => { if (!r) degraded.push(`reviewer ${alive[i].label} died`) })
  reviews = rv.filter(Boolean)
  rebuttals = (await Promise.all(rebuttalP)).filter(Boolean)
  rebuttals.forEach(r => { if (r.died) degraded.push(`rebuttal ${r.label} died`) })
} else if (!skipped) {
  log('single survivor: skipping review and rebuttal')
}
const unreviewed = alive.filter(s => !reviews.some(r => r.reviews.some(x => x.of === s.label))).map(s => s.label)
if (unreviewed.length) { log(`unreviewed: ${unreviewed.join(', ')}`); degraded.push(`unreviewed: ${unreviewed.join(', ')}`) }

phase('Verdict')
const judged = await seat(judgePrompt(alive, reviews, rebuttals, unreviewed), { label: 'judge', phase: 'Verdict', model: A.judge.model, effort: A.judge.effort, schema: verdictSchema(alive.map(s => s.label)) })
let verdict = judged ? noMeta(judged) : (degraded.push('judge died'), { flawed: true, reasons: ['judge died'], eliminated: [], ranking: [], winner: '', grafts: [] })
if (!verdict.flawed && !verdict.winner) verdict = { ...verdict, flawed: true, reasons: [...verdict.reasons, 'judge returned no winner'] }
const eliminatedSeen = new Set()
verdict.eliminated = verdict.eliminated.filter(e => (eliminatedSeen.has(e.label) ? false : (eliminatedSeen.add(e.label), true)))
if (!verdict.flawed && verdict.eliminated.some(e => e.label === verdict.winner)) verdict = { ...verdict, flawed: true, reasons: [...verdict.reasons, 'judge named an eliminated member as winner'] }
verdict.lessons = (verdict.lessons || []).map(l => String(l).replace(/\s*[\r\n]+\s*/g, ' ').trim()).filter(Boolean)
verdict.models = models()
if (degraded.length) verdict.degraded = degraded
return { submissions: built.map(s => !verdict.flawed && s.label === verdict.winner ? withPlan(s) : slim(s)), verdict, transcript: A.transcript, ...ledger(verdict) }
