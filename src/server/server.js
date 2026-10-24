import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.env.EDC_DB_PATH ||= path.join(root, 'data/synthetic.sqlite')
process.env.EDC_DEMO = path.resolve(process.env.EDC_DB_PATH) === path.join(root, 'data/synthetic.sqlite') ? 'true' : 'false'
if (!existsSync(process.env.EDC_DB_PATH)) throw new Error('Database missing. Run npm run demo:data or configure EDC_DB_PATH.')
const { registerCrcRoutes } = await import('./crcWorkspace.js')
const { registerCrcAgent } = await import('./crcAgent.js')
const { getModelRuntimeStatus } = await import('./model_client/chatModelClient.js')
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
registerCrcRoutes(app)
registerCrcAgent(app)
app.get('/api/model-status', (_req,res) => res.json(getModelRuntimeStatus()))
app.get('/health', (_req,res) => res.json({ status: 'ok', synthetic: process.env.EDC_DEMO === 'true' }))
app.use('/assistant', express.static(path.join(root, 'dist')))
app.use(express.static(path.join(root, 'src/workspace')))
app.listen(Number(process.env.PORT || 3002), '127.0.0.1', () => console.log(`Clinical Trial Risk Agent: http://127.0.0.1:${process.env.PORT || 3002} · ${process.env.EDC_DEMO === 'true' ? 'SYNTHETIC DEMO' : 'PRIVATE DATA'}`))
