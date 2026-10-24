import { captureSql } from './sqlTrace.js'
import { DatabaseSync } from 'node:sqlite'
import { getDatabasePath, listSheets } from './data_access/edcDatabase.js'
import { runCrcQuickAction } from './crcWorkspace.js'
import { callChatModel } from './model_client/chatModelClient.js'
import { CLINICAL_ATOMS, validateClinicalCall, executeClinicalAtom, getClinicalPlannerContext } from './clinicalTools.js'
import { buildCrcPlannerMessages } from './clinicalPlanner.js'

export const ATOMS = [
  { name: 'study_overview', purpose: 'Count imported forms, records and distinct subject identifiers.', parameters: {} },
  { name: 'subject_snapshot', purpose: 'Exact-match subject counts across forms.', parameters: { subjectId: 'required subject ID' } },
  { name: 'consent_check', purpose: 'Missing consent and consent/randomization date ordering; enrolled subjects only.', parameters: {} },
  { name: 'form_records', purpose: 'Retrieve bounded source rows for a form and optional subject.', parameters: { formId: 'required integer 1–46', subjectId: 'optional subject ID', limit: 'integer 1–20, default 5' } },
  { name: 'adverse_event_review', purpose: 'Retrieve adverse-event records for coordinator follow-up; no causality or seriousness inference.', parameters: { subjectId: 'required subject ID', limit: 'integer 1–20, default 5' } },
  { name: 'medication_review', purpose: 'Retrieve concomitant medication records; no interaction or dose recommendations.', parameters: { subjectId: 'required subject ID', limit: 'integer 1–20, default 5' } },
  { name: 'missing_field_check', purpose: 'Find blank values in a specified field among existing rows. Does not establish protocol-requiredness.', parameters: { formId: 'required integer', field: 'required exact source column header', subjectId: 'optional subject ID' } },
  { name: 'visit_window_check', purpose: 'Compare a supplied visit date to an explicitly supplied planned date and window. No protocol inference.', parameters: { plannedDate: 'YYYY-MM-DD', actualDate: 'YYYY-MM-DD', windowDays: 'integer 0–365' } },
  { name: 'draft_data_query', purpose: 'Draft a neutral coordinator query for human review. Never sends or updates EDC.', parameters: { subjectId: 'required subject ID', finding: 'required factual finding, max 500 characters' } },
  { name: 'monitoring_pack', purpose: 'Compose study counts and consent findings into a source-backed monitor-preparation pack.', parameters: {} }
].concat(CLINICAL_ATOMS)
let database
const db = () => database ||= new DatabaseSync(getDatabasePath(), { readOnly: true })
const q = value => `"${String(value).replaceAll('"', '""')}"`
const fail = message => { throw new Error(message) }
const id = value => typeof value === 'string' && /^(?:\d{2}-\d{3}|\d{5,7})$/.test(value) ? value : fail('A valid subject identifier is required; select it from Subject snapshot.')
const allowed = new Set(ATOMS.map(atom => atom.name))
const fields = { study_overview: [], subject_snapshot: ['subjectId'], consent_check: [], form_records: ['formId','subjectId','limit'], adverse_event_review: ['subjectId','limit'], medication_review: ['subjectId','limit'], missing_field_check: ['formId','field','subjectId'], visit_window_check: ['plannedDate','actualDate','windowDays'], draft_data_query: ['subjectId','finding'], monitoring_pack: [] }

export function validateCall(call) {
  if (CLINICAL_ATOMS.some(atom=>atom.name===call?.name)) return validateClinicalCall(call)
  if (!call || !allowed.has(call.name)) throw new Error('Unknown tool; arbitrary SQL and external actions are unavailable.')
  const args = call.args || {}
  if (typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !fields[call.name].includes(key))) throw new Error('Unexpected tool parameters.')
  if (args.subjectId !== undefined) id(args.subjectId)
  if (['subject_snapshot','adverse_event_review','medication_review','draft_data_query'].includes(call.name)) id(args.subjectId)
  if (['form_records','missing_field_check'].includes(call.name) && (!Number.isInteger(args.formId) || args.formId < 1 || args.formId > 46)) throw new Error('Select an existing form ID (1–46).')
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20)) throw new Error('Record limit must be 1–20.')
  if (call.name === 'missing_field_check' && (typeof args.field !== 'string' || !args.field.trim() || args.field.length > 180)) throw new Error('An exact source field header is required.')
  if (call.name === 'draft_data_query' && (typeof args.finding !== 'string' || !args.finding.trim() || args.finding.length > 500)) throw new Error('A factual finding is required (max 500 characters).')
  if (call.name === 'visit_window_check') {
    for (const key of ['plannedDate','actualDate']) {
      const value = args[key]
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Valid calendar dates in YYYY-MM-DD format are required.')
    }
    if (!Number.isInteger(args.windowDays) || args.windowDays < 0 || args.windowDays > 365) throw new Error('Provide a protocol window in days (0–365).')
  }
  return { name: call.name, args }
}

