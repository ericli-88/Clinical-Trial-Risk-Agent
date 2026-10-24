const COLORS=['#2563eb','#15803d','#b45309','#7c3aed','#0e7490','#be123c','#475467']
const fmt=value=>Number.isFinite(value)?Number(value.toPrecision(4)):'n/a'

export function Histogram({chart}){
 const bins=chart.data||[]
 if(!bins.length)return <p className="chart-empty">No eligible numeric values for a histogram.</p>
 const min=bins[0].lower,max=bins.at(-1).upper,top=Math.max(1,...bins.map(bin=>bin.count)),width=620/bins.length
 return <div className="clinical-chart-svg"><svg viewBox="0 0 740 285" role="img" aria-label={chart.title}>
  {[0,.5,1].map(t=><g key={t}><line x1="64" x2="684" y1={228-t*174} y2={228-t*174} stroke="#e4e7ec"/><text x="56" y={232-t*174} textAnchor="end" fontSize="12" fill="#667085">{fmt(top*t)}</text></g>)}
  {bins.map((bin,i)=><rect key={i} x={64+i*width+1} y={228-bin.count/top*174} width={Math.max(1,width-2)} height={bin.count/top*174} fill="#2563eb"><title>{`${bin.lower} ≤ value ${bin.last?'≤':'<'} ${bin.upper}: ${bin.count} records`}</title></rect>)}
  <text x="64" y="250" fontSize="12" fill="#667085">{fmt(min)}</text><text x="684" y="250" textAnchor="end" fontSize="12" fill="#667085">{fmt(max)}</text><text x="64" y="25" fontSize="12" fill="#475467">Record count</text><text x="374" y="276" textAnchor="middle" fontSize="12" fill="#475467">{chart.unit}</text>
 </svg></div>
}

export function BoxPlot({chart}){
 const groups=(chart.data||[]).filter(group=>group.n),all=groups.flatMap(group=>[group.min,group.max])
 if(!groups.length)return <p className="chart-empty">No eligible values for a box plot.</p>
 const min=Math.min(...all),max=Math.max(...all),height=80+groups.length*44,x=value=>190+(value-min)/(max-min||1)*470
 return <div className="science-box-scroll"><svg viewBox={`0 0 740 ${height}`} role="img" aria-label={chart.title} style={{minWidth:540,width:'100%'}}>
  {groups.map((group,i)=>{const y=30+i*44;return <g key={group.label}><text x="180" y={y+4} textAnchor="end" fontSize="11" fill="#475467"><title>{group.label}</title>{group.label.length>23?group.label.slice(0,22)+'…':group.label} (n={group.n})</text><line x1={x(group.lowWhisker)} x2={x(group.highWhisker)} y1={y} y2={y} stroke="#667085"/><line x1={x(group.lowWhisker)} x2={x(group.lowWhisker)} y1={y-7} y2={y+7} stroke="#667085"/><line x1={x(group.highWhisker)} x2={x(group.highWhisker)} y1={y-7} y2={y+7} stroke="#667085"/><rect x={x(group.q1)} y={y-11} width={Math.max(1,x(group.q3)-x(group.q1))} height="22" fill="#dbeafe" stroke="#2563eb"><title>{`Q1 ${group.q1}; median ${group.median}; Q3 ${group.q3}; whiskers ${group.lowWhisker}–${group.highWhisker}`}</title></rect><line x1={x(group.median)} x2={x(group.median)} y1={y-11} y2={y+11} stroke="#1d4ed8" strokeWidth="2"/>{group.outliers.map((v,j)=><circle key={j} cx={x(v)} cy={y} r="3" fill="#b45309"><title>{`Descriptive 1.5-IQR outlier: ${v}; not a clinical abnormality flag`}</title></circle>)}</g>})}
  <text x="190" y={height-29} fontSize="12" fill="#667085">{fmt(min)}</text><text x="660" y={height-29} textAnchor="end" fontSize="12" fill="#667085">{fmt(max)}</text><text x="425" y={height-8} textAnchor="middle" fontSize="12" fill="#475467">{chart.unit}</text>
 </svg><p className="chart-source-note">Type-7 quartiles; 1.5-IQR whiskers describe the observed distribution, not medical reference limits.</p></div>
}

