import test from 'node:test'
import assert from 'node:assert/strict'
import {histogram,boxSummary,ecdf,density,pearson,CHART_RECIPES} from './scienceCharts.js'
import {executeClinicalAtom,validateClinicalCall} from './clinicalTools.js'
import {selectValidatedPlan} from './clinicalPlanner.js'
import {validateRequestPlan} from './crcAgent.js'
const observations=values=>values.map(value=>({value}))
const run=(name,args)=>executeClinicalAtom({name,args}).result
const variables=[{formId:15,analyte:'creatinine',unit:'μmol/L'},{formId:15,analyte:'alt',unit:'U/L'}]

test('histogram bin boundaries include the maximum exactly once',()=>{
 const result=histogram(observations([0,1,2,3,4]),2)
 assert.deepEqual(result.bins.map(bin=>bin.count),[2,3])
 assert.equal(result.bins[0].lower,0);assert.equal(result.bins.at(-1).upper,4)
 assert.equal(histogram(observations([7,7,7])).bins[0].count,3)
 assert.equal(histogram([]).n,0)
})
test('box plots use independent golden type-7 quartiles and descriptive outliers',()=>{
 const result=boxSummary(observations([1,2,3,4,100]))
 assert.equal(result.q1,2);assert.equal(result.median,3);assert.equal(result.q3,4)
 assert.equal(result.lowWhisker,1);assert.equal(result.highWhisker,4)
 assert.deepEqual(result.outliers,[100])
})
test('ECDF handles tied observations and reaches one without inventing counts',()=>{
 assert.deepEqual(ecdf(observations([1,1,2,4])).points,[{x:1,y:.5,count:2},{x:2,y:.75,count:3},{x:4,y:1,count:4}])
})
test('KDE handles small or constant samples explicitly and has approximately unit integral',()=>{
 assert.equal(density(observations([1,2,3])).status,'unavailable')
 assert.equal(density(observations([4,4,4,4,4])).status,'unavailable')
 const result=density(observations([1,2,3,4,5,6,7]))
 let area=0
 for(let i=1;i<result.points.length;i++)area+=(result.points[i].x-result.points[i-1].x)*(result.points[i].y+result.points[i-1].y)/2
 assert.ok(area>.99&&area<1.01)
})
test('Pearson distinguishes positive, negative, constant and insufficient pairs',()=>{
 assert.equal(pearson([[1,2],[2,4],[3,6]]),1)
 assert.equal(pearson([[1,6],[2,4],[3,2]]),-1)
 assert.equal(pearson([[1,2],[1,3],[1,4]]),null)
 assert.equal(pearson([[1,2],[2,4]]),null)
})
test('distribution tools preserve numeric source units and all compatible alternate views',()=>{
 const age=run('numeric_distribution',{formId:4,valueField:'age',unitField:'ageUnit',display:'histogram',bins:3})
 assert.equal(age.visuals[0].n,6)
 assert.equal(age.visuals[0].data.reduce((s,bin)=>s+bin.count,0),6)
 assert.deepEqual(Object.keys(age.visuals[0].alternatives).sort(),['box','density','ecdf','histogram'])
 assert.equal(age.visuals[0].alternatives.box.data[0].median,45)
 const labs=run('lab_distribution',{formId:15,analyte:'creatinine',display:'box',groupBy:'visit'})
 assert.equal(labs.visuals.length,2)
 assert.ok(labs.visuals.every(chart=>chart.unit!=='Unit not recorded'))
 assert.equal(run('lab_distribution',{formId:15,analyte:'creatinine',display:'table'}).visuals.length,0)
 assert.equal(run('lab_distribution',{formId:15,analyte:'creatinine',unit:'μmol/L',display:'histogram'}).visuals.length,1)
})
test('relationship pairing requires exact dates/visits and omits ambiguous duplicates',()=>{
 const result=run('lab_relationship',{variables,display:'correlation_heatmap'})
 assert.equal(result.rows.length,4)
 assert.ok(result.rows.every(row=>row.subject!=='01-003'))
 const single=run('lab_relationship',{variables,subjectId:'01-001',display:'scatter'})
 assert.equal(single.rows.length,3)
 assert.equal(single.visuals[0].data[0].points.length,3)
 const cell=single.visuals[0].alternatives.correlation_heatmap.data.find(c=>c.row.startsWith('creatinine')&&c.column.startsWith('alt'))
 assert.equal(cell.value,1);assert.equal(cell.n,3)
 assert.throws(()=>run('lab_relationship',{variables:[{formId:15,analyte:'creatinine'},{formId:15,analyte:'alt'}]}),/Mixed units/)
})
test('categorical plots retain exact totals and distinct grouped/stacked/heatmap shapes',()=>{
 const result=run('categorical_summary',{formId:45,field:'grade',splitBy:'sae',display:'stacked_bar'})
 assert.equal(result.visuals[0].kind,'stacked_bar')
 assert.equal(result.rows.reduce((n,row)=>n+row.count,0),5)
 assert.equal(result.visuals[0].alternatives.heatmap.scale,'count')
 assert.equal(result.visuals[0].alternatives.grouped_bar.series.length,2)
 assert.throws(()=>run('categorical_summary',{formId:45,field:'grade',display:'stacked_bar'}),/splitBy/)
})
test('missingness heatmap exposes numerator and denominator and never treats qualifiers as blank',()=>{
 const result=run('data_missingness_map',{formId:15,fields:['value','unit'],groupBy:'visit'})
 assert.equal(result.visuals[0].scale,'missingness')
 assert.equal(result.rows.find(row=>row.row==='C3'&&row.column==='value').missing,1)
 assert.ok(result.rows.every(row=>row.value===row.missing/row.total))
 assert.equal(result.rows.find(row=>row.row==='C2'&&row.column==='value').missing,0)
})
test('chart contracts reject invalid bins, unknown columns and sensitive categorical fields',()=>{
 assert.throws(()=>validateClinicalCall({name:'lab_distribution',args:{formId:15,analyte:'creatinine',bins:1000}}))
 assert.throws(()=>validateClinicalCall({name:'numeric_distribution',args:{formId:4,valueField:'age'}}))
 assert.throws(()=>run('categorical_summary',{formId:45,field:'made_up_column'}))
 assert.throws(()=>run('categorical_summary',{formId:45,field:'constructor'}))
 assert.throws(()=>run('categorical_summary',{formId:32,field:'arm'}))
 assert.equal(new Set(CHART_RECIPES.map(recipe=>recipe.kind)).size,12)
})
test('model-plan repair validates before execution and is bounded to two attempts',async()=>{
 let calls=0;const progress=[]
 const plan=await selectValidatedPlan({question:'Histogram of age',catalog:[],schemaContext:[],model:async()=>({provider:'test',content:++calls===1?'not JSON':'{"calls":[],"clarification":"Please supply the form."}'}),validate:plan=>{assert.ok(Array.isArray(plan.calls));return plan},onProgress:step=>progress.push(step)})
 assert.equal(calls,2);assert.equal(plan.planningAttempts,2);assert.equal(progress.length,1)
 calls=0
 await assert.rejects(()=>selectValidatedPlan({question:'test',catalog:[],schemaContext:[],model:async()=>{calls++;return {content:'broken'}},validate:()=>{throw new Error('Invalid plan')}}))
 assert.equal(calls,2)
})
test('numeric identifiers cannot be disguised as measurements or unit columns',()=>{
 assert.throws(()=>run('numeric_distribution',{formId:4,valueField:'subject',unit:'dimensionless'}),/Identifier/)
 assert.throws(()=>run('numeric_distribution',{formId:4,valueField:'age',unitField:'visit'}),/unitField/)
 const question='Compare creatinine in μmol/L and ALT in U/L for 01-001'
 assert.throws(()=>validateRequestPlan({calls:[{name:'lab_relationship',args:{subjectId:'01-001',variables:[{formId:15,analyte:'creatinine'},{formId:15,analyte:'alt'}]}}]},question),/do not drop/)
 assert.equal(validateRequestPlan({calls:[{name:'lab_relationship',args:{subjectId:'01-001',variables}}]},question).calls.length,1)
})
