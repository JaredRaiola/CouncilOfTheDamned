export const meta = {
  name: 'council-review',
  description: 'Council of the Damned (review): independent PR reviews + test plans, blind cross-check, judge merges verified findings',
  phases: [{ title: 'Review' }, { title: 'Cross-check' }, { title: 'Verdict' }],
}

const A = args
const LABELS = 'ABCDEFGHIJ'
let roster = A.roster
if (roster.length > LABELS.length) { log('roster truncated to 10'); roster = roster.slice(0, LABELS.length) }

const FINDING = { type: 'object', properties: {
  id: { type: 'string' }, title: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' },
  severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, scenario: { type: 'string' },
}, required: ['id', 'title', 'file', 'severity', 'scenario'] }
const STEP = { type: 'object', properties: { area: { type: 'string' }, steps: { type: 'string' }, expect: { type: 'string' } }, required: ['area', 'steps', 'expect'] }
const REVIEW = { type: 'object', properties: {
  findings: { type: 'array', items: FINDING }, testPlan: { type: 'array', items: STEP },
}, required: ['findings', 'testPlan'] }
const CHECK = { type: 'object', properties: { checks: { type: 'array', items: { type: 'object', properties: {
  finding: { type: 'string' }, action: { type: 'string', enum: ['confirm', 'refute'] }, evidence: { type: 'string' },
}, required: ['finding', 'action', 'evidence'] } }, testPlanGaps: { type: 'array', items: STEP } }, required: ['checks', 'testPlanGaps'] }
const VERDICT = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, scenario: { type: 'string' },
    confirmedBy: { type: 'array', items: { type: 'string' } },
  }, required: ['title', 'file', 'severity', 'scenario', 'confirmedBy'] } },
  dropped: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, why: { type: 'string' } }, required: ['title', 'why'] } },
  testPlan: { type: 'array', items: STEP },
}, required: ['findings', 'dropped', 'testPlan'] }

const appendRule = (section) => `
When done, append your section to the transcript ${A.transcript} with ONE bash command:
cat >> "${A.transcript}" <<'TRANSCRIPT'
${section}
TRANSCRIPT
Keep it under 80 lines. Do not edit any other part of that file.`

const readOnly = `Work in the checkout at ${A.repo} (read-only: never edit files, never run git checkout/switch/reset/commit/push, never post to GitHub, Azure DevOps, or any issue tracker). You may run the typecheck or single test files there; do not run the full suite. Do not invoke the council-of-the-damned skill; you are already a member. Do not look for other members' output or the council transcript beyond what you are given.`

const reviewPrompt = (i) => `First: cd "${A.repo}".

${readOnly}

You are council member ${LABELS[i]}, one of several independent reviewers. Review the change described in the brief for correctness bugs, security/authorization gaps, data-integrity problems, and missed business rules. Trace each suspicion through the real code before reporting it — every finding needs a concrete failure scenario (inputs/state → wrong outcome). No style nits. Give each finding a short unique id prefixed ${LABELS[i]} (e.g. ${LABELS[i]}1).

Also write a manual test plan a human will run: grouped by area, each item = steps + expected result, covering the happy paths, the edge cases your findings suggest, and regressions in flows the change touches indirectly.

## Brief
${A.brief}
${appendRule(`## Review — member ${LABELS[i]}\n<findings (id, severity, file:line, scenario); test plan areas>`)}`

const checkPrompt = (me, others) => `First: cd "${A.repo}".

${readOnly}

You are council member ${me.label}. Below are other reviewers' findings on the same change (anonymous). For EACH finding decide 'confirm' or 'refute' by reading the code yourself; evidence must cite file:line (or a command you ran and its output). Refute anything that is wrong, already handled elsewhere, or has no real failure scenario. Then list testPlanGaps: test-plan items missing from ALL plans, yours included.

Your own review, for comparison: ${JSON.stringify(me.findings, null, 1)}

Others' findings:
${others.map(o => `### ${o.label}\n${JSON.stringify(o.findings, null, 1)}`).join('\n\n')}

Others' test plans:
${others.map(o => `### ${o.label}\n${JSON.stringify(o.testPlan, null, 1)}`).join('\n\n')}

## Brief
${A.brief}
${appendRule(`## Cross-check — by ${me.label}\n<per finding id: confirm/refute + evidence; test plan gaps>`)}`

const judgePrompt = (reviews, checks) => `First: cd "${A.repo}".

${readOnly}

You are the judge of the Council of the Damned, review mode. Produce the final review.

Rules:
1. A finding survives if at least one OTHER member confirmed it and nobody refuted it with file:line evidence you verify. If confirmed and refuted, or unchecked, read the code yourself and decide.
2. Merge duplicates (same root cause) into one; confirmedBy lists every member that raised or confirmed it.
3. Severity is yours to set: blocker = data loss, security, money, or a broken core flow; major = a real user-visible bug; minor = everything else that is still a real defect.
4. Every drop goes in 'dropped' with a one-line why.
5. testPlan = one merged, de-duplicated manual test plan from all plans and gaps, ordered by area, each step concrete (which user, which page, what to enter) with an expected result. Include a test for every surviving finding.

Reviews: ${JSON.stringify(reviews, null, 1)}
Cross-checks: ${JSON.stringify(checks, null, 1)}

## Brief
${A.brief}
${appendRule(`## Verdict\n<surviving findings most-severe first, dropped + why, test plan outline>`)}`

const degraded = []
// fable unavailable (no credits, not offered) → the seat is re-run on opus, not lost.
const seat = (prompt, o) => agent(prompt, o).catch(() => null).then(r => r ?? (o.model === 'fable'
  ? (log(`${o.label}: fable failed, retrying on opus`), agent(prompt, { ...o, model: 'opus' }).then(x => x && { ...x, _fellBack: true }))
  : r))
phase('Review')
const rv = await parallel(roster.map((m, i) => () =>
  seat(reviewPrompt(i), { label: `review:${LABELS[i]}`, phase: 'Review', model: m.model, effort: m.effort, schema: REVIEW })
    .then(r => r && { ...r, label: LABELS[i], model: r._fellBack ? 'opus' : m.model })
))
rv.forEach((r, i) => { if (!r) degraded.push(`member ${LABELS[i]} died during review`) })
const reviews = rv.filter(Boolean)
if (!reviews.length) return { reviews, checks: [], verdict: { findings: [], dropped: [], testPlan: [], degraded: [...degraded, 'every member died'] }, transcript: A.transcript }

let checks = []
if (reviews.length > 1) {
  phase('Cross-check')
  const ck = await parallel(reviews.map(me => () =>
    seat(checkPrompt(me, reviews.filter(o => o.label !== me.label)), { label: `check:${me.label}`, phase: 'Cross-check', model: me.model, effort: 'high', schema: CHECK })
      .then(c => c && { by: me.label, ...c })
  ))
  ck.forEach((c, i) => { if (!c) degraded.push(`cross-checker ${reviews[i].label} died`) })
  checks = ck.filter(Boolean)
} else log('single reviewer: skipping cross-check')

phase('Verdict')
const verdict = await seat(judgePrompt(reviews.map(({ model, ...r }) => r), checks), { label: 'judge', phase: 'Verdict', model: A.judge.model, effort: A.judge.effort, schema: VERDICT })
  || (degraded.push('judge died'), { findings: [], dropped: [], testPlan: [] })
verdict.models = Object.fromEntries(reviews.map(r => [r.label, r.model]))
if (degraded.length) verdict.degraded = degraded
return { reviews, checks, verdict, transcript: A.transcript }
