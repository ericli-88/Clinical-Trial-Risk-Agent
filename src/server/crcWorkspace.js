import { prepareReadOnly } from './sqlTrace.js'
import { DatabaseSync } from 'node:sqlite'
import { getDatabasePath, getWorkbookSummary, listSheets, buildRbqmConsistencyAnalysis } from './data_access/edcDatabase.js'

const FORM_NAMES = ['Case overview','Visit dates','Informed consent','Demographics','Pathology · immunohistochemistry','Pathology · FISH & genetics','Pathology diagnosis','Prior medical history','Height & weight','Vital signs','Physical examination','ECOG performance status','Complete blood count','Urinalysis','Biochemistry & electrolytes','Immunoglobulins & beta-2 microglobulin','Coagulation','Bone marrow aspiration','12-lead ECG','Echocardiography','Pregnancy test','Viral serology','Whole-exome sequencing','Questionnaire assessments','ctDNA testing','Cerebrospinal fluid examination','CSF cytokines','Lumbar puncture','Intracranial target lesions','Intracranial non-target lesions','Eligibility criteria','Enrollment','New lesions','MTX blood concentration','MTX rescue medication','Induction treatment regimen','Orelabrutinib · induction','Consolidation treatment','Overall response assessment','Treatment delays','PFS follow-up','OS follow-up','Death report','Concomitant medications','Adverse events','Study completion']
let connection
const db = () => connection ||= new DatabaseSync(getDatabasePath(), { readOnly: true })
const quote = value => `"${String(value).replaceAll('"', '""')}"`
const formName = sheet => FORM_NAMES[Number(sheet.sheet_index) - 1] || `Form ${sheet.sheet_index}`

function subjectData() {
  const ids = prepareReadOnly(db(), `SELECT DISTINCT value_text AS id FROM excel_cells WHERE column_header IN ('受试者筛选编号','病例编号') AND value_text IS NOT NULL AND trim(value_text) <> '' ORDER BY value_text`).all().map(row => String(row.id).trim()).filter(id => /^(?:\d{2}-\d{3}|\d{5,7})$/.test(id))
  const subjects = new Map(ids.map(id => [id, { id, recordCount: 0, formCount: 0, adverseEventRecords: 0, medicationRecords: 0, forms: [] }]))
  for (const sheet of listSheets()) {
    const columns = prepareReadOnly(db(), `SELECT sqlite_column_name FROM _columns WHERE table_name = ? AND original_header IN ('病例编号','受试者筛选编号') ORDER BY CASE original_header WHEN '病例编号' THEN 0 ELSE 1 END`).all(sheet.table_name)
    if (!columns.length) continue
    const rows = prepareReadOnly(db(), `SELECT ${quote(columns[0].sqlite_column_name)} AS id, count(*) AS records FROM ${quote(sheet.table_name)} GROUP BY ${quote(columns[0].sqlite_column_name)}`).all()
    for (const row of rows) {
      const subject = subjects.get(String(row.id))
      if (!subject) continue
      subject.recordCount += Number(row.records)
      subject.formCount += 1
      subject.forms.push({ name: formName(sheet), records: Number(row.records), source: sheet.sheet_name })
      if (sheet.sheet_name === '不良事件记录') subject.adverseEventRecords += Number(row.records)
      if (sheet.sheet_name === '合并用药记录') subject.medicationRecords += Number(row.records)
    }
  }
  return [...subjects.values()]
}

const ISSUE_NAMES = {
  MISSING_CONSENT_RECORD: 'No informed consent record found',
  MISSING_CONSENT_DATE: 'Consent date is missing or cannot be parsed',
  MISSING_RANDOMIZATION_DATE: 'Randomization date is missing or cannot be parsed',
  CONSENT_AFTER_RANDOMIZATION: 'Consent was signed after randomization'
}

function consentData() {
  const analysis = buildRbqmConsistencyAnalysis('核查知情同意签署日期和随机日期是否一致')
  return {
    checkedSubjects: analysis.result.checkedSubjects,
    issueCount: analysis.result.issueCount,
    affectedSubjects: new Set(analysis.result.issues.map(issue => issue.subject_id)).size,
    issues: analysis.result.issues.map(issue => ({ subjectId: issue.subject_id, type: issue.issue_type, description: ISSUE_NAMES[issue.issue_type] || issue.issue_type, consentDate: issue.consent_date || null, randomizationDate: issue.randomization_date || null, sources: issue.source_refs.map(ref => ref.replace('入组信息', 'Enrollment').replace('知情同意', 'Informed consent')) }))
  }
}

