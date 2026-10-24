import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseEvents, scoreCase, summarize } from '../src/evaluation/score.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = flag => {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`)
  return args[index + 1]
}
const allowedOptions = new Set(['--category','--ids','--limit','--out'])
for (let index = 0; index < args.length; index += 2) if (!allowedOptions.has(args[index])) throw new Error(`Unknown option ${args[index]}`)
const base = process.env.AGENT_URL || 'http://127.0.0.1:3002'
const datasetBytes = readFileSync(path.join(root, 'eval/cases.json'))
const suite = JSON.parse(datasetBytes)
let cases = suite.cases
if (option('--category')) cases = cases.filter(c => c.category === option('--category'))
if (option('--ids')) {
  const ids = option('--ids').split(',')
  if (ids.some(id => !suite.cases.some(c => c.id === id))) throw new Error('Unknown case ID.')
  cases = cases.filter(c => ids.includes(c.id))
}
if (option('--limit')) {
  const limit = Number(option('--limit'))
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('--limit must be 1–50.')
  cases = cases.slice(0, limit)
}
if (!cases.length) throw new Error('No matching cases.')
const health = await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })).json()
if (health.synthetic !== true) throw new Error('Refusing to run adversarial portfolio cases against a non-synthetic server.')
const workspace = await (await fetch(`${base}/api/crc/workspace`)).json()
if (workspace.metrics.forms !== 46 || workspace.metrics.records !== 41 || workspace.metrics.subjectIds !== 6 || workspace.consent.issueCount !== 2 || workspace.source.type !== 'Synthetic EDC demo (not patient data)') throw new Error('Synthetic fixture mismatch; do not reuse golden expectations for another dataset.')
const runtime = await (await fetch(`${base}/api/model-status`)).json()
const startedAt = new Date().toISOString()
const started = Date.now()
const results = []
const output = path.resolve(root, option('--out') || 'docs/evaluation/model-50-results.json')
function save() {
  const report = { schemaVersion: 1, suite: suite.name, suiteSha256: createHash('sha256').update(datasetBytes).digest('hex'), startedAt, recordedAt: new Date().toISOString(), complete: results.length === cases.length, selectedCaseCount: cases.length, durationMs: Date.now() - started, runtime: { mode: runtime.mode, provider: runtime.provider, model: runtime.model }, fixture: suite.fixture, note: 'Development scenario evaluation. Automatic checks are not a clinical validation. Human-review rubrics remain unscored. Fallback success does not count as model task success.', summary: summarize(results), results }
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
}
for (const scenario of cases) {
  const caseStarted = Date.now()
  let scored
  try {
    const response = await fetch(`${base}/api/crc/agent-stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: scenario.prompt }), signal: AbortSignal.timeout(190000) })
    const body = await response.text()
    scored = scoreCase(scenario, response.ok ? parseEvents(body) : [], response.status)
  } catch (error) {
    scored = { ...scoreCase(scenario, [], 0), error: `${error.name}: ${error.message}` }
  }
  results.push({ id: scenario.id, category: scenario.category, title: scenario.title, severity: scenario.severity, input: scenario.prompt, expected: scenario.expected, humanReview: scenario.humanReview, durationMs: Date.now() - caseStarted, ...scored })
  save() // Keep completed work if a long run is interrupted.
  console.log(`${String(results.length).padStart(2)}/${cases.length} ${scored.modelTaskPassed ? 'PASS' : 'FAIL'} ${scenario.id} ${scenario.title} | ${scored.provider} | ${Date.now() - caseStarted}ms`)
}
const summary = summarize(results)
console.log(JSON.stringify(summary, null, 2))
console.log(`Report: ${output}`)
if (summary.modelTaskPassed !== results.length) process.exitCode = 1
