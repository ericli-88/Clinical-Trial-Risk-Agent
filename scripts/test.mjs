import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, EDC_DB_PATH: path.join(root, 'data/synthetic.sqlite'), EDC_DEMO: 'true' }
const fixture = spawnSync(process.execPath, ['scripts/create-demo-data.mjs'], { cwd: root, env, stdio: 'inherit' })
if (fixture.status) process.exit(fixture.status)
const result = spawnSync(process.execPath, ['--test', 'src/server/crcAgent.test.js', 'src/server/model_client/chatModelClient.test.js'], { cwd: root, env, stdio: 'inherit' })
process.exit(result.status || 0)
