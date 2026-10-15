const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const { once } = require('node:events')

let service
let database
let socketServer
const hasSingleInstanceLock = app.requestSingleInstanceLock()

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
