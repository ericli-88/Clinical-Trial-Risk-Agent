import {distributionViews,pearson} from './scienceCharts.js'
const LABS=[13,14,15,16,17,22,26,27]
export const SCIENCE_ATOMS=[
 {name:'numeric_distribution',purpose:'Distribution of a numeric source field such as age, ECOG, dose or delay days. Requires an actual unit column or explicitly supplied unit; does not convert units.',parameters:{formId:'required integer 1–46',valueField:'required exact source header or mapped numeric role',unitField:'optional actual source unit header; use this when available',unit:'optional explicitly user-supplied unit when no unitField; no conversion',subjectId:'optional exact subject',visit:'optional exact visit',groupBy:'optional categorical source header or mapped role for box groups',bins:'optional integer 2–40'},displays:['histogram','box','density','ecdf','table']},
 {name:'lab_distribution',purpose:'Distribution of one recorded lab marker, separately per unit. Histogram, box plot, KDE or ECDF; repeated samples are record-weighted, not independent participants.',parameters:{formId:'required laboratory form ID',analyte:'required exact source label or approved English alias',unit:'optional explicit source unit selection',subjectId:'optional exact subject',visit:'optional exact visit',groupBy:'optional none, visit or subject; affects box groups',bins:'optional integer 2–40 for histogram'},displays:['histogram','box','density','ecdf','table']},
 {name:'lab_relationship',purpose:'Scatter or Pearson correlation heatmap for 2–6 lab variables. Pair only on exact subject + visit + collection date; omit duplicates and incomplete keys, never average or create a Cartesian join.',parameters:{variables:'required array of 2–6 {formId,analyte,unit?}; explicitly supply unit if a variable has mixed units',subjectId:'optional exact subject',visit:'optional exact visit'},displays:['scatter','correlation_heatmap','table']},
 {name:'categorical_summary',purpose:'Counts by an actual categorical field and optional splitBy field. Bar, grouped bar, stacked count bar or category heatmap. Metadata roles grade/sae/site/visit/enrolled are accepted; names, arms and free text are blocked.',parameters:{formId:'required integer 1–46',field:'required exact header or mapped role grade/sae/site/visit/enrolled',splitBy:'optional second exact header or mapped role',subjectId:'optional exact subject',visit:'optional exact visit',topN:'optional integer 2–30, default 12; remaining categories counted as Other'},displays:['bar','grouped_bar','stacked_bar','heatmap','table']},
 {name:'data_missingness_map',purpose:'Blank-value fractions among existing rows by field and visit/site. Shows missing and total counts; does not infer requiredness or entirely absent visits.',parameters:{formId:'required integer 1–46',fields:'required array of 1–12 distinct source headers or mapped roles',subjectId:'optional exact subject',groupBy:'optional visit or site, default visit'},displays:['heatmap','bar','table']}
]
const specs=new Map(SCIENCE_ATOMS.map(s=>[s.name,s]))
export function validateScienceCall(call){
 const spec=specs.get(call.name),args=call.args||{}
 if(!spec||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(spec.parameters,k)&&k!=='display'))throw new Error('Unexpected science-chart parameters.')
 for(const [key,description] of Object.entries(spec.parameters))if(description.startsWith('required')&&(args[key]===undefined||args[key]===null||args[key]===''))throw new Error(`Missing required ${key}.`)
 if(args.subjectId!==undefined&&(typeof args.subjectId!=='string'||!/^(?:\d{2}-\d{3}|\d{5,7})$/.test(args.subjectId)))throw new Error('A complete subject ID is required.')
 if(args.formId!==undefined&&(!Number.isInteger(args.formId)||args.formId<1||args.formId>46))throw new Error('formId must be 1–46.')
 if(call.name==='lab_distribution'&&!LABS.includes(args.formId))throw new Error('Select a laboratory form.')
 for(const key of ['field','splitBy','analyte','visit','valueField','unitField','unit','groupBy'])if(args[key]!==undefined&&(typeof args[key]!=='string'||!args[key].trim()||args[key].length>180))throw new Error(`Invalid ${key}.`)
 if(call.name==='numeric_distribution'&&!args.unitField&&!args.unit)throw new Error('Provide an actual unitField or an explicitly supplied unit; no unit is assumed.')
 if(call.name==='numeric_distribution'&&args.unitField&&args.unit)throw new Error('Use either source unitField or supplied unit, not both.')
 if(args.display!==undefined&&!['auto',...spec.displays].includes(args.display))throw new Error('Incompatible science chart type.')
 if(args.bins!==undefined&&(!Number.isInteger(args.bins)||args.bins<2||args.bins>40))throw new Error('bins must be 2–40.')
 if(args.topN!==undefined&&(!Number.isInteger(args.topN)||args.topN<2||args.topN>30))throw new Error('topN must be 2–30.')
 if(call.name==='lab_distribution'&&args.groupBy!==undefined&&!['none','visit','subject'].includes(args.groupBy))throw new Error('Distribution groupBy must be none, visit or subject.')
 if(call.name==='data_missingness_map'&&args.groupBy!==undefined&&!['visit','site'].includes(args.groupBy))throw new Error('Missingness groupBy must be visit or site.')
 if(args.fields!==undefined&&(!Array.isArray(args.fields)||!args.fields.length||args.fields.length>12||new Set(args.fields).size!==args.fields.length||args.fields.some(f=>typeof f!=='string'||!f.trim()||f.length>180)))throw new Error('Select 1–12 distinct field names.')
 if(call.name==='lab_relationship'){
  if(!Array.isArray(args.variables)||args.variables.length<2||args.variables.length>6)throw new Error('Select 2–6 lab variables.')
  for(const variable of args.variables)if(!variable||typeof variable!=='object'||Object.keys(variable).some(k=>!['formId','analyte','unit'].includes(k))||!LABS.includes(variable.formId)||typeof variable.analyte!=='string'||!variable.analyte.trim()||variable.analyte.length>180||(variable.unit!==undefined&&(typeof variable.unit!=='string'||!variable.unit.trim()||variable.unit.length>60)))throw new Error('Each variable needs an approved lab form, analyte and optional exact unit.')
  if(new Set(args.variables.map(v=>JSON.stringify([v.formId,v.analyte.toLowerCase()]))).size!==args.variables.length)throw new Error('Duplicate variables are not accepted.')
 }
 return {name:call.name,args}
}
function fieldColumn(data,field){
 const roleAliases={result:'value',result_unit:'unit',collected_date:'collected',ctcae_grade:'grade',recorded_grade:'grade',recorded_sae:'sae',enrollment_status:'enrolled'}
 const role=Object.hasOwn(roleAliases,field)?roleAliases[field]:field
 const column=(Object.hasOwn(data.roles,role)?data.roles[role]:null)||data.columns.find(c=>c.original_header===field)?.sqlite_column_name
 if(!column)throw new Error(`Field ${field} is not mapped; inspect schema_catalog.`)
 if(/姓名|initials|(?:patient|participant|subject).*name|试验组别|\barm\b|备注|remark|description|具体说明/i.test(column)||role==='arm')throw new Error('Identifiers, free text and treatment arms are not chart categories in this tool.')
 return column
}
const text=value=>String(value??'').trim()
const missing=value=>value===null||value===undefined||text(value)===''
const category=value=>missing(value)?'Missing / not recorded':text(value)
const eligible=row=>row.numeric!==null&&!row.qualifier&&row.unit!=='Unit not recorded'
function attach(views,kind){return {...views[kind],alternatives:views}}

