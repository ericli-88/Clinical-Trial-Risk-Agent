import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(path.join(root, 'data'), { recursive: true })
const filename = path.join(root, 'data/synthetic.sqlite')
if (existsSync(filename)) { console.log('Synthetic database already exists. No data was overwritten.'); process.exit(0) }
const db = new DatabaseSync(filename)
db.exec(`CREATE TABLE _source_workbook (id INTEGER, source_path TEXT, source_filename TEXT, imported_at TEXT, workbook_sheet_count INTEGER);
CREATE TABLE _sheets (sheet_index INTEGER, sheet_name TEXT, table_name TEXT, max_column INTEGER, data_rows_imported INTEGER, non_empty_cells INTEGER);
CREATE TABLE _columns (sheet_index INTEGER, table_name TEXT, excel_column_index INTEGER, excel_column_letter TEXT, original_header TEXT, sqlite_column_name TEXT, sqlite_type TEXT);
CREATE TABLE excel_cells (sheet_index INTEGER, sheet_name TEXT, table_name TEXT, row_index INTEGER, column_index INTEGER, cell_address TEXT, column_header TEXT, value_text TEXT, value_type TEXT, formula_text TEXT, number_format TEXT);`)
db.prepare('INSERT INTO _source_workbook VALUES (1,?,?,?,46)').run('synthetic-generator','SYNTHETIC-DEMO', '2026-10-23T12:00:00Z')
const subjects = Array.from({ length: 6 }, (_,i) => `01-${String(i+1).padStart(3,'0')}`)
const quote = value => `"${value.replaceAll('"','""')}"`
const names = { 1:'Case overview', 2:'Visit dates', 3:'知情同意', 4:'Demographics', 31:'Eligibility criteria', 32:'入组信息', 44:'合并用药记录', 45:'不良事件记录' }
for (let formId = 1; formId <= 46; formId++) {
  const table = `sheet_${String(formId).padStart(2,'0')}`
  const name = names[formId] || `Synthetic form ${formId}`
  let headers = ['病例编号','Record status'], rows = []
  if ([1,4,31].includes(formId)) rows = subjects.map(id => [id,'Synthetic demonstration record'])
  if (formId === 2) { headers = ['病例编号','Visit','Planned date','Actual date']; rows = subjects.map(id => [id,'Week 4','2026-10-01','2026-10-03']) }
  if (formId === 3) { headers = ['病例编号','签署日期']; rows = subjects.slice(0,5).map((id,i) => [id,i === 4 ? '2026-09-03' : '2026-09-01']) }
  if (formId === 32) { headers = ['病例编号','受试者是否成功入组','随机日期']; rows = subjects.map(id => [id,'是','2026-09-02']) }
  if (formId === 44) { headers = ['病例编号','Medication','Start date','End date']; rows = [['01-001','Synthetic medication A','2026-09-02','2026-09-06'],['01-001','Synthetic medication B','2026-09-08',''],['01-003','Synthetic medication C','2026-09-03','2026-09-05']] }
  if (formId === 45) { headers = ['病例编号','Event term','Onset date','Resolution date','Investigator review']; rows = [['01-001','Synthetic headache','2026-09-04','2026-09-05','Pending source verification'],['01-001','Synthetic nausea','2026-09-05','','Pending source verification'],['01-002','Synthetic fatigue','2026-09-08','2026-09-10','Reviewed in demo']] }
  db.exec(`CREATE TABLE ${table} (__source_row INTEGER NOT NULL, ${headers.map(h=>`${quote(h)} TEXT`).join(',')})`)
  headers.forEach((header,i) => db.prepare('INSERT INTO _columns VALUES (?,?,?,?,?,?,?)').run(formId,table,i+1,String.fromCharCode(65+i),header,header,'TEXT'))
  rows.forEach((row,i) => {
    db.prepare(`INSERT INTO ${table} VALUES (${Array(headers.length+1).fill('?').join(',')})`).run(i+2,...row)
    row.forEach((value,j) => db.prepare('INSERT INTO excel_cells VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(formId,name,table,i+2,j+1,`${String.fromCharCode(65+j)}${i+2}`,headers[j],value,'str',null,null))
  })
  db.prepare('INSERT INTO _sheets VALUES (?,?,?,?,?,?)').run(formId,name,table,headers.length,rows.length,rows.flat().filter(Boolean).length)
}
db.exec('CREATE INDEX idx_cells_subject ON excel_cells(column_header,value_text)')
db.close()
console.log('Created wholly synthetic data: 6 subjects, 46 forms, 2 consent findings. No private source data was read.')
