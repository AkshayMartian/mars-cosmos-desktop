import { describe, expect, it } from 'vitest'
import { isNight, resolveTheme } from './theme'

const at = (h: number, m = 0) => new Date(2026, 10, 16, h, m)

describe('theme', () => {
  it('auto is dark from 7 pm to 7 am and light in the day', () => {
    expect(isNight(at(6, 59))).toBe(true)
    expect(isNight(at(7, 0))).toBe(false)
    expect(isNight(at(18, 59))).toBe(false)
    expect(isNight(at(19, 0))).toBe(true)
    expect(isNight(at(0, 30))).toBe(true)
  })
  it('light and dark ignore the clock', () => {
    expect(resolveTheme('light', at(23))).toBe('light')
    expect(resolveTheme('dark', at(12))).toBe('dark')
    expect(resolveTheme('auto', at(12))).toBe('light')
    expect(resolveTheme('auto', at(22))).toBe('dark')
  })
})
