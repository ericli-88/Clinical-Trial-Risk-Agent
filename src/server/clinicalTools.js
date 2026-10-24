import { DatabaseSync } from 'node:sqlite'
import { getDatabasePath } from './data_access/edcDatabase.js'
import { captureSql, prepareReadOnly } from './sqlTrace.js'

// Clinical field roles come from source metadata. Values and identities never enter the planner catalog.
const LAB_FORMS = [13,14,15,16,17,22,26,27]
const aliases = {
  subject: ['病例编号','受试者筛选编号'], visit:['访视名称','Visit'], site:['中心编号','Site'],
  analyte:['检查名称','Analyte'], value:['检查结果','Result'], unit:['单位','Unit'],
  collected:['采集日期','Collection date'], lower:['参考值下限','Lower limit'], upper:['参考值上限','Upper limit'],
  mtx:['MTX血浓度（μmol/L）','MTX concentration'], hours:['距离最后一次用药时间','Hours since dose'], date:['日期','Date'], time:['时间','Time'],
  event:['不良事件名称（标准医学术语）','Event term'], onset:['发生日期','Onset date'], end:['结束日期','Resolution date','End date'],
  grade:['CTCAE 分级','Grade'], sae:['是否SAE','Serious event'], outcome:['转归','Outcome'],
  drug:['药名','Medication','药品名称','解救药物'], start:['开始日期','用药开始日期','本治疗周期开始服药日期','Start date'],
  drugEnd:['结束日期','用药结束日期','本治疗周期结束服药日期','End date'], dose:['每次用药剂量','使用剂量','单次剂量','起始剂量（mg）','Dose'],
  doseUnit:['剂量单位','单位','Dose unit'], ongoing:['现在是否仍在使用','Ongoing'],
  treatmentDate:['治疗日期','Treatment date'], enrolled:['受试者是否成功入组','Enrolled'], arm:['试验组别','Arm'],
  signed:['签署日期','Consent date'], randomized:['随机日期','Randomization date'], actualVisit:['访视日期','Actual date'],
  delay:['是否延迟下一治疗周期？','Delayed'], delayDays:['延迟天数（天）','Delay days'],
  intake:['当天入液量（ml）','Intake ml'], output:['当天出液量（ml）','Output ml'],
  assessed:['是否评估','Assessed'], assessmentDate:['评估日期','Assessment date'], response:['评估结果','Response'],
  lesionSite:['部位','Lesion site'], lesionProduct:['最长垂径乘积（mm2）','Product mm2'],
  assessmentReason:['评估依据','Assessment basis']
}
const analyteAliases = { creatinine:['肌酐Cr','Creatinine'], wbc:['白细胞计数WBC','WBC'], platelets:['血小板PLT','Platelets'], hemoglobin:['血红蛋白Hb','Hemoglobin'], neutrophils:['中性粒细胞计数Neu','Neutrophils'], alt:['谷丙转氨酶ALT','ALT'], ast:['谷草转氨酶AST','AST'], egfr:['eGFR'], albumin:['白蛋白ALB','Albumin'], bilirubin:['总胆红素TBIL','Total bilirubin'] }

