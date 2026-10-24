import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const fixture=spawnSync(process.execPath,['scripts/create-science-fixture.mjs'],{cwd:root,stdio:'inherit'})
if(fixture.status)process.exit(fixture.status)
const result=spawnSync(process.execPath,['--test','src/server/scienceCharts.test.js'],{cwd:root,env:{...process.env,EDC_DB_PATH:path.join(root,'data/science-fixture.sqlite'),EDC_DEMO:'true'},stdio:'inherit'})
process.exit(result.status||0)
