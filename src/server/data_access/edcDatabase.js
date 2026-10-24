import { prepareReadOnly } from '../sqlTrace.js'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DB_CANDIDATE_PATHS = [
  process.env.EDC_DB_PATH,
  path.resolve(__dirname, '../../../data/edc_chatbot.sqlite'),
  path.resolve(process.cwd(), '../data/edc_chatbot.sqlite'),
  path.resolve(process.cwd(), 'data/edc_chatbot.sqlite'),
  path.resolve(__dirname, '../../data/edc_chatbot.sqlite')
].filter(Boolean)

function resolveDatabasePath() {
  return DB_CANDIDATE_PATHS.find((candidatePath) => existsSync(candidatePath)) || DB_CANDIDATE_PATHS[0]
}

const DB_PATH = resolveDatabasePath()

let db = null

function getDb() {
  if (!existsSync(DB_PATH)) {
    throw new Error(`找不到 EDC SQLite 数据库：${DB_PATH}。已尝试路径：${DB_CANDIDATE_PATHS.join('；')}`)
  }

  if (!db) db = new DatabaseSync(DB_PATH, { readOnly: true })
  return db
}

function all(sql, params = []) {
  return prepareReadOnly(getDb(), sql).all(...params)
}

function get(sql, params = []) {
  return prepareReadOnly(getDb(), sql).get(...params)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))]
}

function extractSubjectCode(question) {
  const text = normalizeText(question)
  return text.match(/\b\d{2}-\d{3}\b/)?.[0] || text.match(/\b\d{5,7}\b/)?.[0] || null
}

function extractSheetName(question, sheets) {
  const text = normalizeText(question)
  return sheets.find((sheet) => text.includes(sheet.sheet_name))?.sheet_name || null
}

function extractSearchTerms(question) {
  const text = normalizeText(question)
  const explicitSubject = extractSubjectCode(text)
  if (explicitSubject) return [explicitSubject]

  const quoted = [...text.matchAll(/[“"']([^”"']{2,})[”"']/g)].map((match) => match[1].trim())
  if (quoted.length) return quoted.slice(0, 4)

  const clinicalTerms = [
    '白细胞',
    '中性粒细胞',
    '血红蛋白',
    '血小板',
    '肌酐',
    '胆红素',
    'ALT',
    'AST',
    'MTX',
    '甲氨蝶呤',
    '奥布替尼',
    '不良事件',
    '合并用药',
    'ECOG',
    '脑脊液',
    '知情同意',
    '访视',
    '延迟治疗',
    '入组',
    '筛选'
  ]
  const matched = clinicalTerms.filter((term) => text.toLowerCase().includes(term.toLowerCase()))
  if (matched.length) return matched.slice(0, 4)

  return text
    .replace(/[，。？！、,.?!]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 2 && !['查询', '帮我', '看看', '有哪些', '多少', '数据', '记录'].includes(term))
    .slice(0, 4)
}

export function getWorkbookSummary() {
  const workbook = get('SELECT * FROM _source_workbook LIMIT 1')
  const agg = get(`
    SELECT
      COUNT(*) AS sheet_count,
      SUM(data_rows_imported) AS total_rows,
      SUM(non_empty_cells) AS total_cells,
      MAX(data_rows_imported) AS max_sheet_rows
    FROM _sheets
  `)
  const topSheets = all(`
    SELECT sheet_index, sheet_name, table_name, data_rows_imported, non_empty_cells
    FROM _sheets
    ORDER BY data_rows_imported DESC, sheet_index
    LIMIT 8
  `)
  const emptySheets = all(`
    SELECT sheet_name
    FROM _sheets
    WHERE data_rows_imported = 0
    ORDER BY sheet_index
  `).map((row) => row.sheet_name)
  const subjectIdentifiers = all(`
    SELECT DISTINCT value_text
    FROM excel_cells
    WHERE column_header IN ('受试者筛选编号', '病例编号')
      AND value_text IS NOT NULL
      AND value_text <> ''
  `)

  return {
    workbook,
    sheetCount: Number(agg.sheet_count || 0),
    totalRows: Number(agg.total_rows || 0),
    totalCells: Number(agg.total_cells || 0),
    subjectCount: subjectIdentifiers.filter(row => /^(?:\d{2}-\d{3}|\d{5,7})$/.test(String(row.value_text).trim())).length,
    topSheets,
    emptySheets
  }
}

