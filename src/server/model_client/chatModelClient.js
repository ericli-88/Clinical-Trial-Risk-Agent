const API_KEY = process.env.API_KEY || ''
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:9b'
const AI_PROVIDER = (process.env.AI_PROVIDER || 'auto').toLowerCase()
const MODEL_REQUEST_TIMEOUT_MS = Number(process.env.MODEL_REQUEST_TIMEOUT_MS || 180000)
const LOCAL_FALLBACK_COOLDOWN_MS = Number(process.env.LOCAL_FALLBACK_COOLDOWN_MS || 300000)
let localFallbackUntil = 0
let fallbackReason = null
let lastUsedProvider = null

function hasUsableApiKey(value) {
  const key = String(value || '').trim()
  if (!key) return false
  return !/^(your_|your-|sk-xxx|example|placeholder|change_me|填入|替换)/i.test(key)
}

export function getActiveModelProvider() {
  if (AI_PROVIDER === 'ollama') return 'ollama'
  if (AI_PROVIDER === 'deepseek') return hasUsableApiKey(API_KEY) ? 'deepseek' : 'ollama'
  return hasUsableApiKey(API_KEY) && Date.now() >= localFallbackUntil ? 'deepseek' : 'ollama'
}

export function getModelRuntimeStatus() {
  const provider = getActiveModelProvider()
  return {
    mode: AI_PROVIDER,
    provider,
    model: provider === 'ollama' ? OLLAMA_MODEL : DEEPSEEK_MODEL,
    apiKeyConfigured: hasUsableApiKey(API_KEY),
    lastUsedProvider,
    fallbackReason: Date.now() < localFallbackUntil ? fallbackReason : null,
    localModel: OLLAMA_MODEL
  }
}

async function requestChat({ messages, stream = false, temperature = 0.2, label, signal }) {
  let provider = getActiveModelProvider()
  try {
    const response = provider === 'deepseek'
      ? await fetchDeepSeekChat({ messages, stream, temperature, label, signal })
      : await fetchOllamaChat({ messages, stream, temperature, label, signal })
    lastUsedProvider = provider
    return { provider, response }
  } catch (error) {
    if (signal?.aborted || provider !== 'deepseek' || AI_PROVIDER !== 'auto') throw error
    fallbackReason = /401|403/.test(error.message) ? 'Remote API authentication failed; using the local model.' : 'Remote API is unavailable; using the local model.'
    localFallbackUntil = Date.now() + LOCAL_FALLBACK_COOLDOWN_MS
    console.warn(fallbackReason)
    provider = 'ollama'
    const response = await fetchOllamaChat({ messages, stream, temperature, label, signal })
    lastUsedProvider = provider
    return { provider, response }
  }
}

function buildDeepSeekBody({ messages, stream = false, temperature = 0.2 }) {
  return {
    model: DEEPSEEK_MODEL,
    stream,
    thinking: { type: 'disabled' },
    messages,
    temperature
  }
}

function buildOllamaBody({ messages, stream = false, temperature = 0.2 }) {
  return {
    model: OLLAMA_MODEL,
    think: false,
    stream,
    messages,
    keep_alive: '15m',
    options: { temperature, top_p: 0.8, num_ctx: Number(process.env.OLLAMA_NUM_CTX || 16384), num_predict: 2048 }
  }
}

async function fetchDeepSeekChat({ messages, stream = false, temperature = 0.2, label = 'chat model', signal }) {
  if (!hasUsableApiKey(API_KEY)) {
    throw new Error('未配置可用 API_KEY')
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify(buildDeepSeekBody({ messages, stream, temperature }))
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`DeepSeek ${label} request failed: ${response.status} ${text.slice(0, 200)}`)
  }

  return response
}

async function fetchOllamaChat({ messages, stream = false, temperature = 0.2, label = 'chat model', signal }) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildOllamaBody({ messages, stream, temperature }))
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Ollama ${label} request failed: ${response.status} ${text.slice(0, 200)}`)
  }

  return response
}

export async function callChatModel({ messages, temperature = 0.2, label = 'chat model', signal }) {
  const { provider, response } = await requestChat({ messages, temperature, label, signal })

  const data = await response.json()
  if (provider === 'ollama' && data.done_reason === 'length') {
    throw new Error('The local model response reached its context or output limit. Please narrow the question.')
  }
  const content =
    provider === 'deepseek'
      ? data.choices?.[0]?.message?.content || ''
      : data.message?.content || data.response || ''

  return {
    provider,
    content,
    raw: data
  }
}

export async function streamChatModel({ messages, temperature = 0.2, label = 'chat model', sendToken }) {
  const { provider, response } = await requestChat({ messages, stream: true, temperature, label })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullAnswer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    if (provider === 'deepseek') {
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() || ''

      for (const block of blocks) {
        const line = block.split('\n').find((item) => item.startsWith('data: '))
        if (!line) continue

        const payload = line.replace('data: ', '').trim()
        if (payload === '[DONE]') return { provider, content: fullAnswer }

        const data = JSON.parse(payload)
        const token = data.choices?.[0]?.delta?.content || ''
        if (token) {
          fullAnswer += token
          sendToken?.(token)
        }
      }
      continue
    }

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      const data = JSON.parse(line)
      const token = data.message?.content || data.response || ''
      if (token) {
        fullAnswer += token
        sendToken?.(token)
      }
    }
  }

  if (provider === 'ollama' && buffer.trim()) {
    const data = JSON.parse(buffer)
    const token = data.message?.content || data.response || ''
    if (token) {
      fullAnswer += token
      sendToken?.(token)
    }
  }

  return { provider, content: fullAnswer }
}