export function getCrcWorkspace() {
  const summary = getWorkbookSummary()
  const subjects = subjectData()
  return {
    source: { synthetic: process.env.EDC_DEMO === 'true', type: process.env.EDC_DEMO === 'true' ? 'Synthetic EDC demo (not patient data)' : 'Local EDC workbook snapshot', study: process.env.EDC_DEMO === 'true' ? 'Synthetic demonstration study' : 'CNS lymphoma · combination therapy', importedAt: summary.workbook.imported_at, liveSync: false },
    metrics: { forms: summary.sheetCount, records: summary.totalRows, cells: summary.totalCells, subjectIds: subjects.length, emptyForms: summary.emptySheets.length },
    forms: listSheets().map(sheet => ({ id: sheet.sheet_index, name: formName(sheet), originalName: sheet.sheet_name, records: sheet.data_rows_imported, fields: sheet.max_column })),
    subjects,
    consent: consentData()
  }
}

export function runCrcQuickAction(action, subjectId) {
  const data = getCrcWorkspace()
  if (action === 'overview') return {
    title: 'Study overview',
    answer: `Your EDC snapshot contains ${data.metrics.subjectIds} distinct subject identifiers across ${data.metrics.forms} forms, with ${data.metrics.records.toLocaleString('en-US')} imported records.\n\n${data.metrics.emptyForms} forms have no imported records. An empty form does not establish that data is overdue or required for a particular participant.\n\nUse Subject snapshot to inspect one participant, or Check consent to review consent and randomization dates. This is a workbook snapshot, not a live EDC connection.`,
    evidence: [{ label: 'Source', value: data.source.type }, { label: 'Imported records', value: String(data.metrics.records) }, { label: 'Forms', value: String(data.metrics.forms) }, { label: 'Last import', value: data.source.importedAt }],
    rows: data.forms.filter(form => form.records === 0).map(form => ({ form: form.name, status: 'No imported records' }))
  }
  if (action === 'subject') {
    const subject = data.subjects.find(item => item.id === subjectId)
    if (!subject) throw new Error('Select a subject identifier from this EDC snapshot.')
    return {
      title: `Subject ${subject.id}`,
      answer: `Subject ${subject.id} has ${subject.recordCount} records across ${subject.formCount} forms.\n\nThere are ${subject.adverseEventRecords} adverse event records and ${subject.medicationRecords} concomitant medication records. These are record counts, not a clinical risk assessment.\n\nThe form breakdown below shows where to begin reviewing this participant's data.`,
      evidence: [{ label: 'Subject identifier', value: subject.id }, { label: 'Match method', value: 'Exact match on case ID or screening ID columns' }, { label: 'Source', value: data.source.type }],
      rows: subject.forms.map(form => ({ form: form.name, records: form.records }))
    }
  }
  if (action === 'consent') {
    const consent = data.consent
    return {
      title: 'Consent check',
      answer: `Checked consent and randomization dates for ${consent.checkedSubjects} successfully enrolled subjects.\n\n${consent.issueCount ? `Found ${consent.issueCount} ${consent.issueCount === 1 ? 'finding' : 'findings'} affecting ${consent.affectedSubjects} ${consent.affectedSubjects === 1 ? 'subject' : 'subjects'}. Review the findings below against the source documents before taking action.` : 'No findings were detected by these checks.'}\n\nChecks cover missing consent records, missing or unparseable dates, and consent signed after randomization. This does not verify consent versions, signatures, source documents, or exact times.`,
      evidence: [{ label: 'Method', value: 'Deterministic date and record checks' }, { label: 'Scope', value: 'Successfully enrolled subjects only' }, { label: 'Source forms', value: 'Enrollment; Informed consent' }],
      rows: consent.issues.map(issue => ({ subject: issue.subjectId, finding: issue.description, consent: issue.consentDate || 'Unavailable', randomization: issue.randomizationDate || 'Unavailable', source: issue.sources.join('; ') }))
    }
  }
  throw new Error('Unknown quick action.')
}

export function registerCrcRoutes(app) {
  app.get('/api/crc/workspace', (_req, res) => {
    try { res.json(getCrcWorkspace()) } catch (error) { res.status(500).json({ error: error.message }) }
  })
  app.post('/api/crc/quick-action', (req, res) => {
    try { res.json(runCrcQuickAction(req.body?.action, req.body?.subjectId)) } catch (error) { res.status(400).json({ error: error.message }) }
  })
}
