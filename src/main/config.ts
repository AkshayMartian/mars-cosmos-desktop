import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the SQLite file lives. First match wins:
 *   1. MARS_DB_PATH environment variable (handy for developers)
 *   2. "dbPath" in <userData>\config.json, e.g. {"dbPath": "C:\\Users\\MARS\\Mars-Cosmos.db"}
 *   3. <userData>\mars-pos.db
 * No electron import, so it can be tested.
 */
export function resolveDbPath(userData: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env['MARS_DB_PATH']) return env['MARS_DB_PATH']
  try {
    const cfg = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as { dbPath?: unknown }
    if (typeof cfg.dbPath === 'string' && cfg.dbPath.trim()) return cfg.dbPath.trim()
  } catch {
    /* no config file (or unreadable): use the default */
  }
  return join(userData, 'mars-pos.db')
}
