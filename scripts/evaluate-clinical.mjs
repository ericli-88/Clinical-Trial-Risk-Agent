import {writeFileSync} from 'node:fs'
import {parseEvents} from '../src/evaluation/score.js'
const base=process.env.CLINICAL_AGENT_URL||'http://127.0.0.1:3003'
const health=await(await fetch(base+'/health')).json()
if(!health.synthetic)throw new Error('Clinical evaluation only runs against the rich synthetic fixture.')
const cases=[
 ['schema_catalog','Show the available fields and analyte labels in chemistry form 15.',null],
 ['enrollment_summary','Count stored enrollment records by enrollment status.','bar'],
 ['participant_timeline','Show a timeline of recorded visits, consent, treatment and safety dates for 01-001.','timeline'],
 ['lab_trend','Show the creatinine trend for 01-001 from chemistry form 15.','line'],
 ['lab_reference_review','Compare creatinine records for 01-001 in form 15 against their stored reference limits.','bar'],
 ['mtx_concentration_review','Plot the recorded MTX concentrations versus hours since dose for 01-001, keeping cycles separate.','line'],
 ['mtx_rescue_review','Review MTX observations alongside rescue-medication records for 01-001. Do not recommend a dose.','timeline'],
 ['treatment_history','Show induction study-drug and oral study-medication history for 01-001.','timeline'],
 ['ae_followup_review','Review recorded CTCAE grades and SAE flags for adverse events in 01-001.','bar'],
 ['medication_timeline','Show the concomitant medication timeline for 01-001, leaving unknown end dates unknown.','timeline'],
 ['eligibility_record_review','Review the stored eligibility checklist responses for 01-001 without deciding final eligibility.',null],
 ['followup_coverage','Show stored response, PFS, OS and completion form coverage for 01-001. Do not estimate survival.','bar'],
 ['visit_form_matrix','Show an existing-records heatmap by visit for forms 15 and 34 for 01-001.','heatmap'],
 ['lesion_measurement_review','Plot stored target-lesion products over assessment dates for 01-001; do not infer response.','scatter'],
 ['response_assessment_review','Inspect the stored response assessment result and date for 01-001, including missing fields.',null]
]
const results=[]
for(const [expectedTool,question,kind] of cases){
 const start=Date.now()
 const response=await fetch(base+'/api/crc/agent-stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question}),signal:AbortSignal.timeout(190000)})
 const events=parseEvents(await response.text())
 const calls=events.filter(e=>e.event==='trace'&&e.data.stage==='tool-start').map(e=>({name:e.data.tool,args:e.data.parameters}))
 const charts=events.filter(e=>e.event==='visuals').flatMap(e=>e.data)
 const done=events.find(e=>e.event==='done')?.data
 const modelSelected=events.some(e=>e.event==='trace'&&e.data.stage==='plan'&&e.data.selection==='model')
 const passed=calls.length===1&&calls[0].name===expectedTool&&done?.ok&&modelSelected&&(kind?charts.some(c=>c.kind===kind):charts.length===0)
 results.push({question,expectedTool,expectedVisual:kind,passed:Boolean(passed),modelSelected,provider:done?.selection,calls,charts,answer:events.filter(e=>e.event==='token').map(e=>e.data).join(''),durationMs:Date.now()-start})
 console.log(`${passed?'PASS':'FAIL'} ${expectedTool}: ${calls.map(c=>c.name).join(', ')}; visuals=${charts.map(c=>c.kind).join(',')}`)
}
writeFileSync('docs/evaluation/clinical-model-results.json',JSON.stringify({recordedAt:new Date().toISOString(),fixture:'Rich wholly synthetic clinical fixture; not private workbook records',note:'15 development smoke cases, one per new atom. Checks tool selection, completion and chart kind; not medical interpretation quality.',passed:results.filter(r=>r.passed).length,total:results.length,results},null,2)+'\n')
if(results.some(r=>!r.passed))process.exitCode=1
