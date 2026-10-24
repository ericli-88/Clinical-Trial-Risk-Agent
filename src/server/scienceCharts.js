// Pure statistical chart builders. The model never supplies the numbers rendered here.
export const CHART_RECIPES = [
  ['line','Ordered numeric observations','Time trend; do not join unrelated subjects or cycles'],
  ['histogram','One numeric variable','Frequency distribution with explicit bin edges and record counts'],
  ['box','Numeric values by category','Median, quartiles, actual whiskers and descriptive 1.5-IQR outliers'],
  ['density','One numeric variable, n >= 5 with variation','Exploratory Gaussian KDE; not a clinical risk probability'],
  ['ecdf','One numeric variable','Observed cumulative proportion; ties retained in counts'],
  ['scatter','Two numeric variables with explicit pairing','Relationship without an implied causal/regression claim'],
  ['correlation_heatmap','At least three unambiguous complete paired rows','Pearson correlations, sample count and missing/constant cells'],
  ['bar','One category and a count','Categorical frequency'],
  ['grouped_bar','Two categories and counts','Compare subcategory counts side by side'],
  ['stacked_bar','Two categories and counts','Show count composition; not a default percentage chart'],
  ['heatmap','Two categories and an explicit cell measure','Counts or labeled missingness fractions; not interchangeable with correlation'],
  ['timeline','Recorded dates','Chronology and intervals with missing ends retained']
].map(([kind,input,use])=>({kind,input,use}))

export function quantile(sorted,p){
  if(!sorted.length)return null
  const at=(sorted.length-1)*p,lo=Math.floor(at),fraction=at-lo
  return sorted[lo]+(sorted[Math.min(lo+1,sorted.length-1)]-sorted[lo])*fraction
}
function valuesOf(observations){return observations.map(o=>o.value).filter(Number.isFinite).sort((a,b)=>a-b)}
export function histogram(observations,requestedBins){
  const values=valuesOf(observations),n=values.length
  if(!n)return {bins:[],n,method:'No eligible values'}
  const min=values[0],max=values[n-1]
  if(min===max)return {n,bins:[{lower:min-.5,upper:max+.5,count:n,last:true}],method:'Single bin for constant values'}
  const iqr=quantile(values,.75)-quantile(values,.25)
  const fdWidth=2*iqr/Math.cbrt(n)
  const count=requestedBins||Math.max(1,Math.min(30,fdWidth>0?Math.ceil((max-min)/fdWidth):Math.ceil(Math.log2(n)+1)))
  const width=(max-min)/count
  const bins=Array.from({length:count},(_,i)=>({lower:min+i*width,upper:i===count-1?max:min+(i+1)*width,count:0,last:i===count-1}))
  for(const value of values)bins[Math.min(count-1,Math.floor((value-min)/width))].count++
  return {n,bins,method:requestedBins?'Requested equal-width bins':'Freedman–Diaconis bins; Sturges fallback, maximum 30'}
}
export function boxSummary(observations){
  const values=valuesOf(observations),n=values.length
  if(!n)return {n}
  const q1=quantile(values,.25),median=quantile(values,.5),q3=quantile(values,.75),iqr=q3-q1
  const inside=values.filter(v=>v>=q1-1.5*iqr&&v<=q3+1.5*iqr)
  return {n,min:values[0],max:values[n-1],q1,median,q3,lowWhisker:inside[0],highWhisker:inside[inside.length-1],outliers:values.filter(v=>v<q1-1.5*iqr||v>q3+1.5*iqr),method:'Type-7 quantiles; 1.5-IQR whiskers are descriptive, not clinical limits'}
}
export function ecdf(observations){
  const values=valuesOf(observations),points=[]
  values.forEach((value,i)=>{if(i===values.length-1||values[i+1]!==value)points.push({x:value,y:(i+1)/values.length,count:i+1})})
  return {n:values.length,points}
}
export function density(observations){
  const values=valuesOf(observations),n=values.length
  if(n<5)return {n,status:'unavailable',reason:'KDE needs at least five eligible observations in this implementation.',points:[]}
  const mean=values.reduce((s,v)=>s+v,0)/n
  const sd=Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(n-1))
  if(!sd)return {n,status:'unavailable',reason:'KDE is not drawn for constant observations.',points:[]}
  const robust=(quantile(values,.75)-quantile(values,.25))/1.34
  const bandwidth=.9*(robust>0?Math.min(sd,robust):sd)*n**(-.2)
  const min=values[0]-3*bandwidth,max=values[n-1]+3*bandwidth
  const points=Array.from({length:81},(_,i)=>{
    const x=min+(max-min)*i/80
    const y=values.reduce((s,v)=>s+Math.exp(-.5*((x-v)/bandwidth)**2),0)/(n*bandwidth*Math.sqrt(2*Math.PI))
    return {x,y}
  })
  return {n,status:'available',bandwidth,points,method:'Gaussian KDE; Silverman robust bandwidth. Smoothed density is descriptive.'}
}
export function pearson(pairs){
  if(pairs.length<3)return null
  const n=pairs.length,mx=pairs.reduce((s,p)=>s+p[0],0)/n,my=pairs.reduce((s,p)=>s+p[1],0)/n
  let xy=0,xx=0,yy=0
  for(const [x,y] of pairs){xy+=(x-mx)*(y-my);xx+=(x-mx)**2;yy+=(y-my)**2}
  return xx>0&&yy>0?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null
}
export function distributionViews(observations,{title,unit,bins,groupLabel='All eligible records'}={}){
  const groups=[...new Set(observations.map(o=>o.group||groupLabel))]
  const base={title,unit,n:observations.length,note:'Record-weighted observations; repeated samples are not independent participants.'}
  const hist=histogram(observations,bins),empirical=ecdf(observations),smooth=density(observations)
  const views={
    histogram:{...base,kind:'histogram',data:hist.bins,method:hist.method,n:hist.n},
    box:{...base,kind:'box',data:groups.map(label=>({label,...boxSummary(observations.filter(o=>(o.group||groupLabel)===label))}))},
    ecdf:{...base,kind:'ecdf',data:[{label:unit,points:empirical.points}],xLabel:unit,yLabel:'Observed cumulative proportion'},
    density:{...base,kind:'density',data:[{label:unit,points:smooth.points}],xLabel:unit,yLabel:'Density (inverse measurement unit)',status:smooth.status,reason:smooth.reason,bandwidth:smooth.bandwidth}
  }
  return views
}
