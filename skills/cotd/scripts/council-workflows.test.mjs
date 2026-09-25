// Self-check for the workflow scripts: runs each council-*.js with fake agent/parallel/phase/log/pipeline/budget and asserts on prompts and return values. Run: node council-workflows.test.mjs
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
  let spent = plan.startSpent ?? 0; const budget = { total: 0, spent: () => spent, remaining: () => Infinity }
  const agent = async (prompt, o) => {
    calls.push({ prompt, o }); spent += plan.tokensPerCall ?? 0
    const r = plan.reply ? plan.reply(prompt, o, calls) : undefined
    if (r === 'THROW') throw new Error('fable unavailable')
    return r
  }
  const parallel = (fns) => Promise.all(fns.map(f => f()))
  const src = fs.readFileSync(W(name), 'utf8').replace(/^export /m, '')
  const fn = new (async () => {}).constructor('args', 'agent', 'parallel', 'phase', 'log', 'pipeline', 'budget', src)
  const out = await fn(args, agent, parallel, (p) => phases.push(p), (l) => logs.push(l), () => { throw new Error('pipeline unused') }, budget)
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

// ===== round two: budget gate, --stop-after, lessons, reviewModel, ledger, audit scope, decide =====
const ledgerOf = (out) => JSON.parse(out.ledger)
const noLedgerInPrompts = (calls) => assert.ok(!calls.some(c => /agentCalls|council-ledger|"fate"/.test(c.prompt)), 'ledger data reached a prompt')
const verdictSchemaOf = (calls) => calls.find(c => c.o.label === 'judge').o.schema
const replyDecide = (opts = {}) => (prompt, o, calls) => {
  if (opts.dieLabels?.includes(o.label)) return null
  if (o.label.startsWith('decide:')) return { summary: 's', criteria: [{ name: 'cost', source: 'derived', why: 'w' }], scores: [{ option: 'P', criterion: 'cost', score: 4, why: 'y' }], ranking: ['P', 'Q'], rationale: 'r', risks: [], againstTopPick: 'x' }
  if (o.label.startsWith('review:')) return { reviews: enumOf(calls.at(-1)).map(of => ({ of, challenges: opts.noChallenges ? [] : [{ desc: 'score too high', option: 'P', severity: 'major' }], weaknesses: [], betterThanMine: 'x' })) }
  if (o.label.startsWith('rebut:')) return { responses: [{ challenge: 'score too high', action: 'refute', evidence: 'f:1' }] }
  if (o.label === 'judge') return opts.judgeDies ? null : { flawed: false, reasons: [], ranking: ['Q', 'P'], recommendation: opts.noRec ? '' : 'Q', confidence: 'medium', rationale: 'r', dissent: ['P is cheaper'], ...(opts.lessons && { lessons: opts.lessons }) }
  throw new Error(`unexpected agent label ${o.label}`)
}
const OPTS = ['P: postgres for everything', 'Q: sqlite per tenant']
const phaseOf = { build: 'Build', test: 'Write', design: 'Design' }

