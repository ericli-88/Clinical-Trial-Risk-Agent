import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'

const originalFetch = globalThis.fetch
const originalEnvironment = { API_KEY: process.env.API_KEY, AI_PROVIDER: process.env.AI_PROVIDER }
let sequence = 0
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})
async function client({ key = '', mode = 'auto' } = {}) {
  process.env.API_KEY = key
  process.env.AI_PROVIDER = mode
  return import(`./chatModelClient.js?test=${++sequence}`)
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

test('auto uses the installed Qwen model when no API key is configured', async () => {
  const model = await client()
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith('/api/chat'))
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'qwen3.5:9b')
    assert.equal(body.think, false)
    return json({ message: { content: 'Local answer' } })
  }
  const result = await model.callChatModel({ messages: [] })
  assert.equal(result.provider, 'ollama')
  assert.equal(result.content, 'Local answer')
})

test('auto retains remote API support with a configured key', async () => {
  const model = await client({ key: 'unit-test-key' })
  globalThis.fetch = async url => {
    assert.ok(url.endsWith('/chat/completions'))
    return json({ choices: [{ message: { content: 'Remote answer' } }] })
  }
  assert.equal((await model.callChatModel({ messages: [] })).provider, 'deepseek')
})

test('remote authentication errors fall back locally and avoid repeated failed API calls', async () => {
  const model = await client({ key: 'unit-test-key' })
  let remoteCalls = 0
  globalThis.fetch = async url => {
    if (url.endsWith('/chat/completions')) { remoteCalls++; return new Response('Unauthorized', { status: 401 }) }
    return json({ message: { content: 'Local fallback' } })
  }
  assert.equal((await model.callChatModel({ messages: [] })).provider, 'ollama')
  assert.equal((await model.callChatModel({ messages: [] })).provider, 'ollama')
  assert.equal(remoteCalls, 1)
  assert.ok(model.getModelRuntimeStatus().fallbackReason)
  assert.equal('API_KEY' in model.getModelRuntimeStatus(), false)
})

test('explicit remote mode leaves remote failures visible', async () => {
  const model = await client({ key: 'unit-test-key', mode: 'deepseek' })
  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 })
  await assert.rejects(model.callChatModel({ messages: [] }), /401/)
})

test('streaming uses Qwen with no API key and emits response text', async () => {
  const model = await client()
  globalThis.fetch = async () => new Response('{"message":{"content":"Hello "}}\n{"message":{"content":"CRC."},"done":true}\n')
  let text = ''
  const result = await model.streamChatModel({ messages: [], sendToken: token => { text += token } })
  assert.equal(result.provider, 'ollama')
  assert.equal(text, 'Hello CRC.')
})
