/**
 * Writes the product import Excel file, using the categories in the shop's database.
 *   npm run template -- "C:\path\to\mars-products-import.xlsx"
 * The database is the one the app uses (MARS_DB_PATH, or config.json, or the default).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { resolveDbPath } from '../src/main/config'
import { buildTemplate } from '../src/main/services/importTemplate'
import { sampleRows } from './sample-products'

const gst = (mode: string, rate: number) => (mode === 'auto' ? 'Clothing auto (5% / 18%)' : mode === 'fixed' ? `${rate}% fixed` : 'Exempt')

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const out = args.find((a) => !a.startsWith('--'))
  const sample = args.includes('--sample')
  if (!out) throw new Error('Usage: npm run template -- <output .xlsx path> [--sample]')

  const dbPath = resolveDbPath(join(process.env['APPDATA'] ?? '', 'mars-pos'))
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const cats = db.prepare('SELECT name,hsn,gst_mode AS mode,gst_rate AS rate FROM categories WHERE is_service=0 ORDER BY name').all() as { name: string; hsn: string; mode: string; rate: number }[]
  db.close()

  const rows = sample ? sampleRows(cats.map((c) => c.name)) : []
  writeFileSync(out, await buildTemplate(cats.map((c) => ({ name: c.name, hsn: c.hsn, gst: gst(c.mode, c.rate) })), rows))
  console.log(`Wrote ${out}${sample ? ` with ${rows.length} sample rows` : ''}\nCategories from ${dbPath}: ${cats.map((c) => c.name).join(', ')}`)
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