export function listSheets() {
  return all(`
    SELECT sheet_index, sheet_name, table_name, max_column, data_rows_imported, non_empty_cells
    FROM _sheets
    ORDER BY sheet_index
  `)
}

export function getSheetColumns(sheetName) {
  if (!sheetName) return []
  return all(
    `
      SELECT c.excel_column_letter, c.original_header, c.sqlite_column_name, c.sqlite_type
      FROM _columns c
      JOIN _sheets s ON s.sheet_index = c.sheet_index
      WHERE s.sheet_name = ?
      ORDER BY c.excel_column_index
    `,
    [sheetName]
  )
}

export function searchRows(question, limit = 12) {
  const sheets = listSheets()
  const sheetName = extractSheetName(question, sheets)
  const terms = extractSearchTerms(question)
  const safeTerms = terms.length ? terms : ['']
  const whereParts = []
  const params = []

  if (sheetName) {
    whereParts.push('sheet_name = ?')
    params.push(sheetName)
  }

  for (const term of safeTerms) {
    whereParts.push('row_text LIKE ?')
    params.push(`%${term}%`)
  }

  const rows = all(
    `
      SELECT sheet_name, table_name, source_row, row_text
      FROM v_all_rows
      ${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
      ORDER BY sheet_name, CAST(source_row AS INTEGER)
      LIMIT ?
    `,
    [...params, limit]
  )

  return {
    terms: safeTerms,
    sheetName,
    rows
  }
}

export function searchRowsInSheets({ sheetNames = [], terms = [], limit = 30, matchMode = 'any' } = {}) {
  const safeSheetNames = uniq(sheetNames).filter(Boolean)
  const safeTerms = uniq(terms.map((term) => String(term || '').trim()).filter(Boolean))
  const whereParts = []
  const params = []

  if (safeSheetNames.length) {
    whereParts.push(`sheet_name IN (${safeSheetNames.map(() => '?').join(', ')})`)
    params.push(...safeSheetNames)
  }

  if (safeTerms.length) {
    const termParts = safeTerms.map(() => 'row_text LIKE ?')
    whereParts.push(`(${termParts.join(matchMode === 'all' ? ' AND ' : ' OR ')})`)
    params.push(...safeTerms.map((term) => `%${term}%`))
  }

  return all(
    `
      SELECT sheet_name, table_name, source_row, row_text
      FROM v_all_rows
      ${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
      ORDER BY sheet_name, CAST(source_row AS INTEGER)
      LIMIT ?
    `,
    [...params, Number(limit || 30)]
  )
}

export function sampleRowsFromSheets({ sheetNames = [], limit = 12 } = {}) {
  const safeSheetNames = uniq(sheetNames).filter(Boolean)
  const whereParts = []
  const params = []

  if (safeSheetNames.length) {
    whereParts.push(`sheet_name IN (${safeSheetNames.map(() => '?').join(', ')})`)
    params.push(...safeSheetNames)
  }

  return all(
    `
      SELECT sheet_name, table_name, source_row, row_text
      FROM v_all_rows
      ${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
      ORDER BY sheet_name, CAST(source_row AS INTEGER)
      LIMIT ?
    `,
    [...params, Number(limit || 12)]
  )
}

export function getSubjectProfile(question) {
  const subjectCode = extractSubjectCode(question)
  if (!subjectCode) return null

  const rows = all(
    `
      SELECT sheet_name, table_name, source_row, row_text
      FROM v_all_rows
      WHERE row_text LIKE ?
      ORDER BY sheet_name, CAST(source_row AS INTEGER)
      LIMIT 80
    `,
    [`%${subjectCode}%`]
  )

  const sheetNames = uniq(rows.map((row) => row.sheet_name))
  const sheetCounts = sheetNames
    .map((sheetName) => ({
      label: sheetName,
      value: rows.filter((row) => row.sheet_name === sheetName).length
    }))
    .sort((a, b) => b.value - a.value)

  const keyRows = rows
    .filter((row) =>
      ['---病例首页---', '访视日期', '知情同意', '入组信息', '不良事件记录', '延迟治疗', 'MTX治疗相关-MTX血浓度'].includes(
        row.sheet_name
      )
    )
    .slice(0, 12)

  return {
    subjectCode,
    rowCount: rows.length,
    sheetNames,
    sheetCounts,
    rows,
    keyRows
  }
}

