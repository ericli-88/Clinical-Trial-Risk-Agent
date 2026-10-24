import { useEffect, useRef, useState } from 'react'
import './CrcAssistant.css'
import './SimpleAssistant.css'

export function BotIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v3M10.5 3h3M5 10H3v6h2m14-6h2v6h-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><rect x="5" y="6" width="14" height="14" rx="5" stroke="currentColor" strokeWidth="1.7"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><path d="M9 16h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
}

const ACTIONS = [
  { id: 'overview', label: 'Study overview', icon: '◫' },
  { id: 'subject', label: 'Subject snapshot', icon: '◎' },
  { id: 'consent', label: 'Check consent', icon: '✓' }
]
const containsChinese = text => /[\u3400-\u9fff]/.test(String(text))
const safeAnswer = text => {
  const chinese = String(text).match(/[\u3400-\u9fff]/g)?.length || 0
  return chinese > 25 ? 'The response could not be presented in English. Please try again, or use a quick action below to retrieve verified results.' : text
}

function AnswerText({ text }) {
  return <div className="answer-text">{String(text).split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph.split(/(\*\*.*?\*\*)/g).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</p>)}</div>
}

function Thinking({ message, onSettled }) {
  const [expanded, setExpanded] = useState(false)
  const [index, setIndex] = useState(0)
  const [settled, setSettled] = useState(false)
  const steps = message.steps || []
  useEffect(() => {
    if (settled) return
    const timer = setTimeout(() => {
      if (index < steps.length - 1) setIndex(value => value + 1)
      else if (!message.pending) { setExpanded(false); setSettled(true); onSettled(message.id) }
    }, 2600)
    return () => clearTimeout(timer)
  }, [index, steps.length, message.pending, settled])
  if (!steps.length) return null
  return <section className="thinking-panel" aria-label="Execution summary">
    <button className="thinking-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span className={settled ? '' : 'thinking-dot'} />{settled ? `Completed · ${steps.length} steps` : message.pending ? 'Thinking' : 'Reviewing completed steps'}<span>{expanded ? '⌃' : '⌄'}</span></button>
    <p className="trace-disclosure">Execution summary · tool activity, not private model reasoning</p>
    {expanded ? <ul className="thinking-history">{steps.map(step => <li key={step.id}><span>{step.message}</span>{step.tool && <details><summary>{step.tool} · {step.status || 'started'}</summary><pre>{JSON.stringify({ parameters: step.parameters, queries: step.queries, durationMs: step.durationMs, resultRows: step.resultRows }, null, 2)}</pre></details>}</li>)}</ul> : !settled && <ul className="thinking-current" aria-live="polite"><li key={steps[index]?.id}>{steps[index]?.message}</li></ul>}
  </section>
}

