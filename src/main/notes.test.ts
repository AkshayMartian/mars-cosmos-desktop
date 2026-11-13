import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Keeps project-notes/ honest (rule: a task is not done until its notes are updated).
 * It fails when code and notes drift apart in ways a machine can see.
 */
const root = resolve(__dirname, '../..')
const notesDir = join(root, 'project-notes')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []
  })

const files = walk(notesDir)
const text = (f: string) => readFileSync(f, 'utf8')
const allNotes = files.map(text).join('\n')

describe('project-notes', () => {
  it('has the main README and the module template', () => {
    expect(existsSync(join(notesDir, 'README.md'))).toBe(true)
    expect(existsSync(join(notesDir, '_module-template.md'))).toBe(true)
  })

  it('documents every IPC channel the app registers (so no API is missing from the notes)', () => {
    const ipc = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')
    const channels = [...ipc.matchAll(/\bh\('([a-z]+:[A-Za-z]+)'/g)].map((m) => m[1]!)
    expect(channels.length).toBeGreaterThan(50) // the parser found the list
    const missing = channels.filter((c) => !allNotes.includes('`' + c + '`'))
    expect(missing, `channels not documented in project-notes: ${missing.join(', ')}`).toEqual([])
  })

  it('has no broken relative links', () => {
    const broken: string[] = []
    for (const f of files) {
      for (const m of text(f).matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
        const target = m[1]!.split('#')[0]!
        if (target && !existsSync(resolve(dirname(f), target))) broken.push(`${f.replace(root, '')} -> ${m[1]}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('links every module in the README to an existing note', () => {
    const readme = text(join(notesDir, 'README.md'))
    const links = [...readme.matchAll(/\]\(([a-z-]+\/[a-z-]+\.md)\)/g)].map((m) => m[1]!)
    expect(links.length).toBeGreaterThanOrEqual(16)
    for (const l of links) expect(existsSync(join(notesDir, l)), l).toBe(true)
  })

  it('has no "TBD" in a module marked done', () => {
    const readme = text(join(notesDir, 'README.md'))
    const done = [...readme.matchAll(/\| \[[^\]]+\]\(([a-z-]+\/[a-z-]+\.md)\) \| \*\*done\*\*/g)].map((m) => m[1]!)
    expect(done.length).toBeGreaterThanOrEqual(8)
    const withTbd = done.filter((d) => /\bTBD\b/.test(text(join(notesDir, d))))
    expect(withTbd).toEqual([])
  })

  it('names every table of the schema in the README', () => {
    const schema = readFileSync(join(root, 'src/main/db/schema.ts'), 'utf8')
    const tables = [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]!)
    const readme = text(join(notesDir, 'README.md'))
    const missing = tables.filter((t) => !readme.includes('`' + t + '`'))
    expect(missing, `tables not in the README schema section: ${missing.join(', ')}`).toEqual([])
  })

  it('lists every migration version in the migrations log', () => {
    const schema = readFileSync(join(root, 'src/main/db/schema.ts'), 'utf8')
    const versions = [...schema.matchAll(/version:\s*(\d+)/g)].map((m) => Number(m[1]))
    const readme = text(join(notesDir, 'README.md'))
    const log = readme.slice(readme.indexOf('### Migrations log'))
    for (const v of versions) expect(log, `migration ${v}`).toMatch(new RegExp(`\\|\\s*${v}\\s*\\|`))
  })
})
