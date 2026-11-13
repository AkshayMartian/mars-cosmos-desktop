import { getDb } from '../db'
import type { Role } from '@shared/types'

/**
 * The main process, not the UI, remembers who is logged in. Every service asks
 * `current()`, so a handler can never be tricked into acting as someone else.
 */
export interface Actor {
  id: string
  name: string
  role: Role
  canChangePrice: boolean
  canCancel: boolean
}

let currentId: string | null = null
let pendingId: string | null = null // logged in with default PIN; must change it first

export const setCurrent = (id: string | null): void => { currentId = id; pendingId = null }
export const setPending = (id: string): void => { currentId = null; pendingId = id }
export const pending = (): string | null => pendingId

export function current(): Actor {
  if (!currentId) throw new Error('Not logged in.')
  const r = getDb()
    .prepare('SELECT id,name,role,can_change_price AS p,can_cancel AS c FROM staff WHERE id=? AND active=1')
    .get(currentId) as { id: string; name: string; role: Role; p: number; c: number } | undefined
  if (!r) throw new Error('Not logged in.')
  return { id: r.id, name: r.name, role: r.role, canChangePrice: !!r.p, canCancel: !!r.c }
}

export function requireRole(...roles: Role[]): Actor {
  const a = current()
  if (!roles.includes(a.role)) throw new Error('You are not allowed to do this.')
  return a
}
