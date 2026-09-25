// Self-check for the workflow scripts: runs each council-*.js with fake agent/parallel/phase/log/pipeline and asserts on prompts.
import fs from 'node:fs'
import assert from 'node:assert/strict'

import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../..', import.meta.url)).replace(/[\\/]$/, '')
const W = (n) => `${root}/skills/cotd/workflows/council-${n}.js`
const BRIEF = '## Task\nBRIEF-MARKER-7f3a\n## Affected workflows\n1. x\n2. y'
const base = { brief: BRIEF, repo: 'C:\\r\\repo', repoName: 'repo', base: 'abc123', briefWorkflowCount: 2, depDir: 'node_modules', evidenceNotes: 'unit', judge: { model: 'fable', effort: 'max' }, minExamplesPerWorkflow: 2, minWorkflows: 3, rebuttalFix: true, keepWorktrees: false, transcript: 'C:/t/t.md', date: '2026-09-25', slug: 'my-slug' }
const roster = (n, model = 'sonnet', effort = 'high') => Array.from({ length: n }, () => ({ model, effort }))
const ex = (k) => Array.from({ length: k }, (_, i) => ({ input: `i${i}`, expected: 'e', observed: 'o', proof: 'ran' }))
const sub = (k = 3) => ({ summary: 's', workflows: [{ name: 'w', affected: true, examples: ex(k) }], testCommand: 'npm t', testOutput: 'ok', risks: [], skipped: [], specFiles: ['a.spec.js'], brokenCopyResult: 'RED' })
const design = () => ({ summary: 's', approach: 'a', filesTouched: [], risks: [], skipped: [], workflowsToProve: [] })
const rev = (labels) => ({ reviews: labels.map(of => ({ of, bugs: [{ desc: 'b', repro: 'r', severity: 'minor' }], weaknesses: [], betterThanMine: 'x' })) })
const rvw = (L) => ({ findings: [{ id: `${L}1`, title: 't', file: 'f', severity: 'minor', scenario: 's' }], testPlan: [] })

async function run(name, args, plan = {}) {
  const calls = []; const logs = []; const phases = []
  const agent = async (prompt, o) => {
    calls.push({ prompt, o })
    const r = plan.reply ? plan.reply(prompt, o, calls) : undefined
    if (r === 'THROW') throw new Error('fable unavailable')
    return r
  }
  const parallel = (fns) => Promise.all(fns.map(f => f()))
  const src = fs.readFileSync(W(name), 'utf8').replace(/^export /m, '')
  const fn = new (async () => {}).constructor('args', 'agent', 'parallel', 'phase', 'log', 'pipeline', src)
  const out = await fn(args, agent, parallel, (p) => phases.push(p), (l) => logs.push(l), () => { throw new Error('pipeline unused') })
  return { out, calls, logs, phases }
}
const byLabel = (calls, prefix) => calls.filter(c => c.o.label.startsWith(prefix))
const enumOf = (c) => c.o.schema.properties.reviews.items.properties.of.enum

// --- generic reply for build/test/design ---
const replyFor = (kind, opts = {}) => (prompt, o, calls) => {
  const L = o.label.split(':')[1]
  if (opts.throwFable && o.model === 'fable' && !calls.some(c => c !== calls.at(-1) && c.o.label === o.label)) return 'THROW'
  if (opts.throwOpus && o.model === 'opus') return 'THROW'
  if (opts.dieLabels?.includes(o.label)) return null
  if (o.label.startsWith('build:') || o.label.startsWith('write:')) return sub(opts.examples?.[L] ?? 3)
  if (o.label.startsWith('design:')) return design()
  if (o.label.startsWith('review:')) return rev(enumOf(calls.at(-1)))
  if (o.label.startsWith('rebut:')) return { responses: [{ bug: 'b', action: 'refute', evidence: 'f:1' }] }
  if (o.label === 'judge') return opts.judgeDies ? null : { flawed: false, reasons: [], eliminated: [], ranking: ['A'], winner: 'A', grafts: [] }
  throw new Error(`unexpected agent label ${o.label}`)
}

let n = 0
const ok = (msg) => console.log(`ok ${++n} - ${msg}`)

