import { describe, expect, it } from 'vitest'
import { MENU, menuFor } from './types'
import { tourSteps } from './tour'

const ids = (r: Parameters<typeof menuFor>[0]) => menuFor(r).map((m) => m.id)

describe('guided tour', () => {
  it('starts with a welcome card, ends with a closing card, and has a step per menu item the role can open', () => {
    const steps = tourSteps('cashier', ids('cashier'))
    expect(steps[0]!.id).toBe('welcome')
    expect(steps.at(-1)!.id).toBe('done')
    for (const id of ids('cashier')) expect(steps.some((s) => s.target === 'menu-' + id), id).toBe(true)
  })
  it('never points at a menu item the person cannot see', () => {
    const steps = tourSteps('cashier', ids('cashier'))
    expect(steps.some((s) => s.target === 'menu-settings')).toBe(false)
    expect(tourSteps('owner', ids('owner')).some((s) => s.target === 'menu-settings')).toBe(true)
  })
  it('every menu item has tour text, and step ids are unique', () => {
    const steps = tourSteps('owner', MENU.map((m) => m.id))
    for (const m of MENU) expect(steps.some((s) => s.target === 'menu-' + m.id), m.id).toBe(true)
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
  })
  it('points at the replay button in the menu', () => { expect(tourSteps('owner', ids('owner')).some((s) => s.target === 'menu-tour')).toBe(true) })
})
