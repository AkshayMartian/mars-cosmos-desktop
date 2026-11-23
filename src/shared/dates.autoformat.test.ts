import { describe, expect, it } from 'vitest'
import { autoDayMonth, parseDayMonth } from './dates'

describe('autoDayMonth (typing a birthday or anniversary)', () => {
  it('puts the dash in by itself', () => {
    expect(autoDayMonth('2')).toBe('2')
    expect(autoDayMonth('21')).toBe('21')
    expect(autoDayMonth('210')).toBe('21-0')
    expect(autoDayMonth('2108')).toBe('21-08')
    expect(autoDayMonth('21-08')).toBe('21-08')
  })
  it('adds the leading zero when a digit cannot start a two-digit day or month', () => {
    expect(autoDayMonth('5')).toBe('05')
    expect(autoDayMonth('45')).toBe('04-5'.replace('5', '05'))
    expect(autoDayMonth('215')).toBe('21-05')
  })
  it('keeps digits only and never more than DD-MM', () => {
    expect(autoDayMonth('21/08/1990')).toBe('21-08')
    expect(autoDayMonth('ab')).toBe('')
    expect(autoDayMonth('')).toBe('')
  })
  it('what it produces is accepted by the saving check when the date is real', () => {
    expect(parseDayMonth(autoDayMonth('2108'))).toBe('08-21')
    expect(parseDayMonth(autoDayMonth('3102'))).toBeNull() // 31-02 does not exist
    expect(parseDayMonth(autoDayMonth('2902'))).toBe('02-29')
  })
})
