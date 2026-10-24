import {DatabaseSync} from 'node:sqlite'
import {spawnSync} from 'node:child_process'
import {copyFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),target=path.join(root,'data/science-fixture.sqlite')
if(existsSync(target)){console.log('Science synthetic fixture already exists.');process.exit(0)}
const seed=spawnSync(process.execPath,['scripts/create-clinical-fixture.mjs'],{cwd:root,stdio:'inherit'})
if(seed.status)process.exit(seed.status)
const source=new DatabaseSync(path.join(root,'data/clinical-fixture.sqlite'),{readOnly:true})
if(source.prepare('SELECT source_filename FROM _source_workbook').get().source_filename!=='CLINICAL-SYNTHETIC-DEMO')throw new Error('Not a synthetic seed.')
source.close();copyFileSync(path.join(root,'data/clinical-fixture.sqlite'),target)
const db=new DatabaseSync(target),q=text=>`"${text.replaceAll('"','""')}"`
function replace(id,headers,rows){
 const table=`sheet_${String(id).padStart(2,'0')}`,name=db.prepare('SELECT sheet_name FROM _sheets WHERE sheet_index=?').get(id).sheet_name
 db.exec(`DROP TABLE ${table};CREATE TABLE ${table} (__source_row INTEGER NOT NULL,${headers.map(h=>q(h)+' TEXT').join(',')})`)
 db.prepare('DELETE FROM _columns WHERE sheet_index=?').run(id);db.prepare('DELETE FROM excel_cells WHERE sheet_index=?').run(id)
 headers.forEach((h,j)=>db.prepare('INSERT INTO _columns VALUES (?,?,?,?,?,?,?)').run(id,table,j+1,String.fromCharCode(65+j),h,h,'TEXT'))
 rows.forEach((row,i)=>{
  db.prepare(`INSERT INTO ${table} VALUES (${Array(headers.length+1).fill('?').join(',')})`).run(i+2,...row)
  row.forEach((value,j)=>db.prepare('INSERT INTO excel_cells VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,name,table,i+2,j+1,`${String.fromCharCode(65+j)}${i+2}`,headers[j],value,'str',null,null))
 })
 db.prepare('UPDATE _sheets SET max_column=?,data_rows_imported=?,non_empty_cells=? WHERE sheet_index=?').run(headers.length,rows.length,rows.flat().filter(v=>v!==null&&v!=='').length,id)
}
replace(4,['病例编号','访视名称','年龄','年龄单位'],Array.from({length:6},(_,i)=>[`01-${String(i+1).padStart(3,'0')}`,'Screening',String(20+i*10),'years']))
const old=db.prepare('SELECT * FROM sheet_15 ORDER BY __source_row').all()
const headers=['病例编号','访视名称','检查名称','采集日期','检查结果','单位','参考值下限','参考值上限']
const rows=old.map(row=>headers.map(h=>row[h]))
rows.push(
 ['01-001','C4','肌酐Cr','2026-09-22','110','μmol/L','50','110'],
 ['01-001','C1','谷丙转氨酶ALT','2026-09-01','20','U/L','0','40'],
 ['01-001','C2','谷丙转氨酶ALT','2026-09-08','40','U/L','0','40'],
 ['01-001','C4','谷丙转氨酶ALT','2026-09-22','30','U/L','0','40'],
 ['01-002','C1','谷丙转氨酶ALT','2026-09-01','50','U/L','0','40'],
 ['01-003','C1','肌酐Cr','2026-09-01','190','μmol/L','50','110'],
 ['01-003','C1','肌酐Cr','2026-09-01','195','μmol/L','50','110'],
 ['01-003','C1','谷丙转氨酶ALT','2026-09-01','45','U/L','0','40'],
 ['01-005','C3','谷丙转氨酶ALT','2026-09-15','','U/L','0','40'],
 ['01-006','C1','肌酐Cr','2026-09-01','100','','50','110']
)
replace(15,headers,rows)
replace(45,['病例编号','访视名称','不良事件名称（标准医学术语）','发生日期','结束日期','CTCAE 分级','是否SAE','转归'],[
 ['01-001','C1','Synthetic event A','2026-09-02','2026-09-03','1级','否','Resolved'],
 ['01-001','C2','Synthetic event B','2026-09-09','','2级','否','Not recorded'],
 ['01-002','C1','Synthetic event C','2026-09-03','','3级','是','Not recorded'],
 ['01-003','C1','Synthetic event D','2026-09-04','2026-09-05','2级','否','Resolved'],
 ['01-004','C1','Synthetic event E','2026-09-04','2026-09-05','1级','否','Resolved']
])
db.prepare('UPDATE _source_workbook SET source_filename=?,source_path=?').run('SCIENCE-SYNTHETIC-DEMO','science-synthetic-generator')
db.close();console.log('Created science synthetic fixture with distributions, paired labs, duplicate keys and categorical counts.')