export const CLINICAL_ATOMS = [
  { name:'schema_catalog', purpose:'Discover actual form fields, field roles and available lab analyte labels, without participant records.', parameters:{formId:'optional integer 1–46'}, displays:['table'] },
  { name:'enrollment_summary', purpose:'Count enrollment records by stored enrollment status or site. Counts are records, not unique randomized participants.', parameters:{groupBy:'enrollment_status or site; default enrollment_status'}, displays:['bar','table'] },
  { name:'participant_timeline', purpose:'Chronological source dates for one subject across visits, consent, randomization, treatment and safety events.', parameters:{subjectId:'required'}, displays:['timeline','table'] },
  { name:'lab_trend', purpose:'Numeric lab measurements over collection dates. Separate units; preserve qualified values and reference limits in source rows.', parameters:{subjectId:'required',formId:'required laboratory form ID',analyte:'required exact label or English alias creatinine/wbc/platelets/hemoglobin/neutrophils/alt/ast/egfr/albumin/bilirubin',visit:'optional exact visit label'}, displays:['line','table'] },
  { name:'lab_reference_review', purpose:'Compare parseable numeric laboratory values with their row-specific stored reference bounds; not CTCAE grading.', parameters:{formId:'required laboratory form ID',subjectId:'optional',analyte:'optional exact label or English alias'}, displays:['bar','table'] },
  { name:'mtx_concentration_review', purpose:'Review MTX observations within each visit/cycle. Only explicit hour labels enter numeric-hour plots; time-to-threshold rows stay separate. No dose advice or clearance threshold inference.', parameters:{subjectId:'required',visit:'optional exact visit label'}, displays:['line','scatter','table'] },
  { name:'mtx_rescue_review', purpose:'Retrieve MTX and rescue-medication evidence separately by exact subject/optional visit. Never create a many-to-many inferred dose-to-sample join.', parameters:{subjectId:'required',visit:'optional exact visit label'}, displays:['timeline','table'] },
  { name:'treatment_history', purpose:'Review recorded induction regimen and oral study-drug dates, doses and adjustments. No adherence percentage or prescribing.', parameters:{subjectId:'required',visit:'optional exact visit label'}, displays:['timeline','table'] },
  { name:'ae_followup_review', purpose:'Review recorded AE terms, CTCAE grades, SAE flags and unresolved end dates. Never derive seriousness or causality.', parameters:{subjectId:'required'}, displays:['bar','timeline','table'] },
  { name:'medication_timeline', purpose:'Review concomitant medication intervals; retain unknown end dates and ongoing status rather than inventing an end date.', parameters:{subjectId:'required'}, displays:['timeline','table'] },
  { name:'eligibility_record_review', purpose:'List recorded eligibility criterion responses and blanks. No final eligibility determination or reinterpretation of inclusion/exclusion rules.', parameters:{subjectId:'required'}, displays:['table'] },
  { name:'followup_coverage', purpose:'Count available consolidation, response, PFS, OS, death-report and completion rows; no efficacy or survival estimates.', parameters:{subjectId:'optional'}, displays:['bar','table'] },
  { name:'visit_form_matrix', purpose:'Count existing records by exact subject + visit + form. Heatmap cells are record counts, not expected/overdue visits.', parameters:{subjectId:'required',formIds:'optional array of 1–8 distinct form IDs; default 2,13,15,34,35,45'}, displays:['heatmap','table'] }
  ,{ name:'lesion_measurement_review', purpose:'Review stored target-lesion products by date and site. No repeated-sum aggregation, inferred lesion matching, response classification or efficacy claim.', parameters:{subjectId:'required'}, displays:['scatter','table'] }
  ,{ name:'response_assessment_review', purpose:'Inspect stored response-assessment status, result and date. Missing outcome fields remain unavailable, not failed treatment.', parameters:{subjectId:'required'}, displays:['table'] }
].map(atom => ({...atom, parameters:{...atom.parameters, display:`optional auto or ${atom.displays.join('/')}; default auto`}}))

let connection
const db = () => connection ||= new DatabaseSync(getDatabasePath(), {readOnly:true})
const quote = value => `"${String(value).replaceAll('"','""')}"`
const all = (sql, params=[]) => prepareReadOnly(db(),sql).all(...params)
const text = value => String(value ?? '').trim()
const blank = value => value === null || value === undefined || text(value) === ''
const source = (formId,row) => `Form ${formId} · Excel row ${row.__source_row}`
const subjectOK = value => typeof value === 'string' && /^(?:\d{2}-\d{3}|\d{5,7})$/.test(value)
const specs = new Map(CLINICAL_ATOMS.map(atom=>[atom.name,atom]))

export function numericObservation(raw) {
  const value=text(raw).replaceAll('−','-')
  const match=value.match(/^([<>≤≥]=?)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i)
  if (!match || !Number.isFinite(Number(match[2]))) return {value:null,qualifier:null,raw:text(raw)}
  return {value:Number(match[2]),qualifier:match[1] || null,raw:text(raw)}
}
export function sourceDate(raw) {
  const match=text(raw).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/)
  if(!match) return null
  const [,year,month,day]=match.map(Number)
  const date=new Date(Date.UTC(year,month-1,day))
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? date.toISOString().slice(0,10) : null
}
// Normalize typography only. Never convert concentrations, mass units or denominators implicitly.
export function canonicalUnit(raw) { return text(raw).replace(/[×xX*]/g,'×').replaceAll('µ','μ').replaceAll(' ','') || 'Unit not recorded' }

