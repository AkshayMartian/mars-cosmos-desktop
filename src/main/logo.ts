import { BrowserWindow, nativeImage } from 'electron'
import { LOGO_URL } from './brand'
import { logoRaster, syncLogo } from './services/branding'

let pending: Promise<unknown> = Promise.resolve()

/** Resolves once the start-up logo download has finished (or failed); the top bar waits on this. */
export const logoReady = (): Promise<unknown> => pending

/** Window and taskbar icon from the stored logo (PNG / JPEG only). Returns undefined to keep the built-in icon. */
export function storedIcon(): Electron.NativeImage | undefined {
  const raster = logoRaster()
  const img = raster ? nativeImage.createFromBuffer(raster) : undefined
  return img && !img.isEmpty() ? img : undefined
}

/** Called once at start-up: downloads the logo if its address is new, then refreshes the open windows' icon. */
export function startLogoSync(): void {
  pending = syncLogo(process.env['MARS_LOGO_URL'] || LOGO_URL).then((r) => {
    if (r !== 'downloaded') return
    const icon = storedIcon()
    if (icon) for (const w of BrowserWindow.getAllWindows()) w.setIcon(icon)
  })
}