export function executeScienceTool(call,adapter){
 const {name,args}=validateScienceCall(call)
 const {readForm,labRows,value,limitResult,canonicalUnit,numericObservation}=adapter
 if(name==='numeric_distribution'){
  const data=readForm(args.formId,args),field=fieldColumn(data,args.valueField),unitColumn=args.unitField?fieldColumn(data,args.unitField):null,groupColumn=args.groupBy?fieldColumn(data,args.groupBy):null
  if(field===data.roles.subject||field===data.roles.site)throw new Error('Identifier columns are not numeric measurements.')
  if(unitColumn&&!/单位|unit/i.test(unitColumn))throw new Error('unitField must be an actual source unit column.')
  const rows=data.rows.map(row=>{const observation=numericObservation(row[field]);return {subject:text(value(data,row,'subject')),visit:text(value(data,row,'visit')),result:observation.raw,numeric:observation.value,qualifier:observation.qualifier,unit:canonicalUnit(unitColumn?row[unitColumn]:args.unit),group:groupColumn?category(row[groupColumn]):'All eligible records',source:`Form ${args.formId} · Excel row ${row.__source_row}`}})
  const valid=rows.filter(eligible),kind=args.display&&args.display!=='auto'&&args.display!=='table'?args.display:args.groupBy?'box':'histogram'
  const visuals=[...new Set(valid.map(r=>r.unit))].map(unit=>attach(distributionViews(valid.filter(r=>r.unit===unit).map(r=>({value:r.numeric,group:r.group,source:r.source})),{title:`${args.valueField}: source-value distribution`,unit,bins:args.bins}),kind))
  return limitResult(`Selected ${rows.length} source records; ${valid.length} unqualified numeric values with units enter distribution charts. ${args.unit?'The unit label was supplied in the request; source-unit verification and conversion were not performed.':'Unit labels come from the selected source column.'} Group summaries are descriptive observations, not independent-patient inference.`,rows,visuals)
 }
 if(name==='lab_distribution'){
  const data=readForm(args.formId,args,['analyte','value','unit'])
  const rows=labRows(data,args).filter(row=>!args.unit||row.unit===canonicalUnit(args.unit)),valid=rows.filter(eligible),units=[...new Set(valid.map(r=>r.unit))]
  const visuals=units.map(unit=>{
   const observations=valid.filter(r=>r.unit===unit).map(r=>({value:r.numeric,group:args.groupBy==='subject'?r.subject:args.groupBy==='visit'?r.visit:'All eligible records',source:r.source}))
   const views=distributionViews(observations,{title:`${args.analyte}: recorded-value distribution`,unit,bins:args.bins})
   const kind=args.display&&args.display!=='auto'&&args.display!=='table'?args.display:args.groupBy&&args.groupBy!=='none'?'box':'histogram'
   return attach(views,kind)
  })
  return limitResult(`Selected ${rows.length} lab records; ${valid.length} have unqualified numeric values and recorded units, and ${rows.length-valid.length} were excluded from numeric distributions. Different units are separate panels. Dates are not required for a distribution. Counts describe observations, not independent participants; no statistical significance or clinical abnormality is inferred.`,rows,visuals)
 }
 if(name==='lab_relationship'){
  const variables=args.variables.map(variable=>{
   const data=readForm(variable.formId,args,['analyte','value','unit','collected'])
   let rows=labRows(data,{...args,analyte:variable.analyte}).filter(r=>eligible(r)&&r.date)
   if(variable.unit)rows=rows.filter(r=>r.unit===canonicalUnit(variable.unit))
   const units=[...new Set(rows.map(r=>r.unit))]
   if(units.length>1)throw new Error(`Mixed units for ${variable.analyte}; specify its exact unit before pairing.`)
   const groups=new Map()
   for(const row of rows){const key=JSON.stringify([row.subject,row.visit,row.date]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
   return {label:variable.analyte,unit:units[0]||'No eligible unit',groups,ambiguous:[...groups.values()].filter(values=>values.length!==1).length}
  })
  const keys=[...new Set(variables.flatMap(v=>[...v.groups.keys()]))]
  const complete=keys.filter(key=>variables.every(v=>v.groups.get(key)?.length===1))
  const rows=complete.map(key=>{const [subject,visit,date]=JSON.parse(key);return {subject,visit,date,...Object.fromEntries(variables.map((v,i)=>[`variable_${i+1}`,v.groups.get(key)[0].numeric])),sources:variables.map(v=>v.groups.get(key)[0].source).join('; ')}})
  const labels=variables.map(v=>`${v.label} (${v.unit})`)
  const cells=variables.flatMap((v,i)=>variables.map((w,j)=>({row:labels[i],column:labels[j],value:pearson(rows.map(r=>[r[`variable_${i+1}`],r[`variable_${j+1}`]])),n:rows.length})))
  const correlation={kind:'correlation_heatmap',title:'Exploratory lab correlation (Pearson)',labels,data:cells,n:rows.length,note:'Complete-case exact subject/visit/date pairing; no averaging. Repeated visits are not independent subjects. Null cells mean fewer than three pairs or constant values; no causal or significance inference.'}
  const pairPlots=[]
  for(let i=0;i<variables.length;i++)for(let j=i+1;j<variables.length;j++)pairPlots.push({kind:'scatter',title:`${variables[i].label} vs ${variables[j].label}`,data:[{label:'Exact paired observations',points:rows.map(r=>({x:r[`variable_${i+1}`],y:r[`variable_${j+1}`],source:r.sources,raw:`${r.subject}; ${r.visit}; ${r.date}`}))}],xLabel:labels[i],yLabel:labels[j],n:rows.length,note:'No regression line or causal conclusion. Points are record-level, not independent participants.'})
  const alternatives={correlation_heatmap:correlation,...(pairPlots.length===1?{scatter:pairPlots[0]}:{})}
  const kind=args.display&&args.display!=='auto'&&args.display!=='table'?args.display:variables.length===2?'scatter':'correlation_heatmap'
  const visuals=kind==='scatter'?pairPlots.map(plot=>({...plot,alternatives:pairPlots.length===1?alternatives:undefined})):[attach(alternatives,'correlation_heatmap')]
  return limitResult(`Found ${rows.length} unambiguous complete paired observations. ${keys.length-complete.length} candidate keys were omitted as incomplete or duplicated; ${variables.reduce((s,v)=>s+v.ambiguous,0)} variable/key groups were ambiguous. Pairing uses exact subject, visit and collection date, never row order or a Cartesian join. Pearson cells require at least three complete pairs and nonconstant values.`,rows,visuals)
 }
 if(name==='categorical_summary'){
  const data=readForm(args.formId,args),primary=fieldColumn(data,args.field),secondary=args.splitBy?fieldColumn(data,args.splitBy):null
  if(args.display==='bar'&&secondary)throw new Error('Use grouped_bar, stacked_bar or heatmap to retain splitBy, or omit splitBy for one-variable bars.')
  if(['grouped_bar','stacked_bar','heatmap'].includes(args.display)&&!secondary)throw new Error('A second category splitBy is required for this display.')
  const counts=new Map()
  for(const row of data.rows){const label=category(row[primary]);counts.set(label,(counts.get(label)||0)+1)}
  const ordered=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
  const top=new Set(ordered.slice(0,args.topN||12).map(([label])=>label)),rows=[],groups=new Map()
  for(const row of data.rows){const raw=category(row[primary]),label=top.has(raw)?raw:'Other (remaining categories)',series=secondary?category(row[secondary]):'Record count';const key=JSON.stringify([label,series]);if(!groups.has(key))groups.set(key,{label,series,count:0});groups.get(key).count++}
  rows.push(...groups.values())
  const categories=[...new Set(rows.map(r=>r.label))],series=[...new Set(rows.map(r=>r.series))]
  if(series.length>20)throw new Error('Too many split categories; narrow the scope or choose a lower-cardinality field.')
  const views=secondary?{
   grouped_bar:{kind:'grouped_bar',title:`${args.field} by ${args.splitBy}`,data:rows,categories,series},
   stacked_bar:{kind:'stacked_bar',title:`${args.field} composition by ${args.splitBy}`,data:rows,categories,series},
   heatmap:{kind:'heatmap',title:'Categorical record-count heatmap',data:rows.map(r=>({row:r.label,column:r.series,value:r.count})),rowLabels:categories,columnLabels:series,measure:'Record count',scale:'count'}
  }:{bar:{kind:'bar',title:`${args.field}: record counts`,data:rows}}
  const kind=args.display&&args.display!=='auto'&&args.display!=='table'?args.display:secondary?'grouped_bar':'bar'
  const chart=attach(views,kind);chart.n=data.rows.length
  return limitResult(`Counted ${data.rows.length} existing records. Missing category values are explicit. At most ${args.topN||12} primary categories are named; remaining categories are combined without dropping their counts. Bars are counts, not percentages or participant-level risk.`,rows,[chart])
 }
 if(name==='data_missingness_map'){
  const data=readForm(args.formId,args),columns=args.fields.map(field=>({field,column:fieldColumn(data,field)})),groupRole=args.groupBy||'visit'
  if(!data.roles[groupRole])throw new Error(`No mapped ${groupRole} field for missingness grouping.`)
  const groups=new Map()
  for(const row of data.rows){const key=category(value(data,row,groupRole));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  const rows=[...groups].flatMap(([row,records])=>columns.map(({field,column})=>{const missingCount=records.filter(r=>missing(r[column])).length;return {row,column:field,missing:missingCount,total:records.length,value:records.length?missingCount/records.length:null}}))
  const views={heatmap:{kind:'heatmap',title:'Blank values among existing records',data:rows,rowLabels:[...groups.keys()],columnLabels:args.fields,measure:'Missing / existing records',scale:'missingness'},bar:{kind:'bar',title:'Blank-value counts by field',data:args.fields.map(field=>({label:field,count:rows.filter(r=>r.column===field).reduce((n,r)=>n+r.missing,0)}))}}
  return limitResult(`Reviewed ${data.rows.length} existing rows across ${args.fields.length} selected fields. Each heatmap cell includes missing and total counts; the color represents their fraction. Not-done or not-applicable text is not silently recoded as blank. Entirely absent visits and protocol-requiredness are not assessed.`,rows,[attach(views,args.display==='bar'?'bar':'heatmap')])
 }
 throw new Error('Science-chart tool not implemented.')
}