function queryForm(args, queries) {
  const sheet = listSheets().find(item => item.sheet_index === args.formId)
  if (!sheet) throw new Error('Form was not found in this snapshot.')
  const columns = db().prepare('SELECT original_header, sqlite_column_name FROM _columns WHERE table_name = ? ORDER BY excel_column_index').all(sheet.table_name)
  const subjectColumn = columns.find(c => c.original_header === '病例编号') || columns.find(c => c.original_header === '受试者筛选编号')
  if (args.subjectId && !subjectColumn) throw new Error('This form has no recognized subject-ID field; cannot safely filter it.')
  const where = args.subjectId ? ` WHERE ${q(subjectColumn.sqlite_column_name)} = ?` : ''
  const params = args.subjectId ? [args.subjectId] : []
  const countSql = `SELECT count(*) AS count FROM ${q(sheet.table_name)}${where}`
  const sql = `SELECT * FROM ${q(sheet.table_name)}${where} ORDER BY __source_row LIMIT ?`
  const count = Number(db().prepare(countSql).get(...params).count)
  let rows
  // __source_row is the stable workbook row identifier, never an LLM-produced identifier.
  rows = db().prepare(sql).all(...params, args.limit || 5)
  queries.push({ sql: countSql, parameters: params }, { sql, parameters: [...params, args.limit || 5] })
  return { sheet, columns, count, rows }
}

export function executeAtom(rawCall) {
  if (CLINICAL_ATOMS.some(atom=>atom.name===rawCall?.name)) return executeClinicalAtom(rawCall)
  const captured = captureSql(() => executeAtomInternal(rawCall))
  return { ...captured.value, queries: [...captured.queries, ...captured.value.queries] }
}

function executeAtomInternal(rawCall) {
  const { name, args } = validateCall(rawCall)
  const queries = []
  let result
  if (['study_overview','subject_snapshot','consent_check'].includes(name)) {
    result = runCrcQuickAction({ study_overview: 'overview', subject_snapshot: 'subject', consent_check: 'consent' }[name], args.subjectId)
  } else if (name === 'monitoring_pack') {
    const overview = executeAtom({ name: 'study_overview' }).result
    const consent = executeAtom({ name: 'consent_check' }).result
    result = { answer: `Monitor preparation\n\n${overview.answer}\n\n${consent.answer}\n\nNext steps: reconcile findings with source documents and the investigator; confirm the protocol-specific visit schedule and outstanding queries separately. No records were changed.`, rows: consent.rows, evidence: [...overview.evidence, ...consent.evidence] }
  } else if (name === 'visit_window_check') {
    const deviation = Math.round((Date.parse(args.actualDate) - Date.parse(args.plannedDate)) / 86400000)
    result = { answer: `The supplied visit occurred ${Math.abs(deviation)} days ${deviation < 0 ? 'before' : 'after'} the planned date. It is ${Math.abs(deviation) <= args.windowDays ? 'within' : 'outside'} the supplied ±${args.windowDays}-day window.\n\nThese dates and this window were supplied in the request; they were not verified against an approved protocol.`, rows: [{ planned: args.plannedDate, actual: args.actualDate, window_days: args.windowDays, difference_days: deviation }], evidence: [{ label: 'Source', value: 'User-supplied dates and window; deterministic UTC calendar calculation' }] }
  } else if (name === 'draft_data_query') {
    // Verify that the identifier exists before producing a participant-specific draft.
    runCrcQuickAction('subject', args.subjectId)
    result = { answer: `Draft — human review required\n\nSubject ${args.subjectId}: Please review the following reported discrepancy against the source documents: “${args.finding}”. Please clarify or correct the EDC entry as appropriate and document the resolution.\n\nThe finding was supplied by the user and has not been independently verified. This draft has not been sent or saved to EDC.`, evidence: [{ label: 'Finding provenance', value: 'User supplied; unverified' }] }
  } else if (name === 'missing_field_check') {
    const sheet = listSheets().find(item => item.sheet_index === args.formId)
    if (!sheet) throw new Error('Form not found.')
    const columns = db().prepare('SELECT original_header, sqlite_column_name FROM _columns WHERE table_name = ?').all(sheet.table_name)
    const field = columns.find(item => item.original_header === args.field)
    if (!field) throw new Error('Field not found. Ask for the form records to inspect its source headers.')
    const subject = columns.find(c => c.original_header === '病例编号') || columns.find(c => c.original_header === '受试者筛选编号')
    if (args.subjectId && !subject) throw new Error('Subject filtering is unavailable for this form.')
    const where = `(${q(field.sqlite_column_name)} IS NULL OR trim(CAST(${q(field.sqlite_column_name)} AS TEXT)) = '')` + (args.subjectId ? ` AND ${q(subject.sqlite_column_name)} = ?` : '')
    const params = args.subjectId ? [args.subjectId] : []
    const sql = `SELECT count(*) AS count FROM ${q(sheet.table_name)} WHERE ${where}`
    const count = Number(db().prepare(sql).get(...params).count)
    queries.push({ sql, parameters: params })
    result = { answer: `${count} existing records have a blank value in “${args.field}” (form ${args.formId}).\n\nThis checks stored blanks only. Requiredness, conditional fields and entirely missing visits require the approved protocol and form rules.`, rows: [{ form: args.formId, field: args.field, blank_records: count }], evidence: [{ label: 'Source form', value: sheet.sheet_name }] }
  } else {
    const formId = name === 'adverse_event_review' ? 45 : name === 'medication_review' ? 44 : args.formId
    const data = queryForm({ ...args, formId }, queries)
    const rows = data.rows.map(row => ({ source_row: row.__source_row, ...Object.fromEntries(data.columns.map(c => [c.original_header, row[c.sqlite_column_name]])) }))
    result = { answer: `Found ${data.count} records in form ${formId}${args.subjectId ? ` for subject ${args.subjectId}` : ''}. Showing ${rows.length} source rows${data.count > rows.length ? `; ${data.count - rows.length} additional records are not shown` : ''}.\n\n${name === 'adverse_event_review' ? 'Review event details with the investigator and follow the protocol reporting procedure. Record presence or absence does not establish seriousness, causality or reporting completeness.' : name === 'medication_review' ? 'Reconcile this list with source records. No drug-interaction screening or dosing decision has been performed.' : 'Source field labels and values are preserved, including their original language.'}`, rows, evidence: [{ label: 'Source form', value: data.sheet.sheet_name }, { label: 'Total matched records', value: String(data.count) }, { label: 'Shown records', value: String(rows.length) }] }
  }
  return { name, args, result, queries }
}

