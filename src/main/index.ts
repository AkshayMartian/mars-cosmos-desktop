import { app, BrowserWindow, shell } from 'electron'
import { startLogoSync, storedIcon } from './logo'
import icon from '../../build/icon.ico?asset'
import { join } from 'node:path'
import { resolveDbPath, resolveLicenceServer } from './config'
import { refreshLicence, setLicenceServer } from './services/licence'
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
    icon: storedIcon() ?? icon, // the downloaded logo if there is one, else the built-in icon
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
  // licence server: MARS_LICENCE_URL / config.json; a dev run (npm run dev) falls back to the local admin portal on :4100 (set MARS_LICENCE_URL=http://localhost:4000 for the fake test server, npm run licence-server)
  const configuredServer = resolveLicenceServer(app.getPath('userData'))
  setLicenceServer(configuredServer || (app.isPackaged ? '' : 'http://localhost:4100'))
  if (!configuredServer && !app.isPackaged) {
    // development only: stand in for the admin portal, with its secrets read from .local-server/ (git-ignored, never packaged). Without that folder the app uses the portal on :4100.
    void import('./devserver')
      .then((m) => m.startDevServer(app.getAppPath()))
      .then((srv) => { if (srv) { setLicenceServer(srv.url); app.on('will-quit', () => void srv.close()) } })
      .catch((e: unknown) => console.error('[mars-pos] embedded dev server not started:', e instanceof Error ? e.message : e))
      .finally(() => void refreshLicence())
  } else void refreshLicence() // about weekly while online; never blocks the shop
  setInterval(() => void refreshLicence(), 6 * 60 * 60 * 1000)
  startLogoSync() // first start with internet downloads the logo into the database; later starts only act if its address changed
  autoBackupIfDue()
  // A shop that leaves the app open all night still gets its daily backup: look again every hour.
  setInterval(autoBackupIfDue, 60 * 60 * 1000)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
