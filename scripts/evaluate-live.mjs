import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
const base = process.env.AGENT_URL || 'http://127.0.0.1:3002'
const health = await (await fetch(`${base}/health`)).json()
assert.equal(health.synthetic, true, 'Live portfolio evaluation requires the synthetic server.')
const cases = [
  { id: 'consent', payload: { action: 'consent' }, expected: ['consent_check'], text: /2 findings/ },
  { id: 'compound', payload: { question: 'Review adverse events and medications for 01-001.' }, expected: ['adverse_event_review','medication_review'], text: /form 44/ },
  { id: 'visit', payload: { question: 'Check a visit planned for 2026-10-01, actual 2026-10-05, window 2 days.' }, expected: ['visit_window_check'], text: /outside/ },
  { id: 'blank-field', payload: { question: 'Count blank Resolution date values in form 45 for 01-001.' }, expected: ['missing_field_check'], text: /1 existing records/ }
]
const results = []
for (const scenario of cases) {
  const started = Date.now()
  const response = await fetch(`${base}/api/crc/agent-stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scenario.payload), signal: AbortSignal.timeout(190000) })
  assert.equal(response.status, 200)
  const events = (await response.text()).split('\n\n').filter(b => b.startsWith('event:')).map(b => ({ event: b.split('\n')[0].slice(7), data: JSON.parse(b.split('\ndata: ')[1]) }))
  const tools = events.filter(e => e.event === 'trace' && e.data.stage === 'tool-result' && e.data.status === 'success').map(e => e.data.tool)
  const answer = events.find(e => e.event === 'token')?.data || ''
  const done = events.find(e => e.event === 'done')?.data
  const passed = JSON.stringify([...tools].sort()) === JSON.stringify([...scenario.expected].sort()) && scenario.text.test(answer) && done?.ok === true
  results.push({ id: scenario.id, input: scenario.payload, passed, selection: done?.selection, tools, durationMs: Date.now() - started, answer, events })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${scenario.id}: ${tools.join(', ')} (${done?.selection})`)
}
mkdirSync('docs/evaluation', { recursive: true })
writeFileSync('docs/evaluation/live-results.json', JSON.stringify({ recordedAt: new Date().toISOString(), dataset: 'Wholly synthetic fixture', note: 'Four development smoke cases, not a held-out benchmark or clinical validation.', results }, null, 2) + '\n')
if (results.some(r => !r.passed)) process.exitCode = 1
