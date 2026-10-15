import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os, { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { randomBytes } from 'node:crypto'

const messageCount = readPositiveInteger('--messages', 300)
const concurrency = readPositiveInteger('--concurrency', 10)
const outputPath = process.argv.find(item => item.startsWith('--output='))?.slice('--output='.length)
const dataDir = await mkdtemp(path.join(tmpdir(), 'prosa-benchmark-'))
const port = await reservePort()
const origin = `http://127.0.0.1:${port}`
const service = spawn(process.execPath, ['dist-server/index.cjs'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), PROSA_DATA_DIR: dataDir, PROSA_NO_LISTEN: '0' },
  stdio: ['ignore', 'ignore', 'pipe'],
})

let serviceError = ''
service.stderr.setEncoding('utf8').on('data', chunk => { serviceError += chunk })
const stopService = async () => {
  if (service.exitCode !== null || service.signalCode !== null) return
  service.kill('SIGTERM')
  await Promise.race([new Promise(resolve => service.once('exit', resolve)), delay(5000)])
  if (service.exitCode === null && service.signalCode === null) service.kill('SIGKILL')
}

try {
  const startupStarted = performance.now()
  await waitUntilHealthy()
  const startupMs = performance.now() - startupStarted
  const suffix = randomBytes(4).toString('hex')
  const alice = await register(`bench_a_${suffix}`, 'Prosa Bench A')
  const bruno = await register(`bench_b_${suffix}`, 'Prosa Bench B')
  await request('/friend-requests', alice.token, { method: 'POST', body: JSON.stringify({ username: bruno.user.username }) })
  const friendship = await request('/friend-requests', bruno.token, { method: 'POST', body: JSON.stringify({ username: alice.user.username }) })
  if (friendship.status !== 'accepted' || !friendship.conversationId) throw new Error('Não foi possível preparar uma conversa real para a medição.')
  const conversationId = friendship.conversationId

  for (let index = 0; index < Math.min(20, messageCount); index++) {
    await request(`/conversations/${conversationId}/messages`, alice.token, { method: 'POST', body: JSON.stringify({ text: `aquecimento ${index}` }) })
  }

  const latencies = []
  let nextMessage = 0
  const measurementStarted = performance.now()
  await Promise.all(Array.from({ length: Math.min(concurrency, messageCount) }, async () => {
    while (nextMessage < messageCount) {
      const index = nextMessage++
      const startedAt = performance.now()
      const response = await request(`/conversations/${conversationId}/messages`, alice.token, {
        method: 'POST', body: JSON.stringify({ text: `medição ${index}` }),
      })
      if (!response.message?.id) throw new Error('A API não persistiu a mensagem medida.')
      latencies.push(performance.now() - startedAt)
    }
  }))
  const elapsedMs = performance.now() - measurementStarted
  let historyCount = 0
  let cursor = null
  do {
    const page = await request(`/conversations/${conversationId}/messages?limit=100${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`, bruno.token)
    historyCount += page.messages.length
    cursor = page.nextCursor
  } while (cursor)
  const expectedTotal = Math.min(20, messageCount) + messageCount
  if (historyCount !== expectedTotal) throw new Error(`Histórico inconsistente: esperadas ${expectedTotal}, recebidas ${historyCount}.`)

  latencies.sort((left, right) => left - right)
  const report = {
    benchmark: 'prosa-service-message-write',
    measuredAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() },
    host: { cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
    workload: { messages: messageCount, concurrency, warmupMessages: Math.min(20, messageCount), database: 'SQLite temporário', transport: 'HTTP local sem TLS' },
    result: {
      serviceStartupMs: round(startupMs),
      elapsedMs: round(elapsedMs),
      writesPerSecond: round(messageCount / (elapsedMs / 1000)),
      latencyMs: { p50: percentile(latencies, 0.50), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99), max: round(latencies.at(-1)) },
      persistedMessages: historyCount,
    },
    scope: 'Uma execução local de escrita concorrente; não é uma comparação entre serviços, não inclui clientes gráficos, mídia, TLS ou rede externa.',
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) {
    const destination = path.resolve(outputPath)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, json, 'utf8')
  }
  console.log(json)
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), serviceError }))
  process.exitCode = 1
} finally {
  await stopService()
  await rm(dataDir, { recursive: true, force: true })
}

async function request(route, token, init = {}) {
  const response = await fetch(`${origin}/api${route}`, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  if (!response.ok) throw new Error(`${response.status} ${route}: ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}

async function register(username, displayName) {
  return request('/auth/register', undefined, {
    method: 'POST',
    body: JSON.stringify({ username, displayName, password: 'BenchmarkProsa!2026' }),
  })
}

async function waitUntilHealthy() {
  const deadline = performance.now() + 20_000
  while (performance.now() < deadline) {
    if (service.exitCode !== null) throw new Error(`O serviço encerrou durante a inicialização. ${serviceError}`)
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) return
    } catch {}
    await delay(100)
  }
  throw new Error(`Tempo excedido aguardando a API. ${serviceError}`)
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Não foi possível obter uma porta livre.')
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

function readPositiveInteger(name, fallback) {
  const argument = process.argv.find(item => item.startsWith(`${name}=`))
  const value = Number(argument?.slice(name.length + 1) ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) throw new Error(`${name} deve ser um inteiro entre 1 e 100000.`)
  return value
}

function percentile(sortedValues, fraction) {
  return round(sortedValues[Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)])
}

function round(value) {
  return Math.round(value * 100) / 100
}
