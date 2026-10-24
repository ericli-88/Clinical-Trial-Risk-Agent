import test from 'node:test'
import assert from 'node:assert/strict'
import {CLINICAL_ATOMS,executeClinicalAtom,validateClinicalCall,numericObservation,sourceDate,canonicalUnit,getClinicalPlannerContext} from './clinicalTools.js'
import {buildCrcPlannerMessages} from './clinicalPlanner.js'
const run=(name,args={})=>executeClinicalAtom({name,args})

test('numeric and date parsing preserve qualified values, zero and impossible dates',()=>{
 assert.deepEqual(numericObservation('<0.1'),{value:.1,qualifier:'<',raw:'<0.1'})
 assert.equal(numericObservation('0').value,0)
 assert.equal(numericObservation('Not done').value,null)
 assert.equal(numericObservation('1,234').value,null)
 assert.equal(sourceDate('2026-02-30'),null)
 assert.equal(sourceDate('2024/2/29'),'2024-02-29')
 assert.equal(canonicalUnit('x10^9/L'),canonicalUnit('×10^9/L'))
})
test('clinical schema is discovered without participant records',()=>{
 const result=run('schema_catalog',{formId:15}).result
 assert.ok(result.analytes.includes('肌酐Cr'))
 assert.ok(result.schema[0].roles.includes('analyte'))
 const metadata=JSON.stringify(getClinicalPlannerContext())
 assert.ok(!metadata.includes('01-001')&&!metadata.includes('Synthetic nausea'))
})
test('lab plots separate units and exclude qualified values and invalid dates',()=>{
 const {result,queries}=run('lab_trend',{subjectId:'01-001',formId:15,analyte:'creatinine'})
 assert.equal(result.rows.length,5)
 assert.equal(result.visuals.length,2)
 assert.equal(result.visuals.flatMap(v=>v.data.flatMap(s=>s.points)).length,3)
 assert.ok(result.rows.every(row=>row.subject==='01-001'))
 assert.ok(queries.some(q=>q.sql.includes('=?')&&q.parameters.includes('01-001')))
 assert.equal(run('lab_trend',{subjectId:'01-001',formId:15,analyte:'creatinine',display:'table'}).result.visuals.length,0)
})
test('reference review uses stored row-specific ranges without grading qualified values',()=>{
 const {result}=run('lab_reference_review',{subjectId:'01-001',formId:15,analyte:'creatinine'})
 assert.equal(result.rows.filter(r=>r.flag==='Above stored range').length,1)
 assert.equal(result.rows.find(r=>r.qualifier).flag,'Not comparable')
 assert.ok(!result.answer.includes('Grade 3'))
})
test('MTX hour plots separate cycles and exclude summary-day rows and qualified concentrations',()=>{
 const {result}=run('mtx_concentration_review',{subjectId:'01-001'})
 assert.equal(result.rows.length,5)
 assert.equal(result.visuals[0].data.length,2)
 assert.equal(result.visuals[0].data.flatMap(s=>s.points).length,3)
 assert.equal(result.rows[0].recorded_balance_ml,200)
 assert.equal(result.rows[2].recorded_balance_ml,null)
 assert.equal(run('mtx_concentration_review',{subjectId:'01-001',visit:'C1'}).result.rows.length,4)
})
test('rescue review keeps source streams separate rather than multiplying join rows',()=>{
 const {result}=run('mtx_rescue_review',{subjectId:'01-001',visit:'C1'})
 assert.equal(result.rows.length,5)
 assert.equal(result.rows.filter(r=>r.stream==='Rescue medication').length,1)
})
test('timeline and medication tools preserve unknown ends and actual source dates',()=>{
 assert.ok(run('participant_timeline',{subjectId:'01-001'}).result.rows.length>0)
 assert.equal(run('treatment_history',{subjectId:'01-001'}).result.rows.length,2)
 const med=run('medication_timeline',{subjectId:'01-001'}).result.rows
 assert.equal(med.length,2)
 assert.equal(med.filter(r=>r.end===null).length,1)
})
test('AE review uses recorded grades and flags, not an inferred ongoing diagnosis',()=>{
 const {result}=run('ae_followup_review',{subjectId:'01-001'})
 assert.equal(result.rows[0].recorded_grade,'2级')
 assert.equal(result.rows[0].recorded_sae,'否')
 assert.match(result.answer,/does not prove/)
})
test('eligibility, follow-up and response tools expose blank values without outcome claims',()=>{
 assert.equal(run('eligibility_record_review',{subjectId:'01-001'}).result.rows.filter(r=>r.recorded_response==='Not recorded').length,1)
 assert.equal(run('followup_coverage',{subjectId:'01-001'}).result.rows.find(r=>r.form===41).count,0)
 assert.equal(run('response_assessment_review',{subjectId:'01-001'}).result.rows[0].recorded_response,'Not recorded')
})
test('matrix counts existing long-form records, lesion display does not sum repeated visit totals',()=>{
 const {result}=run('visit_form_matrix',{subjectId:'01-001',formIds:[15,34]})
 assert.equal(result.rows.find(r=>r.form===15&&r.visit==='C2').count,2)
 assert.equal(result.visuals[0].kind,'heatmap')
 const lesions=run('lesion_measurement_review',{subjectId:'01-001'}).result
 assert.equal(lesions.visuals[0].kind,'scatter')
 assert.deepEqual(lesions.rows.map(r=>r.numeric),[200,300])
 assert.equal(run('enrollment_summary').result.rows.reduce((n,r)=>n+r.count,0),6)
})
test('unknown IDs, fields, unsafe chart conversions and unexpected parameters are rejected',()=>{
 assert.throws(()=>run('lab_trend',{subjectId:'99-999',formId:15,analyte:'creatinine'}))
 assert.throws(()=>run('lab_trend',{subjectId:'01-001',formId:15,analyte:'imagined marker'}))
 assert.throws(()=>validateClinicalCall({name:'lab_trend',args:{subjectId:'01-001',formId:15,analyte:'creatinine',display:'bar'}}))
 assert.throws(()=>validateClinicalCall({name:'enrollment_summary',args:{groupBy:'arm'}}))
 assert.throws(()=>validateClinicalCall({name:'visit_form_matrix',args:{subjectId:'01-001',formIds:[15,15]}}))
})
test('planner prompt distinguishes intents, scope, unavailable rules and chart ownership',()=>{
 const prompt=buildCrcPlannerMessages('Show creatinine for 01-001',CLINICAL_ATOMS,getClinicalPlannerContext())
 assert.ok(prompt[0].content.includes('minimum set'))
 assert.ok(prompt[0].content.includes('No toxicity threshold'))
 assert.ok(prompt[0].content.includes('not from model-invented numbers')||prompt[0].content.includes('never from model-invented numbers'))
 assert.ok(!prompt[0].content.includes('Synthetic nausea'))
 assert.equal(prompt[1].role,'user')
})
