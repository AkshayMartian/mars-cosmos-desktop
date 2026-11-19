import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { resolveDbPath } from './config'
import { openDb } from './db'
import { registerIpc } from './ipc'
import { enableSerialsEverywhere } from './services/catalogue'
import { purgeTemp, setPhotoDir } from './photoStore'
import { autoBackupIfDue, setBackupDir } from './services/backup'

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

// One copy of the app per PC: a second launch brings the open window forward.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) { if (w.isMinimized()) w.restore(); w.focus() }
})

app.whenReady().then(() => {
  const dbPath = resolveDbPath(app.getPath('userData'))
  console.log(`[mars-pos] database: ${dbPath}`)
  openDb(dbPath)
  enableSerialsEverywhere() // every product has serial numbers; stock already in the shop gets its serials once
  setPhotoDir(join(app.getPath('userData'), 'photos'))
  purgeTemp(24 * 60 * 60 * 1000) // photos chosen but never saved
  setBackupDir(join(app.getPath('userData'), 'backups')) // until a USB / second-disk folder is chosen in Settings
  registerIpc()
  autoBackupIfDue()
  // A shop that leaves the app open all night still gets its daily backup: look again every hour.
  setInterval(autoBackupIfDue, 60 * 60 * 1000)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