for (const kind of ['build', 'test', 'design']) {
  const memberPrefix = { build: 'build:', test: 'write:', design: 'design:' }[kind]
  // 1. N=3 happy path: brief in every round, full review, no scribe, models recorded
  {
    const { out, calls, logs } = await run(kind, { ...base, roster: roster(3) }, { reply: replyFor(kind) })
    assert.equal(out.verdict.winner, 'A'); assert.equal(out.verdict.flawed, false)
    for (const c of calls) assert.ok(c.prompt.includes('## Brief\n' + BRIEF), `${kind}: brief missing in ${c.o.label}`)
    assert.ok(byLabel(calls, 'review:').length === 3 && byLabel(calls, 'rebut:').length === 3 && byLabel(calls, 'judge').length === 1)
    assert.ok(!calls.some(c => c.o.label.startsWith('scribe')), 'no scribe call')
    for (const c of byLabel(calls, 'review:')) assert.equal(enumOf(c).length, 2, 'full review at N=3')
    assert.deepEqual(out.verdict.models, { A: 'sonnet', B: 'sonnet', C: 'sonnet' })
    assert.ok(!calls.some(c => c.o.label === 'judge' && /sonnet|fable|opus|_fellBack|"effort"/.test(c.prompt)), 'judge prompt is blind')
    ok(`${kind} N=3: brief in ${calls.length} prompts, full review (2 peers each), no scribe, winner A, models=${JSON.stringify(out.verdict.models)}`)
  }
  // 2. N=5 ring review: reviewer i sees (i+1, i+2)
  {
    const { calls } = await run(kind, { ...base, roster: roster(5) }, { reply: replyFor(kind) })
    const ring = byLabel(calls, 'review:').map(c => `${c.o.label.split(':')[1]}->${enumOf(c).join('')}`)
    assert.deepEqual(ring, ['A->BC', 'B->CD', 'C->DE', 'D->EA', 'E->AB'])
    ok(`${kind} N=5 ring: ${ring.join(' ')}`)
  }
  // 2b. N=4 ring boundary; ring runs over survivors when a member died
  {
    const { calls } = await run(kind, { ...base, roster: roster(4) }, { reply: replyFor(kind) })
    const ring = byLabel(calls, 'review:').map(c => `${c.o.label.split(':')[1]}->${enumOf(c).join('')}`)
    assert.deepEqual(ring, ['A->BC', 'B->CD', 'C->DA', 'D->AB'])
    ok(`${kind} N=4 ring: ${ring.join(' ')}`)
  }
  {
    const { calls } = await run(kind, { ...base, roster: roster(5) }, { reply: replyFor(kind, { dieLabels: [memberPrefix + 'C'] }) })
    const ring = byLabel(calls, 'review:').map(c => `${c.o.label.split(':')[1]}->${enumOf(c).join('')}`)
    assert.deepEqual(ring, ['A->BD', 'B->DE', 'D->EA', 'E->AB'])
    ok(`${kind} N=5 with C dead: ring over survivors ${ring.join(' ')}`)
  }
  // 3. fable seat fails → retried on opus; models says opus; effort honored; no fallback marker leaks
  {
    const { out, calls, logs } = await run(kind, { ...base, roster: [{ model: 'fable', effort: 'medium' }, { model: 'sonnet', effort: 'low' }] }, { reply: replyFor(kind, { throwFable: true }) })
    const a = byLabel(calls, memberPrefix + 'A').map(c => c.o.model)
    assert.deepEqual(a, ['fable', 'opus'])
    assert.deepEqual(out.verdict.models, { A: 'opus', B: 'sonnet' })
    assert.ok(logs.some(l => l.includes('fable failed, retrying on opus')))
    const rA = byLabel(calls, 'review:A'); assert.equal(rA.length, 1); assert.equal(rA[0].o.model, 'opus'); assert.equal(rA[0].o.effort, 'medium')
    assert.equal(byLabel(calls, 'review:B')[0].o.effort, 'low')
    assert.ok(!calls.some(c => c.prompt.includes('_fellBack')), 'no _fellBack in prompts')
    assert.deepEqual(byLabel(calls, 'judge').map(c => c.o.model), ['fable', 'opus'])
    ok(`${kind} fable retry: member A models=${a.join('->')}, judge=${byLabel(calls, 'judge').map(c => c.o.model).join('->')}, review efforts A=medium B=low, models=${JSON.stringify(out.verdict.models)}`)
  }
  // 3b. fable AND the opus retry both throw → the seat is dead, the workflow is not
  {
    const { out, calls } = await run(kind, { ...base, roster: [{ model: 'fable', effort: 'medium' }, { model: 'sonnet', effort: 'low' }] }, { reply: replyFor(kind, { throwFable: true, throwOpus: true }) })
    assert.deepEqual(byLabel(calls, memberPrefix + 'A').map(c => c.o.model), ['fable', 'opus']); assert.deepEqual(byLabel(calls, 'judge').map(c => c.o.model), ['fable', 'opus'])
    assert.ok(out.verdict.degraded.includes('member A died during ' + { build: 'build', test: 'write', design: 'design' }[kind]) && out.verdict.degraded.includes('judge died'))
    assert.equal(out.verdict.flawed, true); assert.deepEqual(out.verdict.models, { B: 'sonnet' })
    ok(`${kind} fable+opus both throw: no crash, degraded=${JSON.stringify(out.verdict.degraded)}`)
  }
  // 4. judge dies → 'judge died' degraded, flawed, no scribe
  {
    const { out, calls } = await run(kind, { ...base, roster: roster(2) }, { reply: replyFor(kind, { judgeDies: true }) })
    assert.equal(out.verdict.flawed, true); assert.deepEqual(out.verdict.reasons, ['judge died']); assert.deepEqual(out.verdict.degraded, ['judge died'])
    assert.ok(!calls.some(c => c.o.label.startsWith('scribe')))
    ok(`${kind} judge died: flawed=${out.verdict.flawed} degraded=${JSON.stringify(out.verdict.degraded)} models=${JSON.stringify(out.verdict.models)}`)
  }
  // 5. every member dies → flawed without any further agent call
  {
    const { out, calls } = await run(kind, { ...base, roster: roster(2) }, { reply: replyFor(kind, { dieLabels: [memberPrefix + 'A', memberPrefix + 'B'] }) })
    assert.equal(out.verdict.flawed, true); assert.deepEqual(out.verdict.reasons, ['every member died']); assert.equal(calls.length, 2)
    assert.deepEqual(out.verdict.degraded, ['member A died during ' + { build: 'build', test: 'write', design: 'design' }[kind], 'member B died during ' + { build: 'build', test: 'write', design: 'design' }[kind]])
    ok(`${kind} all died: flawed, ${calls.length} agent calls total (no scribe), degraded=${JSON.stringify(out.verdict.degraded)}`)
  }
  // 6. prompt rules: worktree pre-exists, no worktree add allowance, relay sentence, brief in judge
  {
    const { calls } = await run(kind, { ...base, roster: roster(2) }, { reply: replyFor(kind) })
    const m = byLabel(calls, memberPrefix + 'A')[0].prompt
    assert.ok(!/worktree add \.\.\./.test(m) && !/plus the single/.test(m), 'no worktree-add allowance')
    assert.ok(m.includes('worktree add/remove'))
    assert.ok(m.includes('[Workflow harness — user request]') && m.includes('only authorizes this run'))
    assert.ok(byLabel(calls, 'judge')[0].prompt.includes('only authorizes this run'), 'judge gets the relay rule')
    assert.ok(byLabel(calls, 'judge')[0].prompt.includes('only authorizes this run'), 'judge gets the relay rule')
    if (kind !== 'design') { assert.ok(m.includes('already exists') && m.includes('council-wt-my-slug-A') && !m.includes('mklink //J')); assert.ok(!/git -C "C:\\r\\repo" worktree add/.test(m)) }
    if (kind === 'test') { const r = byLabel(calls, 'review:A')[0].prompt; assert.ok(r.includes('council-wt-my-slug-A-scratch') && r.includes('checkout --force --detach') && !r.includes('worktree add "')) }
    for (const c of calls) assert.ok(!/\bscribe/i.test(c.prompt), 'no scribe mention in prompts')
    ok(`${kind} prompt rules: no worktree-add allowance, relay sentence in member+judge${kind !== 'design' ? ', worktree "already exists"' : ''}${kind === 'test' ? ', scratch via checkout --detach' : ''}`)
  }
  // 7. build/test: DOA under floor → flawed, eliminated lists dead
  if (kind !== 'design') {
    const { out, calls } = await run(kind, { ...base, roster: roster(2), minExamplesPerWorkflow: 5 }, { reply: replyFor(kind, { examples: { A: 1, B: 2 } }) })
    assert.equal(out.verdict.flawed, true); assert.deepEqual(out.verdict.reasons, ['every member under evidence floor'])
    assert.deepEqual(out.verdict.eliminated.map(e => e.label), ['A', 'B']); assert.equal(calls.length, 2)
    ok(`${kind} DOA: flawed, eliminated=${out.verdict.eliminated.map(e => e.label + ':' + e.reason).join('; ')}, ${calls.length} calls`)
  }
  // 8. single survivor at N=1 → no review/rebuttal, judge still runs with brief
  {
    const { out, calls, logs } = await run(kind, { ...base, roster: roster(1) }, { reply: replyFor(kind) })
    assert.ok(logs.includes('single survivor: skipping review and rebuttal')); assert.equal(byLabel(calls, 'review:').length, 0)
    assert.ok(byLabel(calls, 'judge')[0].prompt.includes(BRIEF)); assert.deepEqual(out.verdict.degraded, ['unreviewed: A'])
    ok(`${kind} N=1: review skipped, judge got brief, degraded=${JSON.stringify(out.verdict.degraded)}`)
  }
}