for (const kind of ['build', 'test', 'design']) {
  const memberPrefix = { build: 'build:', test: 'write:', design: 'design:' }[kind]
  // 9. budget over after fan-out: review+rebuttal skipped, degraded, judge still runs; spend before the run is not counted
  {
    const { out, calls, logs } = await run(kind, { ...base, roster: roster(3), maxTokens: 250000 }, { reply: replyFor(kind), tokensPerCall: 100000, startSpent: 5000000 })
    assert.equal(byLabel(calls, 'review:').length, 0); assert.equal(byLabel(calls, 'rebut:').length, 0); assert.equal(byLabel(calls, 'judge').length, 1)
    assert.ok(out.verdict.degraded.includes(`budget exhausted after ${phaseOf[kind]}`))
    const line = logs.find(l => l.startsWith('budget:')); assert.equal(line, `budget: 300k >= 250k after ${phaseOf[kind]}; skipping to Verdict`)
    ok(`${kind} budget 250k, 100k/call, 5M spent before start: "${line}", ${calls.length} calls (3 members + judge), degraded=${JSON.stringify(out.verdict.degraded)}`)
  }
  // 10. budget over only after Review: rebuttal skipped; cap 0 = off
  {
    const { out, calls, logs } = await run(kind, { ...base, roster: roster(3), maxTokens: 500000 }, { reply: replyFor(kind), tokensPerCall: 100000 })
    assert.equal(byLabel(calls, 'review:').length, 3); assert.equal(byLabel(calls, 'rebut:').length, 0); assert.equal(byLabel(calls, 'judge').length, 1)
    assert.ok(out.verdict.degraded.includes('budget exhausted after Review') && !out.verdict.degraded.includes(`budget exhausted after ${phaseOf[kind]}`))
    const off = await run(kind, { ...base, roster: roster(3), maxTokens: 0 }, { reply: replyFor(kind), tokensPerCall: 10000000 })
    assert.equal(byLabel(off.calls, 'rebut:').length, 3); assert.ok(!off.logs.some(l => l.startsWith('budget:'))); assert.equal(off.out.verdict.degraded, undefined)
    ok(`${kind} budget 500k: ${logs.find(l => l.startsWith('budget:'))}, rebuttals=0; maxTokens 0 at 10M/call: rebuttals=3, no budget log`)
  }
  // 11. --stop-after fanout: flawed with the reason, nothing after the members, ledger present
  {
    const { out, calls } = await run(kind, { ...base, roster: roster(3), stopAfter: 'fanout' }, { reply: replyFor(kind) })
    assert.equal(out.verdict.flawed, true); assert.deepEqual(out.verdict.reasons, ['stopped after fanout by --stop-after']); assert.equal(out.verdict.winner, '')
    assert.equal(calls.length, 3); assert.ok(calls.every(c => c.o.label.startsWith(memberPrefix)))
    const L = ledgerOf(out); assert.deepEqual(L.seats.map(s => s.fate), ['unranked', 'unranked', 'unranked']); assert.equal(L.flawed, true); assert.equal(L.agentCalls, 3)
    ok(`${kind} --stop-after fanout: flawed ${JSON.stringify(out.verdict.reasons)}, ${calls.length} calls, ledger fates ${L.seats.map(s => s.fate).join(',')}`)
  }
  // 12. lessons: optional in schema; absent -> []; present -> newlines collapsed, blanks dropped
  {
    const a = await run(kind, { ...base, roster: roster(2) }, { reply: replyFor(kind) })
    const sch = verdictSchemaOf(a.calls); assert.ok(sch.properties.lessons && !sch.required.includes('lessons'))
    assert.deepEqual(a.out.verdict.lessons, [])
    assert.ok(a.calls.find(c => c.o.label === 'judge').prompt.includes('repo facts a future council needs, never task specifics'))
    const withL = (p, o, c) => o.label === 'judge' ? { ...replyFor(kind)(p, o, c), lessons: ['tests need\n  `pnpm build` first', '   ', 'no CR in workflows'] } : replyFor(kind)(p, o, c)
    const b = await run(kind, { ...base, roster: roster(2) }, { reply: withL })
    assert.deepEqual(b.out.verdict.lessons, ['tests need `pnpm build` first', 'no CR in workflows'])
    ok(`${kind} lessons: optional in schema, absent -> [], present -> ${JSON.stringify(b.out.verdict.lessons)}, judge prompt has the lessons line`)
  }
  // 13. reviewModel: review + rebuttal use it; members and judge keep their seats
  {
    const { calls } = await run(kind, { ...base, roster: roster(3, 'opus'), reviewModel: 'haiku' }, { reply: replyFor(kind) })
    assert.ok(byLabel(calls, 'review:').every(c => c.o.model === 'haiku') && byLabel(calls, 'rebut:').every(c => c.o.model === 'haiku'))
    assert.ok(byLabel(calls, memberPrefix).every(c => c.o.model === 'opus') && byLabel(calls, 'judge')[0].o.model === 'fable')
    assert.ok(byLabel(calls, 'review:').every(c => c.o.effort === 'high')); assert.ok(!calls.some(c => c.prompt.includes('haiku')), 'reviewModel reached a prompt')
    const none = await run(kind, { ...base, roster: roster(2, 'opus') }, { reply: replyFor(kind) })
    assert.ok(byLabel(none.calls, 'review:').every(c => c.o.model === 'opus'))
    ok(`${kind} reviewModel haiku: review=${byLabel(calls, 'review:').map(c => c.o.model).join(',')} rebut=${byLabel(calls, 'rebut:').map(c => c.o.model).join(',')} members=opus judge=fable; unset -> reviews on opus`)
  }
  // 14. ledger on the final return: fates won / ranked:n / eliminated / doa / died, counts, tokens delta, never in prompts
  {
    const judge = { flawed: false, reasons: [], eliminated: [{ label: 'C', reason: 'bug' }], ranking: ['B', 'A'], winner: 'B', grafts: [] }
    const reply = (p, o, c) => o.label === 'judge' ? judge : replyFor(kind, { dieLabels: [memberPrefix + 'E'], examples: { D: 1 } })(p, o, c)
    const r = await run(kind, { ...base, roster: [...roster(4), { model: 'fable', effort: 'max' }] }, { reply, tokensPerCall: 1000, startSpent: 777 })
    const L = ledgerOf(r.out)
    const want = kind === 'design' ? ['ranked:2', 'won', 'eliminated', 'unranked', 'died'] : ['ranked:2', 'won', 'eliminated', 'doa', 'died']
    assert.deepEqual(L.seats.map(s => s.fate), want); assert.deepEqual(L.seats.map(s => s.seat), ['sonnet:high', 'sonnet:high', 'sonnet:high', 'sonnet:high', 'fable:max'])
    assert.equal(L.agentCalls, r.calls.length); assert.equal(L.tokens, r.calls.length * 1000); assert.equal(L.mode, kind === 'test' ? 'test' : kind)
    assert.equal(L.runId, 'repo/2026-09-25-my-slug'); assert.ok(r.out.ledger.includes('"repoName":"repo","slug":"my-slug",'))
    assert.ok(/"seat":"[^"]*","label":"[^"]*","fate":"[^"]*"/.test(r.out.ledger)); noLedgerInPrompts(r.calls)
    ok(`${kind} ledger: fates ${want.join(',')} (E died, fable seat), agentCalls=${L.agentCalls} (incl. opus retry), tokens=${L.tokens} (delta), mode=${L.mode}`)
  }
  // 15. ledger on the early "every member died" return
  {
    const { out } = await run(kind, { ...base, roster: roster(2) }, { reply: replyFor(kind, { dieLabels: [memberPrefix + 'A', memberPrefix + 'B'] }) })
    const L = ledgerOf(out); assert.deepEqual(L.seats.map(s => s.fate), ['died', 'died']); assert.equal(L.agentCalls, 2); assert.equal(L.flawed, true)
    ok(`${kind} early return (all died) carries ledger: ${out.ledger}`)
  }
}

