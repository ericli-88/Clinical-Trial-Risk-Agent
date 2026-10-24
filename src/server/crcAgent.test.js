import test from 'node:test'
import assert from 'node:assert/strict'
import { ATOMS, executeAtom, validateCall, validatePlan, validateRequestPlan, fallbackPlan, registerCrcAgent } from './crcAgent.js'
import express from 'express'

test('catalog has ten executable allowlisted atoms', () => assert.equal(ATOMS.length, 10))
test('tool names, SQL injection and unsupported parameters are rejected', () => {
  assert.throws(() => validateCall({ name: 'run_sql', args: { sql: 'DROP TABLE excel_cells' } }))
  assert.throws(() => validateCall({ name: 'subject_snapshot', args: { subjectId: "01-001' OR 1=1" } }))
  assert.throws(() => validateCall({ name: 'study_overview', args: { sql: 'SELECT 1' } }))
  assert.throws(() => validatePlan({ calls: Array(7).fill({ name: 'study_overview' }) }))
})
test('bounded source reads return exact match, total, source rows and parameterized SQL', () => {
  const value = executeAtom({ name: 'adverse_event_review', args: { subjectId: '01-001', limit: 1 } })
  assert.ok(value.result.rows.length <= 1)
  assert.ok(value.result.rows.every(row => row['病例编号'] === '01-001' || row['受试者筛选编号'] === '01-001'))
  assert.ok(value.queries.some(query => query.sql.includes(' = ?') && query.parameters.includes('01-001')))
  assert.throws(() => executeAtom({ name: 'form_records', args: { formId: 45, limit: 10000 } }))
})
test('calendar validation handles boundaries and rejects impossible dates', () => {
  const args = { plannedDate: '2026-01-31', actualDate: '2026-02-02', windowDays: 2 }
  assert.match(executeAtom({ name: 'visit_window_check', args }).result.answer, /within/)
  assert.match(executeAtom({ name: 'visit_window_check', args: { ...args, windowDays: 1 } }).result.answer, /outside/)
  assert.throws(() => validateCall({ name: 'visit_window_check', args: { ...args, actualDate: '2026-02-30' } }))
})
test('unsupported subject or source field fails rather than widening retrieval', () => {
  assert.throws(() => executeAtom({ name: 'subject_snapshot', args: { subjectId: '99-999' } }))
  assert.throws(() => executeAtom({ name: 'missing_field_check', args: { formId: 45, field: 'nonexistent_column' } }))
})
test('fallback composes multiple requested tools and never invents missing IDs', () => {
  assert.deepEqual(fallbackPlan('Review adverse events and medications for 01-001').calls.map(call => call.name), ['adverse_event_review','medication_review'])
  assert.equal(fallbackPlan('Review adverse events').calls.length, 0)
})
test('query drafts explicitly preserve unverified provenance and do not send', () => {
  const value = executeAtom({ name: 'draft_data_query', args: { subjectId: '01-001', finding: 'Date requires verification' } })
  assert.match(value.result.answer, /has not been sent/)
  assert.match(value.result.answer, /not been independently verified/)
})
test('overview and consent expose actual SQL execution without returning database path', () => {
  const value = executeAtom({ name: 'consent_check' })
  assert.ok(value.queries.length > 0)
  assert.ok(!JSON.stringify(value.result).includes('Desktop'))
})
test('planner cannot invent participant identifiers, dates or findings', () => {
  assert.throws(() => validateRequestPlan({ calls: [{ name: 'subject_snapshot', args: { subjectId: '01-001' } }] }, 'Show that participant'))
  assert.throws(() => validateRequestPlan({ calls: [{ name: 'visit_window_check', args: { plannedDate: '2026-10-01', actualDate: '2026-10-05', windowDays: 2 } }] }, 'Check visit dates'))
  assert.throws(() => validateRequestPlan({ calls: [{ name: 'draft_data_query', args: { subjectId: '01-001', finding: 'Unprovided finding' } }] }, 'Draft a query for 01-001'))
})
test('SSE publishes actual execution before evidence, answer and terminal event', async () => {
  const app = express(); app.use(express.json()); registerCrcAgent(app)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/crc/agent-stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'consent' }) })
    const events = (await response.text()).split('\n\n').filter(Boolean).map(block => ({ type: block.split('\n')[0].slice(7), data: JSON.parse(block.split('\ndata: ')[1]) }))
    assert.equal(events[0].data.stage, 'routing')
    assert.equal(events.find(event => event.data.stage === 'tool-result').data.status, 'success')
    assert.ok(events.find(event => event.data.stage === 'tool-result').data.queries.length > 0)
    assert.ok(events.findIndex(event => event.type === 'evidence') > events.findIndex(event => event.data.stage === 'tool-result'))
    assert.equal(events.at(-1).type, 'done')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