function form(formId) {
  const sheet=all('SELECT sheet_index,sheet_name,table_name FROM _sheets WHERE sheet_index=?',[formId])[0]
  if(!sheet) throw new Error('Requested form is unavailable.')
  const columns=all('SELECT original_header,sqlite_column_name FROM _columns WHERE sheet_index=? ORDER BY excel_column_index',[formId])
  const roles=Object.fromEntries(Object.entries(aliases).map(([role,labels])=>[role,columns.find(c=>labels.includes(c.original_header))?.sqlite_column_name]))
  return {...sheet,columns,roles}
}
function readForm(formId,args={},required=[]) {
  const metadata=form(formId)
  for(const role of required) if(!metadata.roles[role]) throw new Error(`Form ${formId} has no mapped ${role} field. Inspect schema_catalog before querying.`)
  const where=[],params=[]
  for(const [key,role] of [['subjectId','subject'],['visit','visit']]) {
    if(args[key]!==undefined) {
      if(!metadata.roles[role]) throw new Error(`Form ${formId} cannot safely filter ${key}.`)
      where.push(`${quote(metadata.roles[role])}=?`);params.push(args[key])
    }
  }
  const sql=`SELECT * FROM ${quote(metadata.table_name)}${where.length?' WHERE '+where.join(' AND '):''} ORDER BY __source_row`
  const rows=all(sql,params).filter(row=>!metadata.roles.subject || subjectOK(text(row[metadata.roles.subject])))
  return {...metadata,rows}
}
function value(data,row,role) { return data.roles[role] ? row[data.roles[role]] : null }
function ensureSubject(subjectId) {
  if(!subjectId) return
  const found=all(`SELECT 1 AS found FROM excel_cells WHERE column_header IN ('病例编号','受试者筛选编号') AND value_text=? LIMIT 1`,[subjectId])
  if(!found.length) throw new Error('Subject ID is not present in this snapshot; no alternative participant was selected.')
}
export function validateClinicalCall(call) {
  const spec=specs.get(call?.name)
  if(!spec) throw new Error('Unknown clinical tool.')
  const args=call.args || {}
  if(typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!Object.hasOwn(spec.parameters,key))) throw new Error('Unexpected clinical tool parameters.')
  for(const [key,description] of Object.entries(spec.parameters)) if(description.startsWith('required') && (args[key]===undefined||args[key]===null||args[key]==='')) throw new Error(`Missing required ${key}.`)
  if(args.subjectId!==undefined&&!subjectOK(args.subjectId)) throw new Error('A complete exact subject ID is required.')
  if(args.formId!==undefined&&(!Number.isInteger(args.formId)||args.formId<1||args.formId>46)) throw new Error('formId must be an integer 1–46.')
  if(['lab_trend','lab_reference_review'].includes(call.name)&&!LAB_FORMS.includes(args.formId)) throw new Error('Select a laboratory form: 13,14,15,16,17,22,26 or 27.')
  for(const key of ['analyte','visit']) if(args[key]!==undefined&&(typeof args[key]!=='string'||!args[key].trim()||args[key].length>160)) throw new Error(`Invalid ${key}.`)
  if(args.formIds!==undefined&&(!Array.isArray(args.formIds)||args.formIds.length<1||args.formIds.length>8||new Set(args.formIds).size!==args.formIds.length||args.formIds.some(id=>!Number.isInteger(id)||id<1||id>46))) throw new Error('Select 1–8 distinct form IDs.')
  if(args.groupBy!==undefined&&!['site','enrollment_status'].includes(args.groupBy)) throw new Error('groupBy must be site or enrollment_status; treatment arms are not inferred or compared.')
  if(args.display!==undefined&&!['auto',...spec.displays].includes(args.display)) throw new Error(`This task supports ${spec.displays.join(', ')} displays.`)
  return {name:call.name,args}
}