export function fallbackPlan(question) {
  const subjectId = question.match(/\b(?:\d{2}-\d{3}|\d{5,7})\b/)?.[0]
  const calls = []
  const add = (name, args = {}) => calls.push({ name, args })
  if (/monitor|audit|监查/i.test(question)) add('monitoring_pack')
  else {
    if (/consent|知情|同意/i.test(question)) add('consent_check')
    if (/overview|how many|study summary|概览|多少/i.test(question)) add('study_overview')
    if (subjectId) {
      if (/adverse|\bAE\b|不良/i.test(question)) add('adverse_event_review', { subjectId })
      if (/medication|concomitant|用药/i.test(question)) add('medication_review', { subjectId })
      if (!calls.length || /snapshot|profile|概况/i.test(question)) add('subject_snapshot', { subjectId })
    }
  }
  return { calls, clarification: calls.length ? '' : 'Please specify a subject ID and the record type, or choose a quick action below. For a visit-window check, provide planned date, actual date and the protocol window.' }
}

export function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.calls) || plan.calls.length > 6) throw new Error('The plan must contain at most six tool calls.')
  return { calls: plan.calls.map(validateCall), clarification: String(plan.clarification || '').slice(0,800) }
}

export function validateRequestPlan(plan, question) {
  const checked = validatePlan(plan)
  for (const { args } of checked.calls) {
    if (args.subjectId && !question.includes(args.subjectId)) throw new Error('Subject identifier was not provided in the request.')
    for (const key of ['plannedDate','actualDate','finding','visit']) if (args[key] && !question.includes(args[key])) throw new Error(`The ${key} input was not provided in the request.`)
    if (args.windowDays !== undefined && !new RegExp(`\\b${args.windowDays}\\b`).test(question)) throw new Error('The visit window was not provided in the request.')
  }
  return checked
}

async function planQuestion(question, signal) {
  const response = await callChatModel({ signal, temperature: 0, label: 'CRC tool selection', messages: buildCrcPlannerMessages(question, ATOMS, getClinicalPlannerContext()) })
  const text = response.content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  return { ...validateRequestPlan(JSON.parse(text), question), provider: response.provider }
}

const descriptions = {
  study_overview: 'I’m counting the imported forms, records and subject identifiers.',
  subject_snapshot: 'I’m matching this subject ID exactly and counting records across forms.',
  consent_check: 'I’m comparing consent and randomization records for enrolled subjects.',
  form_records: 'I’m retrieving a bounded set of matching source records.',
  adverse_event_review: 'I’m looking up recorded adverse events for this participant.',
  medication_review: 'I’m looking up this participant’s concomitant medication records.',
  missing_field_check: 'I’m counting blank entries in the specified source field.',
  visit_window_check: 'I’m comparing the supplied dates with the supplied visit window.',
  draft_data_query: 'I’m preparing a neutral query draft for you to review.',
  monitoring_pack: 'I’m assembling study counts and consent checks for monitor preparation.'
}

