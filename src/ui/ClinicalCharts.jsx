import { useState } from 'react'

const COLORS=['#2563eb','#15803d','#b45309','#7c3aed','#0e7490','#be123c']
function label(value,length=36){const text=String(value??'');return text.length>length?text.slice(0,length-1)+'…':text}

function NumericChart({chart}) {
  const panels=chart.data || []
  const dated=panels.flatMap(s=>s.points).some(p=>typeof p.x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(p.x))
  const toX=value=>dated?Date.parse(value):Number(value)
  const points=panels.flatMap(s=>s.points).filter(p=>Number.isFinite(toX(p.x))&&Number.isFinite(p.y))
  if(!points.length)return <p className="chart-empty">No comparable numeric points with valid dates or hour labels. Review the source table.</p>
  const xValues=points.map(p=>toX(p.x)),yValues=points.map(p=>p.y)
  const minX=Math.min(...xValues),maxX=Math.max(...xValues),minY=Math.min(...yValues),maxY=Math.max(...yValues)
  const x=value=>64+(toX(value)-minX)/(maxX-minX||1)*620
  const y=value=>228-(value-minY)/(maxY-minY||1)*174
  const formatX=value=>dated?new Date(value).toISOString().slice(0,10):Number(value.toFixed(2))
  return <><div className="clinical-chart-svg"><svg viewBox="0 0 740 285" role="img" aria-label={chart.title}>
    {[0,.5,1].map(t=><g key={t}><line x1="64" x2="684" y1={54+t*174} y2={54+t*174} stroke="#e4e7ec"/><text x="56" y={58+t*174} textAnchor="end" fontSize="12" fill="#667085">{Number((maxY-t*(maxY-minY)).toPrecision(4))}</text></g>)}
    <text x="64" y="251" fontSize="12" fill="#667085">{formatX(minX)}</text><text x="684" y="251" textAnchor="end" fontSize="12" fill="#667085">{formatX(maxX)}</text>
    <text x="374" y="277" textAnchor="middle" fontSize="12" fill="#475467">{chart.xLabel}</text><text x="64" y="24" fontSize="12" fill="#475467">{chart.yLabel}</text>
    {panels.map((series,i)=><g key={series.label}>{chart.kind!=='scatter'&&series.points.length>1&&<polyline points={series.points.map(p=>`${x(p.x)},${y(p.y)}`).join(' ')} fill="none" stroke={COLORS[i%COLORS.length]} strokeWidth="2"/>}{series.points.map((point,j)=><circle key={j} cx={x(point.x)} cy={y(point.y)} r="4" fill={COLORS[i%COLORS.length]}><title>{`${series.label}: ${point.x}, ${point.y} ${chart.unit||''}; ${point.source}`}</title></circle>)}</g>)}
  </svg></div><ul className="chart-legend">{panels.map((s,i)=><li key={s.label}><i style={{background:COLORS[i%COLORS.length]}}/>{s.label}</li>)}</ul></>
}

function BarChart({chart}) {
  const rows=chart.data || [], max=Math.max(1,...rows.map(row=>row.count))
  return <div className="clinical-bars">{rows.map((row,i)=><div className="clinical-bar" key={i}><span title={row.label}>{row.label}</span><div><i style={{width:`${row.count/max*100}%`}}/></div><strong>{row.count}</strong></div>)}</div>
}

function Timeline({chart}) {
  if(!(chart.data||[]).some(row=>row.start||row.end))return <p className="chart-empty">No parseable recorded dates in this scope. Review the source table; no interval was inferred.</p>
  return <ol className="clinical-timeline">{(chart.data||[]).filter(row=>row.start||row.end).map((row,i)=><li key={i}><div><strong>{row.drug||row.event||'Source event'}</strong><span>{row.start||'Start not recorded'}{row.end?' → '+row.end:row.pointEvent?'':' · End not recorded'}</span></div><small>{row.visit}{row.source?' · '+row.source:''}</small></li>)}</ol>
}

function Heatmap({chart}) {
  const max=Math.max(1,...chart.data.map(row=>row.count))
  return <div className="clinical-heatmap"><table><thead><tr><th>Visit</th>{chart.forms.map(id=><th key={id}>Form {id}</th>)}</tr></thead><tbody>{chart.visits.map(visit=><tr key={visit}><th>{visit}</th>{chart.forms.map(form=>{const count=chart.data.find(row=>row.visit===visit&&row.form===form)?.count||0;return <td key={form} style={{background:`rgba(37,99,235,${count?0.1+count/max*.45:0})`}}>{count}</td>})}</tr>)}</tbody></table><p>Cell values are existing record counts. Zero does not establish an overdue visit.</p></div>
}

export default function ClinicalCharts({charts=[]}) {
  const [page,setPage]=useState(0)
  if(!charts.length)return null
  const index=Math.min(page,charts.length-1),chart=charts[index]
  return <section className="clinical-visuals" aria-label="Source-backed visualizations"><div className="chart-heading"><strong>{chart.title}</strong>{charts.length>1&&<div><button type="button" disabled={!index} onClick={()=>setPage(index-1)} aria-label="Previous chart">‹</button><span>{index+1}/{charts.length}</span><button type="button" disabled={index===charts.length-1} onClick={()=>setPage(index+1)} aria-label="Next chart">›</button></div>}</div>
    {['line','scatter'].includes(chart.kind)?<NumericChart chart={chart}/>:chart.kind==='bar'?<BarChart chart={chart}/>:chart.kind==='timeline'?<Timeline chart={chart}/>:chart.kind==='heatmap'?<Heatmap chart={chart}/>:null}
    <p className="chart-source-note">Built from executed local queries. Hover plotted points for source references.</p>
  </section>
}