function grouped(rows,key) {
  const groups=new Map()
  for(const row of rows) { const label=text(row[key])||'Not recorded';groups.set(label,(groups.get(label)||0)+1) }
  return [...groups].map(([label,count])=>({label,count}))
}
function visual(kind,title,data,extra={}) {return {kind,title,data,...extra}}
function limitResult(answer,rows,visuals=[],note='') {
  return {answer:answer+`\n\nShowing ${Math.min(rows.length,100)} of ${rows.length} result rows.`+(note?'\n\n'+note:''), rows:rows.slice(0,100), visuals,
    evidence:[{label:'Dataset',value:process.env.EDC_DEMO==='true'?'Synthetic EDC demonstration':'Private local workbook snapshot'},{label:'Result rows before display limit',value:String(rows.length)},{label:'Provenance',value:'Original form IDs and Excel source row numbers are retained.'}]}
}
function selectAnalyte(data,args) {
  if(!args.analyte) return data.rows
  const candidates=analyteAliases[args.analyte.toLowerCase()]||[args.analyte]
  const matches=data.rows.filter(row=>candidates.some(label=>text(value(data,row,'analyte')).toLowerCase()===label.toLowerCase()))
  if(!matches.length) throw new Error('No exact analyte label matched this scope. Use schema_catalog to inspect available analytes; no fuzzy match was substituted.')
  return matches
}
function labRows(data,args) {
  return selectAnalyte(data,args).map(row=>{
    const observation=numericObservation(value(data,row,'value'))
    const low=numericObservation(value(data,row,'lower')), high=numericObservation(value(data,row,'upper'))
    const comparable=observation.value!==null&&!observation.qualifier
    const lower=low.value!==null&&!low.qualifier?low.value:null, upper=high.value!==null&&!high.qualifier?high.value:null
    const flag=!comparable?'Not comparable':lower!==null&&upper!==null&&lower>upper?'Invalid reference bounds':lower!==null&&observation.value<lower?'Below stored range':upper!==null&&observation.value>upper?'Above stored range':lower!==null&&upper!==null?'Within stored range':'Insufficient bounds'
    return {subject:text(value(data,row,'subject')),visit:text(value(data,row,'visit')),analyte:text(value(data,row,'analyte')),date:sourceDate(value(data,row,'collected')),source_date:text(value(data,row,'collected')),result:observation.raw,numeric:observation.value,qualifier:observation.qualifier,unit:canonicalUnit(value(data,row,'unit')),lower,upper,flag,source:source(data.sheet_index,row)}
  })
}
function lineSeries(rows,groupKey,x,y) {
  const groups=new Map()
  for(const row of rows) {
    if(row[x]===null||row[x]===undefined||row[y]===null||row[y]===undefined||row.qualifier) continue
    const key=groupKey(row)
    if(!groups.has(key))groups.set(key,[])
    groups.get(key).push({x:row[x],y:row[y],source:row.source,raw:row.result})
  }
  return [...groups].map(([label,points])=>({label,points:points.sort((a,b)=>String(a.x).localeCompare(String(b.x),undefined,{numeric:true}))}))
}
function medicationRows(data) {
  return data.rows.map(row=>({subject:text(value(data,row,'subject')),visit:text(value(data,row,'visit')),drug:text(value(data,row,'drug'))||'Drug not recorded',start:sourceDate(value(data,row,'start'))||sourceDate(value(data,row,'treatmentDate')),end:sourceDate(value(data,row,'drugEnd')),pointEvent:!data.roles.drugEnd,dose:text(value(data,row,'dose')),unit:text(value(data,row,'doseUnit')),ongoing:text(value(data,row,'ongoing')),source:source(data.sheet_index,row)}))
}

