import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ATOMS } from '../server/crcAgent.js'
import { matchesPlan, parseEvents, scoreCase, summarize } from './score.js'
const suite = JSON.parse(readFileSync(new URL('../../eval/cases.json', import.meta.url)))

test('suite contains exactly 50 distinct prompts across ten balanced categories', () => {
  assert.equal(suite.cases.length, 50)
  assert.equal(new Set(suite.cases.map(c => c.id)).size, 50)
  assert.equal(new Set(suite.cases.map(c => c.prompt)).size, 50)
  const categories = [...new Set(suite.cases.map(c => c.category))]
  assert.equal(categories.length, 10)
  for (const category of categories) assert.equal(suite.cases.filter(c => c.category === category).length, 5)
})
test('historical 50 cases cover the original ten atoms with clear oracles and review criteria', () => {
  const covered = new Set(suite.cases.flatMap(c => c.expected.plans.flatMap(plan => plan.map(call => call.name))))
  for (const atom of ATOMS.slice(0,10)) assert.ok(covered.has(atom.name), atom.name)
  for (const c of suite.cases) {
    assert.ok(c.goal && c.title && c.humanReview.length)
    assert.ok(c.expected.plans.length)
    assert.ok(['success','clarify','refuse','no_tool','tool_error'].includes(c.expected.outcome))
    for (const pattern of [...c.expected.textAll,...c.expected.textAny,...c.expected.textForbidden]) assert.doesNotThrow(() => new RegExp(pattern,'iu'))
  }
})
test('plan matching preserves repeated tool arguments and exact value types', () => {
  const call = subjectId => ({ name:'medication_review', args:{subjectId} })
  assert.ok(matchesPlan([call('01-003'),call('01-001')],[call('01-001'),call('01-003')]))
  assert.equal(matchesPlan([call('01-001'),call('01-001')],[call('01-001'),call('01-003')]), false)
  assert.equal(matchesPlan([{name:'form_records',args:{formId:'45'}}],[{name:'form_records',args:{formId:45}}]), false)
})
test('SSE comments and CRLF are parsed without treating heartbeats as events', () => {
  assert.deepEqual(parseEvents(': keep-alive\r\n\r\nevent: done\r\ndata: {"ok":true}\r\n\r\n'), [{event:'done',data:{ok:true}}])
})
test('rules fallback cannot be counted as model performance', () => {
  const scenario = suite.cases.find(c => c.id === 'CRC-044')
  const scored = scoreCase(scenario, [
    {event:'trace',data:{stage:'plan',selection:'fallback'}},
    {event:'token',data:'I can help with CRC study records.'},
    {event:'done',data:{ok:true,selection:'fallback'}}
  ])
  assert.equal(scored.systemPassed,true)
  assert.equal(scored.modelTaskPassed,false)
  assert.equal(scored.humanReviewStatus,'pending')
})
test('a superficially successful response with a wrong argument fails the oracle', () => {
  const scenario = suite.cases.find(c => c.id === 'CRC-001')
  const scored = scoreCase(scenario, [
    {event:'trace',data:{stage:'plan',selection:'model'}},
    {event:'trace',data:{stage:'tool-start',tool:'subject_snapshot',parameters:{subjectId:'01-001'}}},
    {event:'trace',data:{stage:'tool-result',tool:'subject_snapshot',status:'success'}},
    {event:'token',data:'6 distinct subject identifiers, 46 forms, 41 imported records'},
    {event:'done',data:{ok:true,selection:'ollama'}}
  ])
  assert.equal(scored.modelTaskPassed,false)
  assert.ok(scored.checks.some(c => c.name==='tools_and_parameters' && !c.passed))
  assert.equal(summarize([{id:scenario.id,title:scenario.title,category:scenario.category,...scored}]).failures.length,1)
})