// review: budget, reviewModel on cross-check, audit scope, ledger, lessons
{
  const { out, calls, logs } = await run('review', { ...base, roster: roster(3), maxTokens: 100000 }, { reply: replyReview(), tokensPerCall: 50000 })
  assert.equal(byLabel(calls, 'check:').length, 0); assert.equal(byLabel(calls, 'judge').length, 1)
  assert.deepEqual(out.verdict.degraded, ['budget exhausted after Review']); assert.ok(!logs.includes('single reviewer: skipping cross-check'))
  ok(`review budget 100k at 50k/call: ${logs.find(l => l.startsWith('budget:'))}, cross-check skipped, judge ran, degraded=${JSON.stringify(out.verdict.degraded)}`)
}
{
  const { out, calls } = await run('review', { ...base, roster: roster(3, 'opus'), reviewModel: 'sonnet', pr: true }, { reply: (p, o, c) => o.label === 'judge' ? { findings: [], dropped: [], testPlan: [], lessons: ['ci runs\nnode 20'] } : replyReview()(p, o, c) })
  assert.ok(byLabel(calls, 'check:').every(c => c.o.model === 'sonnet') && byLabel(calls, 'review:').every(c => c.o.model === 'opus'))
  assert.ok(byLabel(calls, 'review:')[0].prompt.includes('Review the change described in the brief'))
  assert.deepEqual(out.verdict.lessons, ['ci runs node 20']); const sch = verdictSchemaOf(calls); assert.ok(sch.properties.lessons && !sch.required.includes('lessons'))
  const L = ledgerOf(out); assert.equal(L.mode, 'review'); assert.deepEqual(L.seats.map(s => s.fate), ['unranked', 'unranked', 'unranked']); noLedgerInPrompts(calls)
  ok(`review pr=true: "Review the change", check model=sonnet (reviewModel), review model=opus, lessons=${JSON.stringify(out.verdict.lessons)}, ledger fates unranked x3`)
}
{
  const { out, calls } = await run('review', { ...base, roster: roster(2) }, { reply: replyReview() })
  assert.ok(byLabel(calls, 'review:').every(c => c.prompt.includes('Review the scope described in the brief')))
  assert.deepEqual(out.verdict.lessons, [])
  const died = await run('review', { ...base, roster: roster(2) }, { reply: (p, o) => null })
  const L = ledgerOf(died.out); assert.deepEqual(L.seats.map(s => s.fate), ['died', 'died'])
  assert.equal(ledgerOf(died.out).mode, 'audit')
  ok(`review audit (no pr): "Review the scope", ledger mode=audit; all-died early return ledger fates ${L.seats.map(s => s.fate).join(',')}`)
}