export function CategoryBars({chart}){
 const rows=chart.data||[],categories=chart.categories||[],series=chart.series||[],stacked=chart.kind==='stacked_bar'
 const total=category=>rows.filter(row=>row.label===category).reduce((sum,row)=>sum+row.count,0)
 const max=Math.max(1,...(stacked?categories.map(total):rows.map(row=>row.count)))
 return <div><ul className="chart-legend">{series.map((name,i)=><li key={name}><i style={{background:COLORS[i%COLORS.length]}}/>{name}</li>)}</ul>
  {categories.map(category=><div key={category} className="science-category"><strong title={category}>{category}</strong>{stacked?<div className="science-stack-row"><div className="science-stack-track">{series.map((name,i)=>{const count=rows.find(row=>row.label===category&&row.series===name)?.count||0;return <i key={name} style={{width:`${count/max*100}%`,background:COLORS[i%COLORS.length]}} title={`${category} / ${name}: ${count} records`}/>})}</div><span>{total(category)}</span></div>:series.map((name,i)=>{const count=rows.find(row=>row.label===category&&row.series===name)?.count||0;return <div className="science-group-row" key={name}><span title={name}>{name}</span><div><i style={{width:`${count/max*100}%`,background:COLORS[i%COLORS.length]}}/></div><b>{count}</b></div>})}</div>)}
  <p className="chart-source-note">Shared count scale: 0–{max}. {stacked?'Segments are raw counts; bars are not normalized to 100%.':'Each series uses the same count scale.'}</p>
 </div>
}

export function MatrixChart({chart}){
 const correlation=chart.kind==='correlation_heatmap',rows=chart.labels||chart.rowLabels||[],columns=chart.labels||chart.columnLabels||[]
 const finite=chart.data.filter(cell=>Number.isFinite(cell.value)),max=Math.max(1,...finite.map(cell=>cell.value))
 const cellFor=(row,column)=>chart.data.find(cell=>cell.row===row&&cell.column===column)
 const background=value=>!Number.isFinite(value)?'#f2f4f7':correlation?value>=0?`rgba(37,99,235,${Math.abs(value)*.7})`:`rgba(190,18,60,${Math.abs(value)*.7})`:chart.scale==='missingness'?`rgba(180,83,9,${value*.65})`:`rgba(37,99,235,${value/max*.6})`
 return <div className="clinical-heatmap"><table><thead><tr><th>{correlation?'Variable':chart.measure||'Category'}</th>{columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row}><th>{row}</th>{columns.map(column=>{const cell=cellFor(row,column),value=cell?.value??(chart.scale==='count'?0:null);return <td key={column} style={{background:background(value),color:correlation&&Math.abs(value)>.7?'#fff':'#344054'}} title={cell?.total!==undefined?`${cell.missing} blank / ${cell.total} existing records`:correlation?`Pearson r: ${value??'unavailable'}; complete pairs: ${cell?.n||0}`:`Record count: ${value??'unavailable'}`}>{!Number.isFinite(value)?'n/a':chart.scale==='missingness'?<>{Math.round(value*100)}%<small>{cell.missing}/{cell.total}</small></>:fmt(value)}</td>})}</tr>)}</tbody></table>
  <p>{correlation?`Color scale: −1 (red) to +1 (blue). n=${chart.n} complete paired records. n/a means insufficient pairs or zero variance; correlation does not establish causation.`:chart.scale==='missingness'?'Color scale: 0–100% blank among existing records; labels include numerator/denominator. Entirely absent visits are not assessed.':`Color scale: 0–${max} records. Missing category combinations have a count of zero.`}</p>
 </div>
}
