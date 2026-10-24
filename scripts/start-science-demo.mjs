import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const result=spawnSync(process.execPath,['scripts/create-science-fixture.mjs'],{cwd:root,stdio:'inherit'})
if(result.status)process.exit(result.status)
process.env.EDC_DB_PATH=path.join(root,'data/science-fixture.sqlite')
process.env.PORT=process.env.SCIENCE_DEMO_PORT||'3004'
process.env.AI_PROVIDER ||= 'ollama'
await import('../src/server/server.js')
