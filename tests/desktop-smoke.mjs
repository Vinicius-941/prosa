import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

const executable = path.resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Passe o caminho do executável desktop.')

const portServer = createServer()
await new Promise((resolve, reject) => portServer.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()))
const address = portServer.address()
if (!address || typeof address === 'string') throw new Error('Não foi possível reservar uma porta para DevTools.')
const debugPort = address.port
await new Promise((resolve, reject) => portServer.close(error => error ? reject(error) : resolve()))

const dataDirectory = await mkdtemp(path.join(tmpdir(), 'prosa-desktop-smoke-'))
const child = spawn(executable, [...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--remote-debugging-port=${debugPort}`, `--prosa-test-user-data=${dataDirectory}`], {
  stdio: 'inherit',
  env: { ...process.env, XDG_CONFIG_HOME: path.join(dataDirectory, 'xdg-config') },
})
let browser
let page
let startupToggle
let originalStartupState
let launchError
child.once('error', error => { launchError = error })
try {
  const startedAt = Date.now()
  let targets
  while (Date.now() - startedAt < 30_000) {
    if (launchError) throw launchError
    if (child.exitCode !== null) throw new Error(`O app encerrou durante a inicialização (${child.exitCode}).`)
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      if (response.ok) targets = await response.json()
      if (targets?.some(target => target.type === 'page')) break
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (!targets?.some(target => target.type === 'page')) throw new Error('A janela desktop não abriu dentro de 30 segundos.')

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  page = browser.contexts().flatMap(context => context.pages())[0]
  if (!page) throw new Error('O app não expôs uma página Chromium.')
  await page.locator('h1').waitFor({ state: 'visible', timeout: 10_000 })
  const result = await page.evaluate(async () => ({
    title: document.title,
    heading: document.querySelector('h1')?.textContent?.trim(),
    health: await fetch(`${window.prosaDesktop.apiUrl}/health`).then(response => response.status),
    width: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }))
  if (!result.title.includes('Prosa') || result.heading !== 'Seu espaço começa aqui.' || result.health !== 200) {
    throw new Error(`A verificação de inicialização falhou: ${JSON.stringify(result)}`)
  }
  if (result.contentWidth > result.width + 1) throw new Error(`A janela inicial tem rolagem horizontal: ${JSON.stringify(result)}`)
  if (process.env.PROSA_SMOKE_SCREENSHOT) {
    await mkdir(path.dirname(process.env.PROSA_SMOKE_SCREENSHOT), { recursive: true })
    await page.screenshot({ path: process.env.PROSA_SMOKE_SCREENSHOT })
  }

  await page.getByLabel('Como podemos te chamar?').fill('Conta descartável de QA')
  await page.getByLabel('Nome de usuário').fill(`smoke_${Date.now()}`)
  await page.getByLabel('Senha').fill('SenhaTemporaria!2026')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await page.getByRole('button', { name: /Abrir opções da conta/ }).waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByRole('button', { name: 'Abrir opções da conta' }).click()
  await page.getByRole('button', { name: 'Configurações' }).click()
  startupToggle = page.getByLabel('Iniciar o Prosa com o sistema')
  await startupToggle.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForFunction(() => {
    const toggle = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('Iniciar o Prosa com o sistema'))?.querySelector('input')
    return toggle && !toggle.disabled
  }, { timeout: 10_000 })
  originalStartupState = await startupToggle.isChecked()
  const nativeStartupState = await page.evaluate(() => window.prosaDesktop.getStartupEnabled())
  if (nativeStartupState !== originalStartupState) throw new Error(`Estado inicial divergente: interface=${originalStartupState}, sistema=${nativeStartupState}`)
  await startupToggle.click()
  await page.waitForFunction(async expected => {
    const toggle = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('Iniciar o Prosa com o sistema'))?.querySelector('input')
    return toggle?.checked === expected && await window.prosaDesktop.getStartupEnabled() === expected
  }, !originalStartupState)
  if (process.env.PROSA_SMOKE_SETTINGS_SCREENSHOT) {
    await mkdir(path.dirname(process.env.PROSA_SMOKE_SETTINGS_SCREENSHOT), { recursive: true })
    await page.screenshot({ path: process.env.PROSA_SMOKE_SETTINGS_SCREENSHOT })
  }
  console.log(`Desktop smoke passou: ${JSON.stringify({ ...result, startupSettings: 'leitura e alternância verificadas' })}`)
} finally {
  if (startupToggle && originalStartupState !== undefined && page?.isClosed() === false) {
    try {
      await page.evaluate(async expected => {
        if (await window.prosaDesktop.getStartupEnabled() !== expected) await window.prosaDesktop.setStartupEnabled(expected)
        if (await window.prosaDesktop.getStartupEnabled() !== expected) throw new Error('The original startup preference was not restored')
      }, originalStartupState)
    } catch (error) {
      console.error('Não foi possível restaurar a preferência de inicialização anterior.', error)
      process.exitCode = 1
    }
  }
  await browser?.close()
  if (child.exitCode === null) child.kill('SIGTERM')
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve()
    const timer = setTimeout(resolve, 5_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
  if (child.exitCode === null) child.kill('SIGKILL')
  await rm(dataDirectory, { recursive: true, force: true })
}