export function buildDatasetOverviewAnalysis() {
  const summary = getWorkbookSummary()
  return {
    template: 'dataset_overview',
    intentName: 'EDC 数据总览',
    thinking: ['读取 SQLite 元数据表。', '统计 sheet、数据行、非空单元格和受试者编号数量。', '识别数据量最大的 CRF 表和暂无数据的表。'],
    evidence: [
      { label: '数据库', value: DB_PATH },
      { label: '来源文件', value: summary.workbook?.source_filename || '未知' },
      { label: '导入时间', value: summary.workbook?.imported_at || '未知' },
      { label: '数据规模', value: `${summary.sheetCount} 个 sheet，${summary.totalRows} 行，${summary.totalCells} 个非空单元格` }
    ],
    visual: {
      template: 'dataset_overview',
      title: 'EDC 数据总览',
      summary: `${summary.sheetCount} 个 CRF 表 / ${summary.subjectCount} 个受试者编号`,
      metrics: [
        { label: 'Sheets', value: summary.sheetCount },
        { label: '数据行', value: summary.totalRows },
        { label: '非空单元格', value: summary.totalCells },
        { label: '受试者编号', value: summary.subjectCount }
      ],
      bars: summary.topSheets.map((sheet) => ({
        label: sheet.sheet_name,
        value: sheet.data_rows_imported,
        subLabel: `${sheet.non_empty_cells} cells`
      })),
      emptySheets: summary.emptySheets
    },
    summary
  }
}

export function buildSheetCatalogAnalysis(question) {
  const sheets = listSheets()
  const matchedSheet = extractSheetName(question, sheets)
  const columns = matchedSheet ? getSheetColumns(matchedSheet) : []

  return {
    template: 'sheet_catalog',
    intentName: matchedSheet ? 'EDC 表结构详情' : 'EDC 表目录',
    thinking: matchedSheet
      ? ['识别到用户在询问具体 CRF 表。', '读取该表的列结构和数据行数。', '返回可用于后续查询的字段清单。']
      : ['读取 EDC workbook 的全部 sheet 目录。', '按原始 Excel 顺序整理每张表的数据行和非空单元格。'],
    evidence: [
      { label: '表数量', value: `${sheets.length} 个 sheet` },
      { label: '匹配表', value: matchedSheet || '未指定具体表，返回全量目录' }
    ],
    visual: {
      template: 'sheet_catalog',
      title: matchedSheet ? `${matchedSheet} 字段结构` : 'EDC 表目录',
      summary: matchedSheet ? `${columns.length} 个字段` : `${sheets.length} 个 sheet`,
      sheets,
      matchedSheet,
      columns
    },
    sheets,
    matchedSheet,
    columns
  }
}

export function buildSubjectAnalysis(question) {
  const profile = getSubjectProfile(question)

  if (!profile) {
    return {
      template: 'subject_profile',
      needsSubject: true,
      thinking: ['识别到用户在询问受试者级数据。', '当前问题里没有找到形如 01-001 的受试者编号。'],
      evidence: [{ label: '需要补充', value: '请提供受试者筛选编号或病例编号，例如 01-001。' }],
      visual: { template: 'subject_profile', title: '受试者数据画像', summary: '等待受试者编号', rows: [] },
      fallbackText: '请补充受试者编号，例如：01-001 有哪些 EDC 记录？'
    }
  }

  return {
    template: 'subject_profile',
    intentName: '受试者数据画像',
    thinking: ['识别受试者编号。', '跨全部 CRF 表检索包含该编号的记录。', '按表单聚合记录数，并提取关键记录作为回答依据。'],
    evidence: [
      { label: '受试者编号', value: profile.subjectCode },
      { label: '命中记录', value: `${profile.rowCount} 行，覆盖 ${profile.sheetNames.length} 张表` },
      { label: '覆盖表单', value: profile.sheetNames.slice(0, 10).join('、') || '未命中' }
    ],
    visual: {
      template: 'subject_profile',
      title: `${profile.subjectCode} 数据画像`,
      summary: `${profile.rowCount} 行记录 / ${profile.sheetNames.length} 张表`,
      sheetCounts: profile.sheetCounts.slice(0, 10),
      rows: profile.keyRows.length ? profile.keyRows : profile.rows.slice(0, 12)
    },
    profile
  }
}

