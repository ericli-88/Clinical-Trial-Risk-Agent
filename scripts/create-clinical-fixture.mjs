import {DatabaseSync} from 'node:sqlite'
import {spawnSync} from 'node:child_process'
import {copyFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const target=path.join(root,'data/clinical-fixture.sqlite')
if(existsSync(target)){console.log('Clinical synthetic fixture already exists.');process.exit(0)}
const seed=spawnSync(process.execPath,[path.join(root,'scripts/create-demo-data.mjs')],{cwd:root,stdio:'inherit'})
if(seed.status)process.exit(seed.status)
const original=new DatabaseSync(path.join(root,'data/synthetic.sqlite'),{readOnly:true})
if(original.prepare('SELECT source_filename FROM _source_workbook').get().source_filename!=='SYNTHETIC-DEMO')throw new Error('Refusing to seed clinical tests from a non-demo database.')
original.close()
copyFileSync(path.join(root,'data/synthetic.sqlite'),target)
const db=new DatabaseSync(target)
const quote=text=>`"${text.replaceAll('"','""')}"`
function replaceForm(id,headers,records){
 const table=`sheet_${String(id).padStart(2,'0')}`
 const name=db.prepare('SELECT sheet_name FROM _sheets WHERE sheet_index=?').get(id).sheet_name
 db.exec(`DROP TABLE ${table};CREATE TABLE ${table} (__source_row INTEGER NOT NULL,${headers.map(header=>quote(header)+' TEXT').join(',')})`)
 db.prepare('DELETE FROM _columns WHERE sheet_index=?').run(id)
 db.prepare('DELETE FROM excel_cells WHERE sheet_index=?').run(id)
 headers.forEach((header,j)=>db.prepare('INSERT INTO _columns VALUES (?,?,?,?,?,?,?)').run(id,table,j+1,String.fromCharCode(65+j),header,header,'TEXT'))
 records.forEach((row,i)=>{
  db.prepare(`INSERT INTO ${table} VALUES (${Array(headers.length+1).fill('?').join(',')})`).run(i+2,...row)
  row.forEach((v,j)=>db.prepare('INSERT INTO excel_cells VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,name,table,i+2,j+1,`${String.fromCharCode(65+j)}${i+2}`,headers[j],v,'str',null,null))
 })
 db.prepare('UPDATE _sheets SET max_column=?,data_rows_imported=?,non_empty_cells=? WHERE sheet_index=?').run(headers.length,records.length,records.flat().filter(v=>v!==null&&v!=='').length,id)
}
const labHeaders=['病例编号','访视名称','检查名称','采集日期','检查结果','单位','参考值下限','参考值上限']
replaceForm(13,labHeaders,[['01-001','C1','白细胞计数WBC','2026-09-01','5','10^9/L','4','10'],['01-001','C2','白细胞计数WBC','2026-09-08','3','x10^9/L','4','10']])
replaceForm(15,labHeaders,[
 ['01-001','C1','肌酐Cr','2026-09-01','90','μmol/L','50','110'],
 ['01-001','C2','肌酐Cr','2026-09-08','130','μmol/L','50','110'],
 ['01-001','C2','肌酐Cr','2026-09-08','<10','μmol/L','50','110'],
 ['01-001','C3','肌酐Cr','2026-02-30','105','μmol/L','50','110'],
 ['01-001','C3','肌酐Cr','2026-09-15','1.1','mg/dL','0.5','1.2'],
 ['01-002','C1','肌酐Cr','2026-09-01','200','μmol/L','50','110']
])
replaceForm(34,['病例编号','访视名称','距离最后一次用药时间','日期','时间','MTX血浓度（μmol/L）','当天入液量（ml）','当天出液量（ml）'],[
 ['01-001','C1','0h','2026-09-01','09:00','12','2000','1800'],
 ['01-001','C1','24h','2026-09-02','09:00','1.2','2000','2100'],
 ['01-001','C1','48h','2026-09-03','09:00','<0.1','',''],
 ['01-001','C1','降至<0.15μmol/L时间（天）','2026-09-04','','3','',''],
 ['01-001','C2','24h','2026-09-09','09:00','2.1','2000','1900']
])
replaceForm(35,['病例编号','访视名称','解救药物','起始剂量（mg）','用药开始日期','用药结束日期'],[['01-001','C1','Synthetic rescue medication','15','2026-09-02','2026-09-04']])
replaceForm(36,['病例编号','访视名称','药品名称','使用剂量','剂量单位','治疗日期'],[['01-001','C1','Synthetic study medication','100','mg','2026-09-01']])
replaceForm(37,['病例编号','访视名称','药品名称','单次剂量','单位','本治疗周期开始服药日期','本治疗周期结束服药日期'],[['01-001','C1','Synthetic oral medication','10','mg','2026-09-01','2026-09-05']])
replaceForm(29,['病例编号','访视名称','评估日期','部位','最长垂径乘积（mm2）','靶病灶最长垂径乘积之和'],[['01-001','C1','2026-09-01','Synthetic site A','200','500'],['01-001','C1','2026-09-01','Synthetic site B','300','500']])
replaceForm(39,['病例编号','访视名称','是否评估','评估日期','评估结果','评估依据'],[['01-001','C1','是','','','']])
replaceForm(31,['病例编号','访视名称','Synthetic inclusion criterion','Synthetic exclusion criterion'],[['01-001','Screening','是','']])
replaceForm(45,['病例编号','访视名称','不良事件名称（标准医学术语）','发生日期','结束日期','CTCAE 分级','是否SAE','转归'],[['01-001','C1','Synthetic nausea','2026-09-03','','2级','否','Not recorded']])
db.prepare('UPDATE _source_workbook SET source_filename=?,source_path=?').run('CLINICAL-SYNTHETIC-DEMO','clinical-synthetic-generator')
db.close()
console.log('Created richer wholly synthetic clinical fixture. Historical 50-case fixture remains unchanged.')