function Evidence({ message }) {
  if (!message.evidence?.length && !message.rows?.length) return null
  const englishEvidence = (message.evidence || []).filter(item => !containsChinese(item.label) && !containsChinese(item.value))
  return <details className="message-evidence"><summary>View source evidence <span>↗</span></summary>
    <div className="evidence-content">
      <p className="evidence-note">Read-only results from the local EDC workbook snapshot.</p>
      {englishEvidence.map((item, i) => <div className="evidence-pair" key={i}><span>{item.label}</span><strong>{String(item.value ?? '')}</strong></div>)}
      {!!message.rows?.length && <div className="evidence-table-wrap"><table><thead><tr>{[...new Set(message.rows.flatMap(row => Object.keys(row)))].map(key => <th key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{message.rows.map((row, i) => <tr key={i}>{[...new Set(message.rows.flatMap(item => Object.keys(item)))].map((key, j) => <td key={j}>{String(row[key] ?? '—')}</td>)}</tr>)}</tbody></table></div>}
      {!englishEvidence.length && !message.rows?.length && <p>EDC metadata and record references were supplied to the answer workflow.</p>}
      {(message.evidence || []).some(item => containsChinese(item.label) || containsChinese(item.value)) && <details className="original-source"><summary>Original source references (Chinese)</summary>{message.evidence.map((item, i) => <p key={i}>{item.label}: {String(item.value ?? '')}</p>)}</details>}
    </div>
  </details>
}

export default function CrcAssistant() {
  const embedded = new URLSearchParams(location.search).get('embedded') === 'true'
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [subjects, setSubjects] = useState([])
  const [subjectId, setSubjectId] = useState('')
  const [showSubject, setShowSubject] = useState(false)
  const [initialError, setInitialError] = useState('')
  const [modelStatus, setModelStatus] = useState(null)
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const busyRef = useRef(false)
  const sessionRef = useRef(sessionId)

  function refreshModelStatus() {
    fetch('/api/model-status').then(response => response.ok ? response.json() : null).then(status => { if (status) setModelStatus(status) }).catch(() => {})
  }

  useEffect(() => {
    refreshModelStatus()
    const controller = new AbortController()
    fetch('/api/crc/workspace', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('EDC data is unavailable. Check that the local backend is running.')
      const data = await response.json()
      setSubjects(data.subjects || [])
      setSubjectId(data.subjects?.[0]?.id || '')
    }).catch(error => { if (error.name !== 'AbortError') setInitialError(error.message) })
    return () => { controller.abort(); abortRef.current?.abort() }
  }, [])

  useEffect(() => { scrollRef.current?.scrollTo({ top: messages.length ? scrollRef.current.scrollHeight : 0, behavior: messages.length ? 'smooth' : 'instant' }) }, [messages, busy, showSubject])
  useEffect(() => {
    if (!embedded) return
    const closeOnEscape = event => { if (event.key === 'Escape') window.parent.postMessage({ type: 'trialdata:close' }, location.origin) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [embedded])
  useEffect(() => {
    const receive = event => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'trialdata:action') return
      if (event.data.action === 'subject') {
        if (event.data.subjectId) {
          setSubjectId(event.data.subjectId)
          runAction('subject', event.data.subjectId)
        } else setShowSubject(true)
      } else if (['overview', 'consent'].includes(event.data.action)) runAction(event.data.action)
    }
    window.addEventListener('message', receive)
    window.parent.postMessage({ type: 'trialdata:ready' }, location.origin)
    return () => window.removeEventListener('message', receive)
  }, [])

  function updateMessage(id, patch) { setMessages(current => current.map(message => message.id === id ? { ...message, ...patch } : message)) }
  function appendStep(id, step) { setMessages(current => current.map(message => message.id === id ? { ...message, steps: [...(message.steps || []), step] } : message)) }
  function settlePresentation(id) { updateMessage(id, { presenting: false }) }

  function startTurn(question) {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(true)
    setShowSubject(false)
    const id = crypto.randomUUID()
    const controller = new AbortController()
    abortRef.current = controller
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', text: question }, { id, role: 'assistant', text: '', pending: true, presenting: true, steps: [] }])
    return { id, controller }
  }

  function finishTurn() { busyRef.current = false; setBusy(false); abortRef.current = null; refreshModelStatus() }

  async function runAction(action, selectedSubject) {
    const question = action === 'subject' ? `Show a snapshot for subject ${selectedSubject}.` : action === 'consent' ? 'Check consent and randomization dates.' : 'Give me an overview of this study dataset.'
    const turn = startTurn(question)
    if (!turn) return
    try {
      await readAgentStream(turn, { question, action, subjectId: selectedSubject })
      updateMessage(turn.id, { pending: false })
    } catch (error) { updateMessage(turn.id, { text: error.name === 'AbortError' ? 'Request stopped.' : 'Unable to load this result. Check the local backend and try again.', pending: false, presenting: false, error: true }) }
    finally { finishTurn() }
  }

  async function readAgentStream(turn, payload) {
    const response = await fetch('/api/crc/agent-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: turn.controller.signal })
    if (!response.ok || !response.body) throw new Error('Chat is unavailable.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', answer = '', completed = false
    function consume(block) {
      const event = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim()
      const raw = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (!raw) return
      const data = JSON.parse(raw)
      if (event === 'trace') appendStep(turn.id, data)
      if (event === 'error') throw new Error(data.message)
      if (event === 'token') { answer += data; updateMessage(turn.id, { text: safeAnswer(answer) }) }
      if (event === 'evidence') updateMessage(turn.id, { evidence: data })
      if (event === 'rows') updateMessage(turn.id, { rows: data })
      if (event === 'done') { completed = true; updateMessage(turn.id, { verified: data.ok && data.toolCount > 0, error: !data.ok }) }
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
      const blocks = buffer.split('\n\n'); buffer = blocks.pop() || ''; blocks.forEach(consume)
    }
    buffer += decoder.decode(); if (buffer.trim()) consume(buffer)
    if (!completed || !answer.trim()) throw new Error('No complete answer was received.')
  }

  async function sendQuestion(event) {
    event?.preventDefault()
    const question = input.trim()
    if (!question) return
    const turn = startTurn(question)
    if (!turn) return
    setInput('')
    try {
      await readAgentStream(turn, { question, conversationId: sessionRef.current })
      updateMessage(turn.id, { pending: false })
      return

    } catch (error) {
      updateMessage(turn.id, { pending: false, presenting: false, error: true, text: error.name === 'AbortError' ? 'Request stopped. You can ask another question when you are ready.' : 'I could not complete that request. Please try again, or use a quick action below.' })
    } finally { finishTurn(); inputRef.current?.focus() }
  }

  function newChat() {
    if (busyRef.current) return
    const id = crypto.randomUUID()
    sessionRef.current = id
    setSessionId(id)
    setMessages([])
    setShowSubject(false)
    setInput('')
    inputRef.current?.focus()
  }

  return <div className={`crc-assistant ${embedded ? 'embedded' : 'standalone'}`}>
    <div className="synthetic-banner">SYNTHETIC DEMO · No patient data</div><header className="assistant-header"><div className="assistant-brand"><span className="bot-mark"><BotIcon /></span><div><strong>Clinical Trial Assistant</strong><span title={modelStatus?.fallbackReason || 'Your CRC workspace companion'}><i /> {modelStatus ? modelStatus.provider === 'ollama' ? `Local · ${modelStatus.model}` : `API · ${modelStatus.model}` : 'Your CRC workspace companion'}</span></div></div><button className="new-chat" onClick={newChat} disabled={busy} title="Start a new conversation" aria-label="New conversation">＋</button></header>
    <main className="chat-messages" ref={scrollRef} aria-label="Conversation" aria-busy={busy}>
      {initialError && <div className="connection-error" role="alert">{initialError}</div>}
      {!messages.length && <div className="assistant-welcome"><h1>How can I help?</h1><p>Ask about your EDC data, or choose a quick action below.</p><p className="data-scope-note">Portfolio demo: all participants, events and findings shown here are synthetic. No real patient data is included.</p></div>}
      {messages.map(message => <article key={message.id} className={`chat-message ${message.role} ${message.error ? 'has-error' : ''}`}><div className="message-byline">{message.role === 'assistant' ? <><BotIcon size={17} /> TrialData <span>{message.verified ? 'Source-backed' : 'Assistant'}</span></> : <>You <span>CRC</span></>}</div>{message.role === 'assistant' && <Thinking message={message} onSettled={settlePresentation} />}{message.role === 'user' || (!message.pending && !message.presenting) ? <AnswerText text={message.text} /> : null}{!message.pending && !message.presenting && <Evidence message={message} />}</article>)}
    </main>
    <footer className="assistant-composer">    <nav className="quick-actions" aria-label="CRC quick actions">{ACTIONS.map(action => <button key={action.id} disabled={busy} onClick={() => action.id === 'subject' ? setShowSubject(value => !value) : runAction(action.id)}><span>{action.icon}</span>{action.label}</button>)}</nav>
    {showSubject && <form className="subject-picker" onSubmit={event => { event.preventDefault(); runAction('subject', subjectId) }}><label htmlFor="subject-picker">Choose a subject</label><div><select id="subject-picker" value={subjectId} onChange={event => setSubjectId(event.target.value)}>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.id}</option>)}</select><button disabled={!subjectId || busy}>View snapshot →</button><button type="button" className="picker-cancel" onClick={() => setShowSubject(false)} aria-label="Cancel subject selection">×</button></div></form>}
<form className="message-form" onSubmit={sendQuestion}><textarea ref={inputRef} rows={2} aria-label="Message the CRC assistant" placeholder="Ask about your study data…" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendQuestion() } }} /><div className="composer-bottom"><span><i /> EDC snapshot <span className="composer-divider">/</span> CRC</span>{busy ? <button className="send-button stop" type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop request">■</button> : <button className="send-button" type="submit" disabled={!input.trim()} aria-label="Send message">↑</button>}</div></form><p>Verify important findings against source records.</p></footer>
  </div>
}