export function buildSearchAnalysis(question) {
  const result = searchRows(question, 14)
  return {
    template: 'data_search',
    intentName: 'EDC 数据检索',
    thinking: ['提取问题中的检索关键词。', '在 EDC 行级文本视图中查找匹配记录。', '返回命中表、原始 Excel 行号和行内容摘要。'],
    evidence: [
      { label: '检索词', value: result.terms.join('、') || '无' },
      { label: '限定表', value: result.sheetName || '全库检索' },
      { label: '命中数量', value: `${result.rows.length} 行（最多展示 14 行）` }
    ],
    visual: {
      template: 'data_search',
      title: 'EDC 检索结果',
      summary: `${result.rows.length} 条结果`,
      terms: result.terms,
      rows: result.rows
    },
    result
  }
}

function parseIsoDate(value) {
  const text = normalizeText(value)
  const match = text.match(/\d{4}-\d{1,2}-\d{1,2}/)
  if (!match) return null
  const [year, month, day] = match[0].split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(date.getTime())) return null
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

function formatDate(value) {
  const date = parseIsoDate(value)
  return date ? date.toISOString().slice(0, 10) : normalizeText(value)
}

function parseNumericAge(value) {
  const match = normalizeText(value).match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

function calculateAgeAt(birthDateValue, referenceDateValue) {
  const birthDate = parseIsoDate(birthDateValue)
  const referenceDate = parseIsoDate(referenceDateValue)
  if (!birthDate || !referenceDate) return null

  let age = referenceDate.getUTCFullYear() - birthDate.getUTCFullYear()
  const monthDelta = referenceDate.getUTCMonth() - birthDate.getUTCMonth()
  const dayDelta = referenceDate.getUTCDate() - birthDate.getUTCDate()
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) age -= 1
  return age
}

function indexFirstBySubject(rows = []) {
  const map = new Map()
  for (const row of rows) {
    const subjectId = normalizeText(row['病例编号'])
    if (subjectId && !map.has(subjectId)) map.set(subjectId, row)
  }
  return map
}

function isYes(value) {
  return normalizeText(value) === '是'
}

function sourceRef(sheetName, row) {
  return row ? `${sheetName} Excel row ${row.__source_row}` : ''
}

function matchesRbqmConsistencyQuestion(question) {
  const text = normalizeText(question)
  const asksConsistency = /RBQM|核对|核查|检查|一致|矛盾|异常|不晚于|晚于/.test(text)
  const asksConsent = /知情同意|签署日期|随机日期|随机/.test(text)
  const asksAge = /出生日期|人口学年龄|年龄分层|18\s*[至到-]\s*75|18岁≤年龄≤75岁|18岁|75岁|入选标准/.test(text)
  return asksConsistency && (asksConsent || asksAge)
}

function buildConsentIssues(enrollmentRows, consentBySubject) {
  const issues = []

  for (const enrollment of enrollmentRows) {
    const subjectId = normalizeText(enrollment['病例编号'])
    const consent = consentBySubject.get(subjectId)
    const consentDate = consent ? formatDate(consent['签署日期']) : ''
    const randomizationDate = formatDate(enrollment['随机日期'])
    const consentDateObj = parseIsoDate(consentDate)
    const randomizationDateObj = parseIsoDate(randomizationDate)
    const sourceRefs = [sourceRef('入组信息', enrollment), sourceRef('知情同意', consent)].filter(Boolean)

    if (!consent) {
      issues.push({
        subject_id: subjectId,
        patient_initials: normalizeText(enrollment['患者姓名缩写']),
        issue_type: 'MISSING_CONSENT_RECORD',
        reason: '成功入组受试者未找到知情同意记录。',
        consent_date: '',
        randomization_date: randomizationDate,
        source_refs: sourceRefs
      })
      continue
    }

    if (!consentDateObj) {
      issues.push({
        subject_id: subjectId,
        patient_initials: normalizeText(enrollment['患者姓名缩写'] || consent['患者姓名缩写']),
        issue_type: 'MISSING_CONSENT_DATE',
        reason: '知情同意记录存在，但签署日期为空或无法解析。',
        consent_date: consentDate,
        randomization_date: randomizationDate,
        source_refs: sourceRefs
      })
    }

    if (!randomizationDateObj) {
      issues.push({
        subject_id: subjectId,
        patient_initials: normalizeText(enrollment['患者姓名缩写'] || consent['患者姓名缩写']),
        issue_type: 'MISSING_RANDOMIZATION_DATE',
        reason: '成功入组记录存在，但随机日期为空或无法解析。',
        consent_date: consentDate,
        randomization_date: randomizationDate,
        source_refs: sourceRefs
      })
    }

    if (consentDateObj && randomizationDateObj && consentDateObj > randomizationDateObj) {
      issues.push({
        subject_id: subjectId,
        patient_initials: normalizeText(enrollment['患者姓名缩写'] || consent['患者姓名缩写']),
        issue_type: 'CONSENT_AFTER_RANDOMIZATION',
        reason: '知情同意签署日期晚于随机日期。',
        consent_date: consentDate,
        randomization_date: randomizationDate,
        source_refs: sourceRefs
      })
    }
  }

  return issues
}

