import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { resolveDbPath } from './config'
import { openDb } from './db'
import { registerIpc } from './ipc'
import { purgeTemp, setPhotoDir } from './photoStore'
import { setBackupDir } from './services/backup'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://wa.me/')) void shell.openExternal(url) // WhatsApp click-to-chat only
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  const dbPath = resolveDbPath(app.getPath('userData'))
  console.log(`[mars-pos] database: ${dbPath}`)
  openDb(dbPath)
  setPhotoDir(join(app.getPath('userData'), 'photos'))
  purgeTemp(24 * 60 * 60 * 1000) // photos chosen but never saved
  setBackupDir(join(app.getPath('userData'), 'backups')) // until a USB / second-disk folder is chosen in Settings
  registerIpc()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
