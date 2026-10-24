const tasks = {
  consent: ['Consent','Consent record not found','01-006','Enrollment + informed consent forms','Enrollment exists; no corresponding consent row is stored.','A missing EDC record does not prove consent was not obtained.'],
  dates: ['Date consistency','Consent dated after randomization','01-005','Enrollment + informed consent forms','Stored consent date: 2026-09-03. Randomization date: 2026-09-02.','This date-order finding needs source verification; exact times and signature versions are unavailable.'],
  events: ['Safety follow-up','Review recorded adverse events','01-001','Adverse events form','Two synthetic event records are available for review.','Record counts do not establish seriousness, causality or reporting completeness.']
}
document.querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', () => {
  document.querySelector('.task.active')?.classList.remove('active'); button.classList.add('active')
  const [category,title,subject,source,observation,interpretation] = tasks[button.dataset.task]
  for (const [key,value] of Object.entries({category,title,subject:`Subject ${subject} · synthetic source finding`,source,observation,interpretation})) document.getElementById(`task-${key}`).textContent = value
}))

// Use actual workbook metadata in private mode; never label synthetic review items as real findings.
fetch('/api/crc/workspace').then(response=>response.ok?response.json():null).then(data=>{
  if(!data || data.source.synthetic)return
  document.querySelector('.demo-tag').textContent='PRIVATE LOCAL WORKBOOK'
  document.title='Clinical Trial Risk Agent · Private workbook'
  document.querySelector('.toolbar h1').textContent='Clinical workbook review workspace'
  document.querySelector('.toolbar>p').textContent='Read-only local snapshot. The assistant queries this workbook and retains source references.'
  const pills=document.querySelectorAll('.filters span')
  pills[0].textContent=`${data.consent.issueCount} consent review findings`
  pills[1].textContent=`${data.metrics.forms} forms · ${data.metrics.records.toLocaleString()} records`
  pills[2].textContent='Source · Private workbook'
  const queue=document.querySelector('aside');queue.replaceChildren()
  const heading=document.createElement('h2');heading.textContent='REVIEW WORKSPACE';queue.append(heading)
  const entries=data.consent.issues.map(issue=>({category:'Consent review',title:issue.description,subject:`Subject ${issue.subjectId}`,source:issue.sources.join('; '),observation:`Stored consent date: ${issue.consentDate||'Not recorded'}. Randomization date: ${issue.randomizationDate||'Not recorded'}.`,interpretation:'Verify the finding against source documents. A missing EDC record is not proof that consent was not obtained.'}))
  entries.push({category:'Data coverage',title:'Review workbook coverage',subject:`${data.metrics.subjectIds} distinct subject identifiers`,source:data.source.type,observation:`${data.metrics.records.toLocaleString()} imported records across ${data.metrics.forms} forms; ${data.metrics.emptyForms} empty forms.`,interpretation:'Record counts and empty forms do not establish required-visit completeness.'})
  entries.push({category:'MTX review',title:'Review concentrations and rescue records',subject:'Choose a subject in the assistant',source:'MTX concentration and rescue-medication forms',observation:'Keep relative-hour observations separate from time-to-threshold summary rows and preserve treatment cycles.',interpretation:'Use recorded dates and units. No clearance diagnosis or dose recommendation is inferred.'})
  const select=(entry,button)=>{
    queue.querySelector('.active')?.classList.remove('active');button.classList.add('active')
    for(const key of ['category','title','subject','source','observation','interpretation'])document.getElementById(`task-${key}`).textContent=entry[key]
  }
  entries.forEach((entry,index)=>{
    const button=document.createElement('button');button.className='task'
    const category=document.createElement('span');category.className='category';category.textContent=entry.category
    const title=document.createElement('strong');title.textContent=entry.title
    const detail=document.createElement('p');detail.textContent=entry.subject
    button.append(category,title,detail);button.addEventListener('click',()=>select(entry,button));queue.append(button)
    if(!index)select(entry,button)
  })
  document.querySelector('article .note').textContent='No records are modified, no safety reports are submitted, and no participant contact is performed.'
}).catch(()=>{})
