import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { ImportPreview } from '@shared/catalogue'
import { previewFile, templateBuffer } from './services/importer'
import { requireRole } from './services/session'

/** Native file dialogs. Kept apart from services so those stay free of Electron and testable. */

export async function saveImportTemplate(): Promise<string | null> {
  requireRole('owner', 'manager')
  const r = await dialog.showSaveDialog({ defaultPath: 'mars-products-template.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, await templateBuffer())
  return r.filePath
}

export async function chooseImportFile(): Promise<ImportPreview | null> {
  requireRole('owner', 'manager')
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Excel or CSV', extensions: ['xlsx', 'csv'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  return previewFile(r.filePaths[0])
}
