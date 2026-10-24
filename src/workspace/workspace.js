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
