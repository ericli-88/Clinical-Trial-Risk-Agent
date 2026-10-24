import {writeFileSync} from 'node:fs'
import {parseEvents} from '../src/evaluation/score.js'
const base=process.env.SCIENCE_AGENT_URL||'http://127.0.0.1:3004'
if(!(await(await fetch(base+'/health')).json()).synthetic)throw new Error('Only synthetic science evaluation is allowed.')
const cases=[
 ['numeric_distribution','histogram','Show a histogram of the age field in demographics form 4, using the recorded age-unit field.'],
 ['lab_distribution','histogram','Show a histogram of creatinine in chemistry form 15 across the recorded cohort. Keep units separate.'],
 ['lab_distribution','box','Show box plots of creatinine in form 15 grouped by visit, keeping units separate.'],
 ['lab_distribution','ecdf','Show an ECDF of recorded creatinine values from form 15, keeping units separate.'],
 ['lab_distribution','density','Show a KDE density plot of recorded creatinine from form 15; show unavailable if a unit group has fewer than five observations.'],
 ['lab_relationship','scatter','Scatter plot: compare creatinine in μmol/L and ALT in U/L from form 15 for 01-001, paired by exact subject, visit and collection date.'],
 ['lab_relationship','correlation_heatmap','Show a Pearson correlation heatmap of creatinine in μmol/L and ALT in U/L from form 15 for 01-001, with exact date and visit pairing.'],
 ['categorical_summary','bar','Show a bar chart of recorded CTCAE grade counts across all adverse-event rows in form 45.'],
 ['categorical_summary','grouped_bar','Show a grouped bar chart of recorded CTCAE grades split by SAE status in form 45.'],
 ['categorical_summary','stacked_bar','Show a stacked count bar chart of recorded CTCAE grades split by SAE status in form 45.'],
 ['categorical_summary','heatmap','Show a categorical count heatmap of recorded grade by SAE status in form 45.'],
 ['data_missingness_map','heatmap','Show a missing-value heatmap for the result and unit fields in laboratory form 15, grouped by visit.']
]
const results=[]
for(const [tool,kind,question] of cases){
 const started=Date.now()
 const response=await fetch(base+'/api/crc/agent-stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question}),signal:AbortSignal.timeout(190000)})
 const events=parseEvents(await response.text()),done=events.find(e=>e.event==='done')?.data
 const calls=events.filter(e=>e.event==='trace'&&e.data.stage==='tool-start').map(e=>({name:e.data.tool,args:e.data.parameters}))
 const visuals=events.filter(e=>e.event==='visuals').flatMap(e=>e.data)
 const modelSelected=events.some(e=>e.event==='trace'&&e.data.stage==='plan'&&e.data.selection==='model')
 const passed=Boolean(modelSelected&&done?.ok&&calls.length===1&&calls[0].name===tool&&visuals.length&&visuals.every(chart=>chart.kind===kind))
 results.push({question,expectedTool:tool,expectedChart:kind,passed,modelSelected,calls,charts:visuals.map(({kind,title,n,unit,status,reason})=>({kind,title,n,unit,status,reason})),provider:done?.selection,answer:events.filter(e=>e.event==='token').map(e=>e.data).join(''),durationMs:Date.now()-started})
 console.log(`${passed?'PASS':'FAIL'} ${tool}/${kind}: ${calls.map(c=>c.name).join(', ')} -> ${visuals.map(v=>v.kind).join(',')}`)
}
writeFileSync('docs/evaluation/science-model-results.json',JSON.stringify({recordedAt:new Date().toISOString(),fixture:'Independent wholly synthetic science fixture',note:'12 development smoke cases; evaluates selected tool, requested chart type and completion, not clinical interpretation or held-out accuracy.',passed:results.filter(r=>r.passed).length,total:results.length,results},null,2)+'\n')
if(results.some(r=>!r.passed))process.exitCode=1