function buildAgeIssues(enrollmentRows, demographicsBySubject, criteriaBySubject) {
  const issues = []

  for (const enrollment of enrollmentRows) {
    const subjectId = normalizeText(enrollment['病例编号'])
    const demographics = demographicsBySubject.get(subjectId)
    const criteria = criteriaBySubject.get(subjectId)
    const sourceRefs = [
      sourceRef('入组信息', enrollment),
      sourceRef('人口学资料', demographics),
      sourceRef('入选排除标准', criteria)
    ].filter(Boolean)
    const base = {
      subject_id: subjectId,
      patient_initials: normalizeText(enrollment['患者姓名缩写'] || demographics?.['患者姓名缩写'] || criteria?.['患者姓名缩写']),
      birth_date: demographics ? formatDate(demographics['出生日期']) : '',
      demographic_age: demographics ? normalizeText(demographics['年龄']) : '',
      calculated_age_at_randomization: null,
      enrollment_age_stratum: normalizeText(enrollment['年龄']),
      inclusion_18_75: criteria ? normalizeText(criteria['3）18岁≤年龄≤75岁；']) : '',
      randomization_date: formatDate(enrollment['随机日期']),
      source_refs: sourceRefs
    }

    if (!demographics) {
      issues.push({
        ...base,
        issue_type: 'MISSING_DEMOGRAPHICS_RECORD',
        reason: '成功入组受试者未找到人口学资料记录。'
      })
      continue
    }

    const demographicAge = parseNumericAge(demographics['年龄'])
    const calculatedAge = calculateAgeAt(demographics['出生日期'], enrollment['随机日期'])
    base.calculated_age_at_randomization = calculatedAge

    if (demographicAge === null) {
      issues.push({
        ...base,
        issue_type: 'MISSING_DEMOGRAPHIC_AGE',
        reason: '人口学资料中的年龄为空或无法解析。'
      })
    }

    if (calculatedAge !== null && demographicAge !== null && Math.abs(calculatedAge - demographicAge) > 1) {
      issues.push({
        ...base,
        issue_type: 'BIRTHDATE_AGE_MISMATCH',
        reason: `出生日期按随机日期推算年龄为 ${calculatedAge} 岁，但人口学年龄为 ${demographicAge} 岁。`
      })
    }

    const stratum = normalizeText(enrollment['年龄'])
    if (demographicAge !== null && /≤\s*60|<=\s*60/.test(stratum) && demographicAge > 60) {
      issues.push({
        ...base,
        issue_type: 'AGE_STRATUM_MISMATCH',
        reason: `入组年龄分层为 ${stratum}，但人口学年龄为 ${demographicAge} 岁。`
      })
    }

    if (demographicAge !== null && /＞\s*60|>\s*60/.test(stratum) && demographicAge <= 60) {
      issues.push({
        ...base,
        issue_type: 'AGE_STRATUM_MISMATCH',
        reason: `入组年龄分层为 ${stratum}，但人口学年龄为 ${demographicAge} 岁。`
      })
    }

    if (!criteria) {
      issues.push({
        ...base,
        issue_type: 'MISSING_INCLUSION_CRITERIA_RECORD',
        reason: '成功入组受试者未找到入选排除标准记录。'
      })
      continue
    }

    const criterionValue = normalizeText(criteria['3）18岁≤年龄≤75岁；'])
    if (demographicAge !== null && (demographicAge < 18 || demographicAge > 75) && criterionValue === '是') {
      issues.push({
        ...base,
        issue_type: 'INCLUSION_18_75_CONFLICT',
        reason: `人口学年龄为 ${demographicAge} 岁，不在 18 至 75 岁范围内，但入选标准“18岁≤年龄≤75岁”记录为“是”。`
      })
    }

    if (demographicAge !== null && demographicAge >= 18 && demographicAge <= 75 && criterionValue && criterionValue !== '是') {
      issues.push({
        ...base,
        issue_type: 'INCLUSION_18_75_CONFLICT',
        reason: `人口学年龄为 ${demographicAge} 岁，在 18 至 75 岁范围内，但入选标准“18岁≤年龄≤75岁”记录为“${criterionValue}”。`
      })
    }
  }

  return issues
}

