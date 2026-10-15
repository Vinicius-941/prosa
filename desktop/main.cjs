const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron')
const path = require('node:path')
const { once } = require('node:events')
const { readFile, writeFile, rename, unlink, mkdir } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { linuxAutostartDesktopFile } = require('./startup.cjs')

const isolatedProfile = process.argv.find(argument => argument.startsWith('--prosa-test-user-data='))?.slice('--prosa-test-user-data='.length)
if (isolatedProfile) app.setPath('userData', path.resolve(isolatedProfile))

let service
let database
let socketServer
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const secureSessionPath = () => path.join(app.getPath('userData'), 'secure-session.bin')
const trustedPage = pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html')).href

function assertTrustedFrame(event) {
  const url = event.senderFrame?.url
  if (url !== trustedPage && !url?.startsWith(`${trustedPage}#`)) throw new Error('Origem da solicitação inválida.')
}

async function requireSecureStorage() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('O armazenamento seguro do sistema está indisponível.')
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('Configure um chaveiro do sistema para salvar a sessão com segurança.')
}

function loginItemOptions() { return { path: process.execPath, args: [app.getAppPath()] } }
function startupFilePath() { return path.join(path.resolve(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config')), 'autostart', 'prosa.desktop') }

ipcMain.handle('prosa:startup:get', async event => {
  assertTrustedFrame(event)
  if (process.platform === 'win32') return app.getLoginItemSettings(loginItemOptions()).openAtLogin
  if (process.platform === 'linux') {
    try { return (await readFile(startupFilePath(), 'utf8')).includes('X-Prosa-Autostart=true') }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error }
  }
  throw new Error('Inicialização automática não está disponível neste sistema.')
})
ipcMain.handle('prosa:startup:set', async (event, enabled) => {
  assertTrustedFrame(event)
  if (typeof enabled !== 'boolean') throw new Error('Opção inválida.')
  if (process.platform === 'win32') return app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: enabled })
  if (process.platform === 'linux') {
    const file = startupFilePath()
    if (!enabled) {
      try {
        if ((await readFile(file, 'utf8')).includes('X-Prosa-Autostart=true')) await unlink(file)
      } catch (error) { if (error?.code !== 'ENOENT') throw error }
      return
    }
    try {
      if (!(await readFile(file, 'utf8')).includes('X-Prosa-Autostart=true')) throw new Error('Já existe uma entrada de inicialização com esse nome.')
    } catch (error) { if (error?.code !== 'ENOENT') throw error }
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, linuxAutostartDesktopFile(process.execPath, app.getAppPath()), { mode: 0o600 })
    return
  }
  throw new Error('Inicialização automática não está disponível neste sistema.')
})

ipcMain.handle('prosa:session:get', async event => {
  assertTrustedFrame(event)
  try {
    const encrypted = await readFile(secureSessionPath())
    await requireSecureStorage()
    return (await safeStorage.decryptStringAsync(encrypted)).result
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
})
ipcMain.handle('prosa:session:set', async (event, token) => {
  assertTrustedFrame(event)
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw new Error('Sessão inválida.')
  await requireSecureStorage()
  const file = secureSessionPath()
  const pendingFile = `${file}.tmp`
  await writeFile(pendingFile, await safeStorage.encryptStringAsync(token), { mode: 0o600 })
  await rename(pendingFile, file)
})
ipcMain.handle('prosa:session:clear', async event => {
  assertTrustedFrame(event)
  try { await unlink(secureSessionPath()) } catch (error) { if (error?.code !== 'ENOENT') throw error }
})

if (!hasSingleInstanceLock) app.quit()

async function startService() {
  process.env.HOST = '127.0.0.1'
  process.env.PORT = '0'
  process.env.CLIENT_ORIGIN = 'null'
  process.env.PROSA_DATA_DIR = path.join(app.getPath('userData'), 'data')

  const entry = path.join(app.getAppPath(), 'dist-server', 'index.cjs')
  const backend = require(entry)
  service = backend.httpServer
  database = backend.db
  socketServer = backend.io
  if (!service.listening) await once(service, 'listening')
  const address = service.address()
  if (!address || typeof address === 'string') throw new Error('O serviço local não iniciou corretamente.')
  return `http://127.0.0.1:${address.port}/api`
}

async function createWindow(apiUrl) {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#111014',
    title: 'Prosa',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      additionalArguments: [`--prosa-api=${apiUrl}`],
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  await window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  try {
    const apiUrl = await startService()
    await createWindow(apiUrl)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(apiUrl)
    })
  } catch (error) {
    console.error('O Prosa não conseguiu iniciar o serviço local.', error)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (socketServer) socketServer.close(() => { if (database?.open) database.close() })
  else if (service?.listening) service.close(() => { if (database?.open) database.close() })
  else if (database?.open) database.close()
})