// decide mode end to end
{
  const { out, calls } = await run('decide', { ...base, roster: roster(3), options: OPTS }, { reply: replyDecide({ lessons: ['db\nis postgres 15'] }) })
  const m = byLabel(calls, 'decide:A')[0]
  assert.deepEqual(m.o.schema.properties.scores.items.properties.option.enum, ['P', 'Q']); assert.ok(m.o.schema.required.includes('againstTopPick'))
  assert.ok(m.prompt.includes('- P: postgres for everything') && m.prompt.includes('single strongest argument against your own top pick') && m.prompt.includes('## Brief\n' + BRIEF))
  const j = byLabel(calls, 'judge')[0]; assert.deepEqual(j.o.schema.properties.recommendation.enum, ['P', 'Q', '']); assert.deepEqual(j.o.schema.properties.confidence.enum, ['low', 'medium', 'high'])
  assert.ok(!j.o.schema.required.includes('lessons') && !/sonnet|fable|opus/.test(j.prompt))
  assert.equal(byLabel(calls, 'review:').length, 3); assert.equal(byLabel(calls, 'rebut:').length, 3)
  assert.equal(out.verdict.recommendation, 'Q'); assert.equal(out.verdict.flawed, false); assert.deepEqual(out.verdict.dissent, ['P is cheaper']); assert.deepEqual(out.verdict.lessons, ['db is postgres 15'])
  for (const c of calls) assert.ok(c.prompt.includes('## Brief\n' + BRIEF) && c.prompt.includes('only authorizes this run'))
  noLedgerInPrompts(calls); assert.equal(ledgerOf(out).mode, 'decide')
  ok(`decide N=3: option enums [P,Q], againstTopPick required, 3 reviews + 3 rebuttals, recommendation=${out.verdict.recommendation} confidence=${out.verdict.confidence}, lessons collapsed, judge blind`)
}
{
  const { out, calls } = await run('decide', { ...base, roster: roster(2), options: OPTS }, { reply: replyDecide({ noChallenges: true, noRec: true }) })
  assert.equal(byLabel(calls, 'rebut:').length, 0); assert.equal(out.verdict.flawed, true); assert.ok(out.verdict.reasons.includes('judge returned no recommendation'))
  ok(`decide no challenges -> no rebuttal calls; empty recommendation -> flawed ${JSON.stringify(out.verdict.reasons)}`)
}
{
  const { out, calls, logs } = await run('decide', { ...base, roster: roster(3), options: OPTS, maxTokens: 200000, reviewModel: 'haiku' }, { reply: replyDecide(), tokensPerCall: 100000 })
  assert.equal(byLabel(calls, 'review:').length, 0); assert.deepEqual(out.verdict.degraded.slice(0, 1), ['budget exhausted after Decide']); assert.equal(byLabel(calls, 'judge').length, 1)
  const rm = await run('decide', { ...base, roster: roster(2), options: OPTS, reviewModel: 'haiku' }, { reply: replyDecide() })
  assert.ok(byLabel(rm.calls, 'review:').every(c => c.o.model === 'haiku') && byLabel(rm.calls, 'rebut:').every(c => c.o.model === 'haiku') && byLabel(rm.calls, 'decide:').every(c => c.o.model === 'sonnet'))
  ok(`decide budget: ${logs.find(l => l.startsWith('budget:'))}; reviewModel haiku on review+rebuttal only`)
}
{
  const died = await run('decide', { ...base, roster: roster(2), options: OPTS }, { reply: replyDecide({ dieLabels: ['decide:A', 'decide:B'] }) })
  assert.equal(died.out.verdict.flawed, true); assert.deepEqual(died.out.verdict.reasons, ['every member died']); assert.deepEqual(ledgerOf(died.out).seats.map(s => s.fate), ['died', 'died'])
  const jd = await run('decide', { ...base, roster: roster(1), options: OPTS }, { reply: replyDecide({ judgeDies: true }) })
  assert.equal(jd.out.verdict.flawed, true); assert.deepEqual(jd.out.verdict.degraded, ['unreviewed: A', 'judge died']); assert.ok(jd.logs.includes('single member: skipping review and rebuttal'))
  ok(`decide all died -> flawed + ledger died,died; N=1 judge died -> degraded=${JSON.stringify(jd.out.verdict.degraded)}`)
}
{
  // bad option lists: flawed before any agent call, ledger line still returned (no seats)
  for (const options of [undefined, ['A: only one'], ['A: keep', 'A: split'], ['A: keep', ': nameless']]) {
    const { out, calls } = await run('decide', { ...base, roster: roster(3), options }, { reply: replyDecide() })
    assert.equal(calls.length, 0); assert.equal(out.verdict.flawed, true); assert.ok(out.verdict.reasons[0].startsWith('decide needs at least two options with distinct ids'))
    assert.deepEqual(ledgerOf(out).seats, []); assert.equal(ledgerOf(out).agentCalls, 0)
  }
  ok('decide options undefined / one option / duplicate ids / empty id -> flawed, 0 agent calls, ledger line with no seats')
}
// boundary: spent == cap is over (>=); one token of headroom is not (all five scripts)
{
  const replies = { build: replyFor('build'), test: replyFor('test'), design: replyFor('design'), review: replyReview(), decide: replyDecide() }
  const fanout = { build: 'Build', test: 'Write', design: 'Design', review: 'Review', decide: 'Decide' }
  const seen = []
  for (const [f, reply] of Object.entries(replies)) {
    const at = await run(f, { ...base, options: OPTS, roster: roster(3), maxTokens: 300000 }, { reply, tokensPerCall: 100000 })
    const below = await run(f, { ...base, options: OPTS, roster: roster(3), maxTokens: 300001 }, { reply, tokensPerCall: 100000 })
    assert.ok(at.out.verdict.degraded?.includes(`budget exhausted after ${fanout[f]}`), `${f} at cap`)
    assert.ok(!below.out.verdict.degraded?.includes(`budget exhausted after ${fanout[f]}`), `${f} below cap`)
    assert.ok(at.calls.length < below.calls.length, `${f}: cap must skip rounds`)
    seen.push(`${f}: at cap ${at.calls.length} calls, below ${below.calls.length}`)
  }
  ok(`budget boundary (spent == cap is over): ${seen.join('; ')}`)
}
console.log(`${n} checks passed`)