export function registerCrcAgent(app, {planner=planQuestion} = {}) {
  app.get('/api/crc/atoms', (_req, res) => res.json({ atoms: ATOMS, policy: 'Read-only allowlisted functions; parameterized SQL; no diagnosis, write actions or invented protocol rules.' }))
  app.post('/api/crc/agent-stream', async (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
    if ((!question && !req.body?.action) || question.length > 4000) return res.status(400).json({ error: 'Provide a question of 1–4000 characters.' })
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    let disconnected = false
    const controller = new AbortController()
    res.on('close', () => { disconnected = true; controller.abort() })
    const send = (event, data) => { if (!disconnected) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    const trace = (message, extra = {}) => send('trace', { id: crypto.randomUUID(), time: new Date().toISOString(), message, ...extra })
    const heartbeat = setInterval(() => { if (!disconnected) res.write(': keep-alive\n\n') }, 15000)
    try {
      let plan
      if (req.body.action) {
        const name = { overview: 'study_overview', subject: 'subject_snapshot', consent: 'consent_check' }[req.body.action]
        if (!name) throw new Error('Unknown quick action.')
        plan = validatePlan({ calls: [{ name, args: name === 'subject_snapshot' ? { subjectId: req.body.subjectId } : {} }] })
        trace('You selected a quick action, so I can use its verified workflow directly.', { stage: 'routing', selection: 'quick-action' })
      } else {
        trace('I’m matching your request to the available CRC tools and checking which inputs are needed.', { stage: 'routing' })
        try { plan = await planner(question, controller.signal); trace(`The ${plan.provider} model selected ${plan.calls.length} tool${plan.calls.length === 1 ? '' : 's'}. I checked the names and parameters before running them.`, { stage: 'plan', selection: 'model' }) }
        catch { plan = {calls:[],clarification:'I could not validate a model-selected workflow for this request. Please specify the exact subject ID and task, or use a quick action. No data tools were run.'}; trace('Model planning was unavailable or returned an invalid plan. I have stopped without running data tools; use an explicit quick action or clarify the task.', { stage: 'plan', selection: 'fallback' }) }
      }
      if (disconnected) return
      const results = []
      let failedTools = 0
      for (const call of plan.calls) {
        if (disconnected) return
        trace(descriptions[call.name] || `I’m running ${call.name.replaceAll('_',' ')} using the validated subject, fields and display settings.`, { stage: 'tool-start', tool: call.name, parameters: call.args })
        const started = Date.now()
        try {
          const execution = executeAtom(call)
          results.push(execution.result)
          if(execution.result.visuals?.length) trace(`I built ${execution.result.visuals.length} chart panel(s) directly from the retrieved results, preserving source units and scope.`, {stage:'visualization',tool:'chart_builder',parameters:{kinds:execution.result.visuals.map(chart=>chart.kind)}})
          trace(`Completed ${call.name.replaceAll('_',' ')}. The source results are ready to review.`, { stage: 'tool-result', tool: call.name, parameters: call.args, queries: execution.queries, durationMs: Date.now() - started, status: 'success', resultRows: execution.result.rows?.length || 0 })
        } catch (error) {
          failedTools += 1
          trace(`I could not complete ${call.name.replaceAll('_',' ')}: ${error.message}`, { stage: 'tool-result', tool: call.name, status: 'failed' })
          results.push({ answer: `Unable to complete ${call.name}: ${error.message}` })
        }
      }
      trace('I’m preparing a source-backed summary and keeping missing data separate from confirmed protocol deviations.', { stage: 'answer' })
      // Numbers and findings are rendered directly from executed functions, not rewritten by a second LLM.
      const answer = results.length ? results.map(r => r.answer).join('\n\n────────\n\n') : plan.clarification || 'Please specify the CRC task you would like to review.'
      const rows = results.flatMap((r,index) => (r.rows || []).map(row => ({ task: index + 1, ...row })))
      send('evidence', results.flatMap(r => r.evidence || []))
      send('rows', rows)
      send('visuals', results.flatMap(result=>result.visuals || []))
      send('token', answer)
      send('done', { ok: failedTools === 0, failedTools, selection: plan.provider || (req.body.action ? 'quick-action' : 'fallback'), toolCount: plan.calls.length })
    } catch (error) { trace(error.message, { stage: 'error', status: 'failed' }); send('error', { message: error.message }) }
    finally { clearInterval(heartbeat); res.end() }
  })
}
