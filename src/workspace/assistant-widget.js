(() => {
  if (window.TrialDataAssistant) return
  const script = document.currentScript
  const assistantUrl = new URL(script?.dataset.assistantSrc || '/assistant/?embedded=true', location.href)
  const bot = '<svg viewBox="0 0 24 24" width="27" height="27" fill="none" aria-hidden="true"><path d="M12 3v3M10.5 3h3M5 10H3v6h2m14-6h2v6h-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><rect x="5" y="6" width="14" height="14" rx="5" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><path d="M9 16h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  const host = document.createElement('div')
  host.id = 'trialdata-assistant-widget'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>
    :host{all:initial;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;position:fixed;bottom:0;right:0;z-index:10000;color:#655172}*{box-sizing:border-box}button,select{font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible{outline:3px solid #c5acec;outline-offset:3px}[hidden]{display:none!important}.launcher{position:fixed;bottom:25px;right:29px;display:flex;gap:10px;align-items:center;border:none;border-radius:18px 18px 5px 18px;background:linear-gradient(135deg,#9c7bd8,#805cc3);color:white;padding:13px 18px;box-shadow:0 5px 24px #8562b643;transition:transform .2s}.launcher:hover{transform:translateY(-3px)}.launcher>span{font-size:11px;font-weight:500;letter-spacing:.1px}.launcher i{position:absolute;width:7px;height:7px;background:#bce0c9;border:2px solid #a48acb;border-radius:50%;left:35px;top:13px}.panel{position:fixed;bottom:24px;right:26px;width:430px;height:min(760px,calc(100dvh - 48px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);background:white;border:1px solid #e4d9ef;border-radius:19px;box-shadow:0 18px 80px #4d306331,0 2px 10px #4d306310;display:flex;flex-direction:column;overflow:hidden;animation:reveal .2s ease}.panel.expanded{width:min(820px,calc(100vw - 48px));height:calc(100dvh - 48px)}.panel.fullscreen{inset:16px;width:calc(100vw - 32px);height:calc(100dvh - 32px);max-width:none}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 15px;background:#faf8fd;border-bottom:1px solid #efe8f7;flex-shrink:0}.toolbar>span{font-size:8px;letter-spacing:1.1px;color:#b4a0c4;font-weight:600}.window-actions{display:flex;align-items:center;gap:7px}.window-actions select{border:1px solid #e7ddef;background:white;color:#9c86ad;border-radius:5px;padding:3px 5px;font-size:9px}.window-actions button{border:none;background:none;color:#af97c1;padding:3px;width:23px;height:23px;font-size:19px;line-height:1}.window-actions button:hover{background:#f0e8f8;border-radius:4px}iframe{flex:1;width:100%;min-height:0;border:none;background:white}.tip{position:fixed;right:28px;bottom:96px;background:white;border:1px solid #eee5f5;box-shadow:0 4px 18px #61417d0a;border-radius:10px;padding:12px 32px 12px 14px;font-size:10px;color:#ad97bc}.tip button{position:absolute;right:6px;top:6px;border:none;background:none;color:#c5b2cf;font-size:15px}.tip::after{content:'';position:absolute;bottom:-5px;right:32px;width:8px;height:8px;transform:rotate(45deg);background:white;border-right:1px solid #eee5f5;border-bottom:1px solid #eee5f5}.resize-grip{position:absolute;top:0;left:0;width:15px;height:15px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 45%,#ddd1e8 45%,#ddd1e8 52%,transparent 52%);touch-action:none}.panel.fullscreen .resize-grip{display:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes reveal{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@media(max-width:600px){.launcher{bottom:18px;right:17px;padding:12px 15px}.panel,.panel.expanded,.panel.fullscreen{bottom:8px;right:8px;top:auto;left:auto;width:calc(100vw - 16px);height:calc(100dvh - 16px);max-width:none;max-height:none;border-radius:14px}.resize-grip{display:none}.tip{right:17px;bottom:87px;font-size:9px}.window-actions select{font-size:10px}}@media(prefers-reduced-motion:reduce){.panel{animation:none}.launcher{transition:none}}
  </style><div class="tip">A little help with your study day?<button aria-label="Dismiss assistant hint">×</button></div><button class="launcher" aria-label="Open CRC assistant" aria-haspopup="dialog" aria-expanded="false">${bot}<i></i><span>Ask TrialData</span></button><section class="panel" role="dialog" aria-label="TrialData CRC assistant" hidden><div class="resize-grip" title="Drag to resize the assistant"></div><header class="toolbar"><span>YOUR STUDY COMPANION</span><div class="window-actions"><label class="sr-only" for="assistant-size">Assistant window size</label><select id="assistant-size"><option value="compact">Compact</option><option value="expanded">Expanded</option><option value="fullscreen">Full screen</option></select><button class="minimize" aria-label="Minimize assistant" title="Minimize">−</button><button class="close" aria-label="Close assistant" title="Close">×</button></div></header><iframe title="CRC assistant conversation" hidden></iframe></section>`
  document.body.append(host)
  const launcherStyle = document.createElement('style')
  launcherStyle.textContent = `
    .tip{display:none!important}
    .launcher{left:20px;right:auto;bottom:24px;width:52px;height:52px;padding:0;display:grid;place-items:center;border:2px solid #fff;border-radius:50%;background:#2563eb;color:#fff;box-shadow:0 4px 12px #1e40af30,0 1px 3px #10182820;touch-action:none;user-select:none;cursor:grab;transition:background .15s}
    .launcher:hover{transform:none;background:#1d4ed8}.launcher.dragging{cursor:grabbing;background:#1e40af}.launcher:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}.launcher svg{width:31px;height:31px;pointer-events:none}.launcher>span,.launcher i{display:none}
    .panel{bottom:auto;right:auto;left:16px;top:16px;width:450px;height:600px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:6px;border-color:#d0d5dd;box-shadow:0 5px 24px #0000001a;animation:none}
    .toolbar{background:#f9fafb;border-color:#eaecf0;padding:8px 12px}.toolbar>span{color:#667085;letter-spacing:0;font-size:11px;font-weight:500}.window-actions select{color:#475467;border-color:#d0d5dd;border-radius:3px}.window-actions button{color:#667085}
    .panel.expanded{width:min(800px,calc(100vw - 16px));height:calc(100dvh - 16px)}.panel.fullscreen{inset:8px;width:calc(100vw - 16px);height:calc(100dvh - 16px)}
    @media(max-width:600px){.panel,.panel.expanded{left:8px;top:8px;right:auto;bottom:auto;width:calc(100vw - 16px);height:calc(100dvh - 16px);border-radius:6px}.launcher{padding:0;right:auto;bottom:auto}.resize-grip{display:none}}
  `
  shadow.append(launcherStyle)
  const panel = shadow.querySelector('.panel'), launcher = shadow.querySelector('.launcher'), frame = shadow.querySelector('iframe'), tip = shadow.querySelector('.tip'), size = shadow.querySelector('select')
  launcher.replaceChildren()
  launcher.innerHTML = bot
  launcher.title = 'CRC assistant — drag to move, click to chat'
  shadow.querySelector('.toolbar>span').textContent = 'CRC assistant'
  const POSITION_KEY = 'trialdata:robot-position:v1'
  const LAUNCHER_SIZE = 52
  const margin = 12
  let position = { x: 20, y: innerHeight - LAUNCHER_SIZE - 24 }
  let launcherDrag = null, suppressDragClick = false
  const clamp = (value, min, max) => Math.min(Math.max(min, max), Math.max(min, value))
  function placeLauncher(x, y, save = false) {
    position = { x: clamp(x, margin, innerWidth - LAUNCHER_SIZE - margin), y: clamp(y, margin, innerHeight - LAUNCHER_SIZE - margin) }
    launcher.style.left = `${position.x}px`
    launcher.style.top = `${position.y}px`
    launcher.style.bottom = 'auto'
    if (save) { try { localStorage.setItem(POSITION_KEY, JSON.stringify(position)) } catch {} }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY))
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) position = saved
  } catch {}
  placeLauncher(position.x, position.y)
  function placePanel() {
    if (panel.hidden) return
    if (size.value === 'fullscreen') { panel.style.left = ''; panel.style.top = ''; return }
    const width = panel.offsetWidth, height = panel.offsetHeight
    panel.style.left = `${clamp(position.x, margin, innerWidth - width - margin)}px`
    const above = position.y - height - 10
    const below = position.y + LAUNCHER_SIZE + 10
    const top = above >= margin ? above : below + height <= innerHeight - margin ? below : margin
    panel.style.top = `${clamp(top, margin, innerHeight - height - margin)}px`
  }
  launcher.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return
    launcherDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: position.x, top: position.y, moved: false }
    launcher.setPointerCapture(event.pointerId)
  })
  launcher.addEventListener('pointermove', event => {
    if (!launcherDrag || event.pointerId !== launcherDrag.id) return
    const dx = event.clientX - launcherDrag.x, dy = event.clientY - launcherDrag.y
    if (!launcherDrag.moved && Math.hypot(dx, dy) < 5) return
    launcherDrag.moved = true
    launcher.classList.add('dragging')
    placeLauncher(launcherDrag.left + dx, launcherDrag.top + dy)
    event.preventDefault()
  })
  launcher.addEventListener('pointerup', event => {
    if (!launcherDrag || event.pointerId !== launcherDrag.id) return
    suppressDragClick = launcherDrag.moved
    if (launcherDrag.moved) placeLauncher(position.x, position.y, true)
    launcherDrag = null
    launcher.classList.remove('dragging')
    if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId)
  })
  function cancelLauncherDrag() { launcherDrag = null; suppressDragClick = false; launcher.classList.remove('dragging') }
  launcher.addEventListener('pointercancel', cancelLauncherDrag)
  launcher.addEventListener('lostpointercapture', () => { if (launcherDrag) cancelLauncherDrag() })
  launcher.addEventListener('keydown', event => {
    const moves = { ArrowLeft: [-10,0], ArrowRight: [10,0], ArrowUp: [0,-10], ArrowDown: [0,10] }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    placeLauncher(position.x + move[0], position.y + move[1], true)
  })
  window.addEventListener('resize', () => { placeLauncher(position.x, position.y); placePanel() })
  let ready = false, pendingAction = null, lastFocused = null
  function dispatchAction() { if (ready && pendingAction) { frame.contentWindow.postMessage({ type: 'trialdata:action', ...pendingAction }, assistantUrl.origin); pendingAction = null } }
  function open(action, subjectId) {
    lastFocused = document.activeElement
    tip.hidden = true; panel.hidden = false; launcher.hidden = true; launcher.setAttribute('aria-expanded','true')
    if (action) pendingAction = { action, subjectId }
    if (!frame.src) { frame.src = assistantUrl.href; frame.hidden = false }
    dispatchAction()
    placePanel()
    size.focus()
  }
  function close() { panel.hidden = true; launcher.hidden = false; launcher.setAttribute('aria-expanded','false'); (lastFocused?.isConnected ? lastFocused : launcher).focus() }
  launcher.addEventListener('click', event => { if (suppressDragClick && event.detail !== 0) { suppressDragClick = false; event.preventDefault(); return } suppressDragClick = false; open() })
  shadow.querySelector('.tip button').addEventListener('click', () => { tip.hidden = true })
  shadow.querySelector('.close').addEventListener('click', close)
  shadow.querySelector('.minimize').addEventListener('click', close)
  size.addEventListener('change', () => { panel.style.width = ''; panel.style.height = ''; panel.className = `panel ${size.value === 'compact' ? '' : size.value}`; placePanel() })
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== assistantUrl.origin) return
    if (event.data?.type === 'trialdata:ready') { ready = true; dispatchAction() }
    if (event.data?.type === 'trialdata:close') close()
  })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) close() })
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape') close() })
  document.addEventListener('click', event => { const action = event.target.closest('[data-agent-action]'); if (action) open(action.dataset.agentAction, action.dataset.subjectId) })
  const grip = shadow.querySelector('.resize-grip')
  let drag
  grip.addEventListener('pointerdown', event => { if (innerWidth <= 600) return; drag = { x: event.clientX, y: event.clientY, width: panel.offsetWidth, height: panel.offsetHeight }; grip.setPointerCapture(event.pointerId); frame.style.pointerEvents = 'none'; event.preventDefault() })
  grip.addEventListener('pointermove', event => { if (!drag) return; panel.style.width = `${Math.min(innerWidth-48, Math.max(360, drag.width + drag.x-event.clientX))}px`; panel.style.height = `${Math.min(innerHeight-48, Math.max(420, drag.height+drag.y-event.clientY))}px` })
  const finishDrag = () => { drag = null; frame.style.pointerEvents = '' }
  grip.addEventListener('pointerup', finishDrag); grip.addEventListener('pointercancel', finishDrag)
  window.TrialDataAssistant = { open, close }
})()