export function buildRbqmConsistencyAnalysis(question) {
  if (!matchesRbqmConsistencyQuestion(question)) return null

  const text = normalizeText(question)
  const wantsConsent = /知情同意|签署日期|随机日期|随机|不晚于|晚于/.test(text)
  const wantsAge = /出生日期|人口学年龄|年龄分层|18\s*[至到-]\s*75|18岁≤年龄≤75岁|18岁|75岁|入选标准/.test(text)
  const enrollmentRows = all('SELECT * FROM sheet_32').filter((row) => isYes(row['受试者是否成功入组']))
  const consentBySubject = indexFirstBySubject(all('SELECT * FROM sheet_03'))
  const demographicsBySubject = indexFirstBySubject(all('SELECT * FROM sheet_04'))
  const criteriaBySubject = indexFirstBySubject(all('SELECT * FROM sheet_31'))
  const checks = []
  const issues = []

  if (wantsConsent) {
    const consentIssues = buildConsentIssues(enrollmentRows, consentBySubject)
    checks.push({
      check_id: 'CONSENT_BEFORE_RANDOMIZATION',
      description: '成功入组受试者必须存在知情同意记录，且签署日期不晚于随机日期。',
      issue_count: consentIssues.length,
      source_tables: ['入组信息', '知情同意']
    })
    issues.push(...consentIssues)
  }

  if (wantsAge) {
    const ageIssues = buildAgeIssues(enrollmentRows, demographicsBySubject, criteriaBySubject)
    checks.push({
      check_id: 'AGE_DEMOGRAPHICS_STRATUM_INCLUSION',
      description: '成功入组受试者的人口学出生日期、人口学年龄、入组年龄分层和 18 至 75 岁入选标准应一致。',
      issue_count: ageIssues.length,
      source_tables: ['入组信息', '人口学资料', '入选排除标准']
    })
    issues.push(...ageIssues)
  }

  const displayRows = issues.map((issue, index) => ({
    sheet_name: 'RBQM一致性核查',
    table_name: 'rbqm_consistency_issues',
    source_row: index + 1,
    row_text: [
      `病例编号: ${issue.subject_id}`,
      issue.patient_initials ? `患者姓名缩写: ${issue.patient_initials}` : '',
      `异常类型: ${issue.issue_type}`,
      `原因: ${issue.reason}`,
      issue.consent_date ? `知情同意日期: ${issue.consent_date}` : '',
      issue.randomization_date ? `随机日期: ${issue.randomization_date}` : '',
      issue.birth_date ? `出生日期: ${issue.birth_date}` : '',
      issue.demographic_age ? `人口学年龄: ${issue.demographic_age}` : '',
      issue.calculated_age_at_randomization !== null && issue.calculated_age_at_randomization !== undefined ? `按随机日期推算年龄: ${issue.calculated_age_at_randomization}` : '',
      issue.enrollment_age_stratum ? `入组年龄分层: ${issue.enrollment_age_stratum}` : '',
      issue.inclusion_18_75 ? `18至75岁入选标准: ${issue.inclusion_18_75}` : '',
      issue.source_refs?.length ? `来源: ${issue.source_refs.join('；')}` : ''
    ].filter(Boolean).join(' | ')
  }))

  return {
    template: 'rbqm_consistency',
    intentName: 'RBQM一致性核查',
    thinking: [
      '识别为 RBQM 受试者级一致性核查问题。',
      '读取入组信息中的成功入组受试者。',
      '按病例编号关联知情同意、人口学资料和入选排除标准。',
      '用确定性规则生成异常清单，再进入 Evidence Package 和 Checker。'
    ],
    evidence: [
      { label: '核查范围', value: `成功入组受试者 ${enrollmentRows.length} 名` },
      { label: '核查项目', value: checks.map((check) => check.description).join('；') },
      { label: '异常数量', value: `${issues.length} 条` }
    ],
    visual: {
      template: 'data_search',
      title: 'RBQM一致性核查结果',
      summary: `核查 ${enrollmentRows.length} 名成功入组受试者，发现 ${issues.length} 条异常。`,
      terms: checks.map((check) => check.check_id),
      rows: displayRows
    },
    result: {
      checkedSubjects: enrollmentRows.length,
      issueCount: issues.length,
      checks,
      issues
    }
  }
}

export function getDatabasePath() {
  return DB_PATH
}
