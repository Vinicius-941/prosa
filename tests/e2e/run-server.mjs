import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dataDir = mkdtempSync(path.join(tmpdir(), 'prosa-ui-e2e-'))
const nodeModules = path.join(root, 'node_modules')
const children = []
let stopping = false

function launch(script, args, overrides = {}) {
  const child = spawn(process.execPath, [path.join(nodeModules, script), ...args], {
    cwd: root,
    env: { ...process.env, ...overrides },
    stdio: 'inherit',
    windowsHide: true,
  })
  children.push(child)
  return child
}

const api = launch('tsx/dist/cli.mjs', ['server/index.ts'], {
  HOST: '127.0.0.1',
  PORT: '18788',
  CLIENT_ORIGIN: 'http://127.0.0.1:5174',
  NODE_ENV: 'development',
  PROSA_DATA_DIR: dataDir,
  PROSA_NO_LISTEN: '0',
})
const vite = launch('vite/bin/vite.js', ['--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
  VITE_API_URL: 'http://127.0.0.1:18788/api',
})

function stopChildren() {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill()
}

async function stop() {
  stopChildren()
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))))
  rmSync(dataDir, { recursive: true, force: true })
}

process.once('SIGINT', () => { void stop().finally(() => process.exit(130)) })
process.once('SIGTERM', () => { void stop().finally(() => process.exit(143)) })
process.once('exit', stopChildren)

async function waitFor(url, child, label) {
  const started = Date.now()
  while (Date.now() - started < 55_000) {
    if (child.exitCode !== null) throw new Error(`${label} exited with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`${label} did not become ready: ${url}`)
}

try {
  await waitFor('http://127.0.0.1:18788/api/health', api, 'Prosa API')
  await waitFor('http://127.0.0.1:5174/', vite, 'Vite UI')
  await new Promise(resolve => { const timer = setInterval(() => { if (stopping) { clearInterval(timer); resolve() } }, 1000) })
} catch (error) {
  console.error(error)
  await stop()
  process.exitCode = 1
}
