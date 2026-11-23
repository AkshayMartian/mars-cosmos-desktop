/**
 * Search boxes: every word typed must match one of the columns, so "blue shirt" finds a Blue colour of a Shirt
 * and "slim 40" finds size 40 of Slim Fit. % and _ typed by the user are plain characters, not wildcards.
 * Returns an SQL condition with ? placeholders and its arguments; an empty search matches everything.
 */
export function likeAll(q: string, columns: string[]): { sql: string; args: string[] } {
  const words = (q ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { sql: '1', args: [] }
  const args: string[] = []
  const parts = words.map((w) => {
    const like = `%${w.replace(/[\\%_]/g, '\\$&')}%`
    for (let i = 0; i < columns.length; i++) args.push(like)
    return '(' + columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')'
  })
  return { sql: '(' + parts.join(' AND ') + ')', args }
}