// --- review mode ---
const replyReview = (opts = {}) => (prompt, o, calls) => {
  const L = o.label.split(':')[1]
  if (opts.throwFable && o.model === 'fable' && !calls.some(c => c !== calls.at(-1) && c.o.label === o.label)) return 'THROW'
  if (opts.throwOpus && o.model === 'opus') return 'THROW'
  if (o.label.startsWith('review:')) return rvw(L)
  if (o.label.startsWith('check:')) return { checks: [{ finding: 'B1', action: 'confirm', evidence: 'f:1' }], testPlanGaps: [] }
  if (o.label === 'judge') return opts.judgeDies ? null : { findings: [], dropped: [], testPlan: [] }
  throw new Error(`unexpected agent label ${o.label}`)
}
{
  const { out, calls } = await run('review', { ...base, roster: roster(3) }, { reply: replyReview() })
  for (const c of calls) assert.ok(c.prompt.includes('## Brief\n' + BRIEF))
  const peers = byLabel(calls, 'check:').map(c => c.o.label.split(':')[1] + '->' + [...c.prompt.matchAll(/### ([A-J])\n/g)].map(m => m[1]).join(''))
  assert.deepEqual(peers, ['A->BCBC', 'B->ACAC', 'C->ABAB'])
  assert.ok(calls[0].prompt.includes('npm ci') && calls[0].prompt.includes('[Workflow harness — user request]'))
  assert.deepEqual(out.verdict.models, { A: 'sonnet', B: 'sonnet', C: 'sonnet' })
  ok(`review N=3: full cross-check (findings+plans sections) ${peers.join(' ')}, noPkgRule+relay in prompt, brief everywhere`)
}
{
  const { calls } = await run('review', { ...base, roster: roster(5) }, { reply: replyReview() })
  const peers = byLabel(calls, 'check:').map(c => c.o.label.split(':')[1] + '->' + [...c.prompt.matchAll(/### ([A-J])\n\[\n \{\n  "id"/g)].map(m => m[1]).join(''))
  assert.deepEqual(peers, ['A->BC', 'B->CD', 'C->DE', 'D->EA', 'E->AB'])
  ok(`review N=5 ring: ${peers.join(' ')}`)
}
{
  const { out, calls } = await run('review', { ...base, roster: [{ model: 'fable', effort: 'low' }, { model: 'opus', effort: 'high' }] }, { reply: replyReview({ throwFable: true }) })
  assert.deepEqual(byLabel(calls, 'review:A').map(c => c.o.model), ['fable', 'opus']); assert.deepEqual(out.verdict.models, { A: 'opus', B: 'opus' })
  assert.equal(byLabel(calls, 'check:A')[0].o.effort, 'low'); assert.ok(!calls.some(c => c.prompt.includes('_fellBack')))
  ok(`review fable retry: A fable->opus, check effort=low honored, models=${JSON.stringify(out.verdict.models)}`)
}
{
  const { out, calls } = await run('review', { ...base, roster: [{ model: 'fable', effort: 'low' }, { model: 'sonnet', effort: 'high' }] }, { reply: replyReview({ throwFable: true, throwOpus: true }) })
  assert.deepEqual(byLabel(calls, 'review:A').map(c => c.o.model), ['fable', 'opus'])
  assert.deepEqual(out.verdict.degraded, ['member A died during review', 'judge died']); assert.deepEqual(out.verdict.models, { B: 'sonnet' })
  assert.ok(byLabel(calls, 'judge')[0].prompt.includes('only authorizes this run'))
  ok(`review fable+opus both throw: no crash, degraded=${JSON.stringify(out.verdict.degraded)}, judge has relay rule`)
}
{
  const { out } = await run('review', { ...base, roster: roster(2) }, { reply: replyReview({ judgeDies: true }) })
  assert.deepEqual(out.verdict.degraded, ['judge died']); assert.deepEqual(out.verdict.findings, [])
  ok(`review judge died: degraded=${JSON.stringify(out.verdict.degraded)}`)
}
{
  const { out, calls } = await run('review', { ...base, roster: roster(1) }, { reply: replyReview() })
  assert.equal(byLabel(calls, 'check:').length, 0); assert.equal(out.verdict.degraded, undefined)
  ok(`review N=1: cross-check skipped, ${calls.length} calls`)
}
console.log(`${n} checks passed`)