function execute(call) {
  const {name,args}=validateClinicalCall(call)
  ensureSubject(args.subjectId)
  if(name==='schema_catalog') {
    const sheets=all('SELECT sheet_index,sheet_name FROM _sheets'+(args.formId?' WHERE sheet_index=?':''),args.formId?[args.formId]:[])
    const rows=[]
    for(const sheet of sheets) {
      const data=form(sheet.sheet_index)
      for(const col of data.columns) rows.push({form:sheet.sheet_index,field:col.original_header,role:Object.entries(data.roles).find(([,column])=>column===col.sqlite_column_name)?.[0]||'Source field'})
    }
    // Header discovery is returned separately and never discarded by the 100-row presentation cap.
    const result=limitResult(`Discovered ${sheets.length} forms and ${rows.length} source fields. Header metadata is not participant evidence. Use a specific form ID for a shorter field listing.`,rows)
    result.schema=sheets.map(sheet=>{const data=form(sheet.sheet_index);return {formId:sheet.sheet_index,roles:Object.keys(data.roles).filter(key=>data.roles[key]),fields:data.columns.map(c=>c.original_header)}})
    if(args.formId&&LAB_FORMS.includes(args.formId)) {
      const data=form(args.formId)
      if(data.roles.analyte) result.analytes=all(`SELECT DISTINCT ${quote(data.roles.analyte)} AS label FROM ${quote(data.table_name)} WHERE ${quote(data.roles.analyte)} IS NOT NULL`).map(r=>text(r.label)).filter(Boolean)
      result.answer+='\n\nAvailable analyte labels: '+(result.analytes?.join('; ')||'None recorded')
    }
    return result
  }
  if(name==='enrollment_summary') {
    const data=readForm(32,{},['enrolled'])
    const role=args.groupBy==='site'?'site':'enrolled'
    if(!data.roles[role])throw new Error('Requested enrollment grouping is not mapped.')
    const rows=grouped(data.rows,data.roles[role])
    return limitResult(`Grouped ${data.rows.length} enrollment records by ${role==='site'?'site':'stored enrollment status'}. These are record counts, not deduplicated enrollment totals or arm efficacy comparisons.`,rows,[visual('bar','Enrollment records by '+(role==='site'?'site':'stored status'),rows)])
  }
  if(name==='lab_trend'||name==='lab_reference_review') {
    const data=readForm(args.formId,args,['analyte','value','unit','collected'])
    const rows=labRows(data,args)
    if(name==='lab_reference_review')return limitResult(`Compared ${rows.length} stored lab records with their own reference limits. Out-of-range flags do not establish CTCAE grade, causality or a treatment decision.`,rows,[visual('bar','Stored reference-range review',grouped(rows,'flag'))])
    const eligible=rows.filter(row=>row.unit!=='Unit not recorded')
    const series=lineSeries(eligible,r=>`${r.analyte} · ${r.unit}`,'date','numeric')
    const panels=[...new Set(eligible.map(r=>r.unit))].map(unit=>visual('line',`${args.analyte} over collection dates`,series.filter(s=>s.label.endsWith(' · '+unit)),{unit,xLabel:'Collection date',yLabel:unit})).filter(panel=>panel.data.some(series=>series.points.length))
    const plotted=series.reduce((sum,s)=>sum+s.points.length,0)
    return limitResult(`Retrieved ${rows.length} laboratory observations; ${plotted} numeric dated points with recorded units can be plotted. Unit typography is normalized; no unit conversion, averaging or CTCAE grading was performed. Qualified values, missing dates and missing units remain in the evidence table rather than becoming exact plotted measurements.`,rows,panels)
  }
  if(name==='mtx_concentration_review'||name==='mtx_rescue_review') {
    const data=readForm(34,args,['mtx','hours','date'])
    const rows=data.rows.map(row=>{
      const observation=numericObservation(value(data,row,'mtx'))
      const label=text(value(data,row,'hours'));const hour=label.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hours?|小时)$/i)
      const intake=numericObservation(value(data,row,'intake')),output=numericObservation(value(data,row,'output'))
      return {subject:args.subjectId,visit:text(value(data,row,'visit')),relative_time_label:label,hours:hour?Number(hour[1]):null,date:sourceDate(value(data,row,'date')),time:text(value(data,row,'time')),result:observation.raw,numeric:observation.value,qualifier:observation.qualifier,unit:'μmol/L',recorded_balance_ml:intake.value!==null&&!intake.qualifier&&output.value!==null&&!output.qualifier?intake.value-output.value:null,source:source(34,row)}
    })
    if(name==='mtx_rescue_review') {
      const rescue=readForm(35,args,['drug','start'])
      const medications=medicationRows(rescue)
      return limitResult(`Retrieved ${rows.length} MTX observation rows and ${medications.length} rescue-medication rows by exact subject${args.visit?' and visit':''}. They are separate source streams, not a dose-to-sample causal join. No rescue dose or timing recommendation was calculated.`,[...rows.map(r=>({stream:'MTX',...r})),...medications.map(r=>({stream:'Rescue medication',...r}))],[visual('timeline','Recorded rescue-medication dates',medications)])
    }
    const series=lineSeries(rows,r=>r.visit||'Visit not recorded','hours','numeric')
    const plotted=series.reduce((n,s)=>n+s.points.length,0)
    return limitResult(`Retrieved ${rows.length} MTX source rows. ${plotted} points have explicit hour labels and unqualified numeric concentrations. Time-to-threshold summary rows are excluded from the hour plot. Curves remain separate by visit/cycle; no toxicity threshold, clearance diagnosis or dose advice is inferred.`,rows,[visual(args.display==='scatter'?'scatter':'line','MTX concentrations by recorded hours',series,{unit:'μmol/L',xLabel:'Hours since last dose (source label)',yLabel:'μmol/L'})])
  }
  if(name==='treatment_history'||name==='medication_timeline') {
    const ids=name==='treatment_history'?[36,37]:[44]
    const rows=ids.flatMap(id=>medicationRows(readForm(id,args,['drug'])))
    return limitResult(`Retrieved ${rows.length} medication/treatment records. Unknown end dates remain unknown. Stored doses are reproduced, not prescribed. Tablet counts alone do not establish adherence.`,rows,[visual('timeline','Recorded medication and treatment dates',rows)])
  }
  if(name==='ae_followup_review') {
    const data=readForm(45,args,['event'])
    const rows=data.rows.filter(row=>!blank(value(data,row,'event'))).map(row=>({subject:args.subjectId,visit:text(value(data,row,'visit')),event:text(value(data,row,'event')),start:sourceDate(value(data,row,'onset')),end:sourceDate(value(data,row,'end')),recorded_grade:text(value(data,row,'grade'))||'Not recorded',recorded_sae:text(value(data,row,'sae'))||'Not recorded',outcome:text(value(data,row,'outcome')),source:source(45,row)}))
    return limitResult(`Reviewed ${rows.length} named adverse-event records. ${rows.filter(r=>!r.end).length} have no parseable stored end date. Grades and SAE flags are recorded fields, not new assessments; an absent end date does not prove an event is ongoing.`,rows,[args.display==='timeline'?visual('timeline','Recorded adverse-event dates',rows.map(r=>({...r,drug:r.event}))):visual('bar','Recorded adverse-event grades',grouped(rows,'recorded_grade'))])
  }
  if(name==='eligibility_record_review') {
    const data=readForm(31,args,['subject'])
    const metadata=new Set(['项目编号','项目','中心编号','中心名称','病例编号','患者姓名缩写','受试者姓名缩写','访视名称','版本'])
    const rows=data.rows.flatMap(row=>data.columns.filter(c=>!metadata.has(c.original_header)).map(c=>({visit:text(value(data,row,'visit')),criterion:c.original_header,recorded_response:text(row[c.sqlite_column_name])||'Not recorded',source:source(31,row)})))
    return limitResult(`Retrieved ${rows.length} criterion-response entries. ${rows.filter(r=>r.recorded_response==='Not recorded').length} are blank. This reviews stored checklist entries; it does not certify eligibility or reinterpret inclusion/exclusion logic.`,rows)
  }
  if(name==='followup_coverage') {
    const labels={38:'Consolidation',39:'Response assessment',41:'PFS follow-up',42:'OS follow-up',43:'Death report',46:'Study completion'}
    const rows=Object.entries(labels).map(([id,label])=>{const data=readForm(Number(id),args);return {label,form:Number(id),count:data.rows.length}})
    return limitResult('Counted stored follow-up form rows. Zero rows mean no records in this snapshot, not overdue visits, absence of death, treatment failure or a survival estimate. Populated rows may still contain blank outcome fields.',rows,[visual('bar','Stored follow-up records',rows)])
  }
  if(name==='visit_form_matrix') {
    const ids=args.formIds||[2,13,15,34,35,45]
    const groups=new Map()
    for(const id of ids) {const data=readForm(id,args,['visit']);for(const row of data.rows){const visit=text(value(data,row,'visit'))||'Visit not recorded';const key=JSON.stringify([visit,id]);if(!groups.has(key))groups.set(key,{visit,form:id,count:0});groups.get(key).count++}}
    const visits=[...new Set([...groups.values()].map(r=>r.visit))]
    const rows=visits.flatMap(visit=>ids.map(formId=>groups.get(JSON.stringify([visit,formId]))||{visit,form:formId,count:0}))
    return limitResult(`Built a ${visits.length}-visit by ${ids.length}-form matrix of existing records. These are long-form record counts, not completeness percentages or missing required visit flags. No expected visit schedule was assumed.`,rows,[visual('heatmap','Existing records by visit and form',rows,{forms:ids,visits})])
  }
  if(name==='participant_timeline') {
    const roles={2:['actualVisit'],3:['signed'],32:['randomized'],36:['treatmentDate'],45:['onset','end']}
    const rows=[];let invalid=0
    for(const [id,dateRoles] of Object.entries(roles)) {
      const data=readForm(Number(id),args)
      for(const row of data.rows)for(const role of dateRoles) {
        const raw=value(data,row,role);if(blank(raw))continue
        const date=sourceDate(raw);if(!date){invalid++;continue}
        rows.push({date,event:role,visit:text(value(data,row,'visit')),source:source(Number(id),row)})
      }
    }
    rows.sort((a,b)=>a.date.localeCompare(b.date))
    return limitResult(`Assembled ${rows.length} recorded date events; excluded ${invalid} unparseable dates. Repeated events are preserved; chronological proximity is not evidence of causality or protocol compliance.`,rows,[visual('timeline','Participant source-event timeline',rows.map(r=>({...r,start:r.date,drug:r.event,pointEvent:true})))])
  }
  if(name==='lesion_measurement_review') {
    const data=readForm(29,args,['lesionProduct','assessmentDate'])
    const rows=data.rows.map(row=>{const observation=numericObservation(value(data,row,'lesionProduct'));return {date:sourceDate(value(data,row,'assessmentDate')),site:text(value(data,row,'lesionSite')),result:observation.raw,numeric:observation.value,qualifier:observation.qualifier,visit:text(value(data,row,'visit')),source:source(29,row)}})
    return limitResult(`Retrieved ${rows.length} target-lesion source rows. Only stored per-lesion products are plotted; repeated visit-total fields are not summed. Without stable lesion identifiers and adjudication rules, points are not connected across visits and no response category is inferred.`,rows,[visual('scatter','Stored target-lesion products',lineSeries(rows,r=>r.site||'Site not recorded','date','numeric'),{unit:'mm²',xLabel:'Assessment date',yLabel:'Recorded product (mm²)'})])
  }
  if(name==='response_assessment_review') {
    const data=readForm(39,args,['response','assessmentDate'])
    const rows=data.rows.map(row=>({subject:args.subjectId,visit:text(value(data,row,'visit')),assessed:text(value(data,row,'assessed')),recorded_response:text(value(data,row,'response'))||'Not recorded',date:sourceDate(value(data,row,'assessmentDate')),basis:text(value(data,row,'assessmentReason'))||'Not recorded',source:source(39,row)}))
    return limitResult(`Retrieved ${rows.length} response-assessment records. ${rows.filter(r=>r.recorded_response==='Not recorded').length} have no stored response result. No response rate, treatment efficacy or failure conclusion is calculated.`,rows)
  }
  throw new Error('Clinical tool is not implemented.')
}

export function executeClinicalAtom(call) {
  const captured=captureSql(()=>execute(call))
  const spec=specs.get(call.name)
  const result=captured.value
  if(call.args?.display==='table')result.visuals=[]
  else if(call.args?.display&&call.args.display!=='auto') for(const chart of result.visuals||[]) {
    // Date/number semantics stay owned by the task; do not coerce data into an incompatible chart.
    if(!spec.displays.includes(call.args.display))throw new Error('Incompatible chart request.')
    chart.kind=call.args.display
  }
  return {name:call.name,args:call.args||{},result,queries:captured.queries}
}

export function getClinicalPlannerContext() {
  const columns=all('SELECT sheet_index,original_header FROM _columns ORDER BY sheet_index,excel_column_index')
  const ids=[2,3,12,13,14,15,16,17,22,24,26,27,29,31,32,34,35,36,37,39,40,41,42,44,45,46]
  return ids.map(formId=>{
    const headers=columns.filter(c=>c.sheet_index===formId).map(c=>c.original_header)
    return {formId,fieldCount:headers.length,mappedRoles:Object.entries(aliases).filter(([,labels])=>labels.some(label=>headers.includes(label))).map(([role])=>role)}
  })
}
