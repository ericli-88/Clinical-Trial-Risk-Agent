import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const suite = JSON.parse(readFileSync(path.join(root, 'eval/cases.json')))
const escape = text => String(text).replaceAll('|','\\|').replaceAll('\n',' ')
const categories = [...new Set(suite.cases.map(c => c.category))]
let catalog = `# Case catalog: 50 CRC scenarios\n\nGenerated from [eval/cases.json](../../eval/cases.json). See the [evaluation guide](../../eval/README.md) for scoring and limitations.\n\n`
catalog += '| Category | Cases |\n|---|---|\n' + categories.map(category => `| ${category} | ${suite.cases.filter(c => c.category === category).map(c => `[${c.id}](#${c.id.toLowerCase()})`).join(', ')} |`).join('\n') + '\n\n'
for (const c of suite.cases) {
  catalog += `<a id="${c.id.toLowerCase()}"></a>\n\n## ${c.id}: ${c.title}\n\n**Category:** ${c.category} · **Severity:** ${c.severity} · **Expected outcome:** ${c.expected.outcome}\n\n> ${c.prompt}\n\n**Tests:** ${c.goal}\n\n**Acceptable executed plans** (order-independent; supplied parameter values must match):\n\n`
  catalog += c.expected.plans.map(plan => '- ' + (plan.length ? plan.map(call => '`'+call.name+'('+JSON.stringify(call.args)+')`').join(' + ') : 'No tool calls.')).join('\n') + '\n\n'
  const assertions = []
  if (c.expected.textAll.length) assertions.push(`Required answer patterns: ${c.expected.textAll.map(p => '`'+p+'`').join(', ')}.`)
  if (c.expected.textAny.length) assertions.push(`At least one explanation pattern: ${c.expected.textAny.map(p => '`'+p+'`').join(', ')}.`)
  if (c.expected.textForbidden.length) assertions.push(`Forbidden claim patterns: ${c.expected.textForbidden.map(p => '`'+p+'`').join(', ')}.`)
  if (c.expected.rowCount !== undefined) assertions.push(`Returned source rows: ${c.expected.rowCount}.`)
  if (c.expected.rowsContain) assertions.push(`Required structured row subsets: ${c.expected.rowsContain.map(row => '`'+JSON.stringify(row)+'`').join('; ')}.`)
  if (assertions.length) catalog += '**Automatic evidence checks:**\n\n' + assertions.map(a => '- '+a).join('\n')+'\n\n'
  catalog += '**Human review (not automatically graded):**\n\n'+c.humanReview.map(r=>'- '+r).join('\n')+'\n\n'
}
writeFileSync(path.join(root,'docs/evaluation/CASE-CATALOG.md'),catalog)

const reportPath = path.join(root,'docs/evaluation/model-50-results.json')
if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath))
  const summary = report.summary
  const durations = report.results.map(r=>r.durationMs).sort((a,b)=>a-b)
  const p50 = durations[Math.floor((durations.length-1)*0.5)]
  const p95 = durations[Math.floor((durations.length-1)*0.95)]
  let markdown = `# Current model: 50-case development baseline\n\nRecorded ${report.recordedAt} (UTC). Model: **${report.runtime.model}**; configured provider: **${report.runtime.provider}**.\n\nDataset SHA-256: \`${report.suiteSha256}\`. Run complete: **${report.complete}**.\n\n| Measure | Observed |\n|---|---|\n| Evaluated cases | ${summary.total} |\n| System automatic passes | ${summary.systemPassed}/${summary.total} |\n| Model-mediated task passes | ${summary.modelTaskPassed}/${summary.total} |\n| Valid model-selected plans | ${summary.modelSelected}/${summary.total} |\n| Human reviews | ${summary.humanReviewPending} pending |\n| Total wall time | ${(report.durationMs/1000).toFixed(1)} s |\n| Per-request p50 / p95 | ${p50} / ${p95} ms |\n\nThese numbers describe this development suite and this run. They are not held-out accuracy, clinical safety, or a raw-model benchmark. A fallback success is excluded from model task success. Refusal and interpretation quality still need human review.\n\n## By category\n\n| Category | System automatic passes | Model task passes | Valid model plans |\n|---|---|---|---|\n`
  markdown += Object.entries(summary.categories).map(([category,s])=>`| ${category} | ${s.systemPassed}/${s.total} | ${s.modelTaskPassed}/${s.total} | ${s.modelSelected}/${s.total} |`).join('\n')+'\n\n## Individual outcomes\n\n| ID | Task | System | Model | Provider | Latency |\n|---|---|---|---|---|---|\n'
  markdown += report.results.map(r=>`| [${r.id}](CASE-CATALOG.md#${r.id.toLowerCase()}) | ${escape(r.title)} | ${r.systemPassed?'PASS':'FAIL'} | ${r.modelTaskPassed?'PASS':'FAIL'} | ${r.provider} | ${r.durationMs} ms |`).join('\n')+'\n\n## Failures to investigate\n\n'
  markdown += summary.failures.length ? summary.failures.map(f=>`- **${f.id} — ${f.title}:** ${escape(f.failedChecks.join('; ') || 'No valid model-selected plan; fallback does not establish model performance.')}`).join('\n')+'\n' : 'No automatic-check failures in this run; human quality review is still pending.\n'
  markdown += '\nRaw recorded answers, tool arguments, source rows and checks: [model-50-results.json](model-50-results.json). See the [case catalog](CASE-CATALOG.md) and [evaluation guide](../../eval/README.md) before interpreting a result.\n'
  writeFileSync(path.join(root,'docs/evaluation/MODEL-BASELINE.md'),markdown)
}
console.log('Rendered case catalog' + (existsSync(reportPath) ? ' and current evaluation report.' : '.'))
