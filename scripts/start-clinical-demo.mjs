import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const generated=spawnSync(process.execPath,[path.join(root,'scripts/create-clinical-fixture.mjs')],{cwd:root,stdio:'inherit'})
if(generated.status)process.exit(generated.status)
process.env.EDC_DB_PATH=path.join(root,'data/clinical-fixture.sqlite')
process.env.PORT=process.env.CLINICAL_DEMO_PORT||'3003'
process.env.AI_PROVIDER ||= 'ollama'
await import('../src/server/server.js')
