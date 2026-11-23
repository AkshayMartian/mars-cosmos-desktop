import { describe, expect, it } from 'vitest'
import { autoDate, monthDayOf, parseBirthDate, showBirthDate, toBirthInput } from './birthdate'

const now = new Date(2026, 10, 23) // 23 Nov 2026

describe('typing a date: only digits that can be part of a real date are accepted', () => {
  it('puts the dashes in by itself and stops at DD-MM-YYYY', () => {
    expect(autoDate('21', now)).toBe('21')
    expect(autoDate('210', now)).toBe('21-0')
    expect(autoDate('2108', now)).toBe('21-08')
    expect(autoDate('21081990', now)).toBe('21-08-1990')
    expect(autoDate('210819901', now)).toBe('21-08-1990')
    expect(autoDate('21/08/1990', now)).toBe('21-08-1990')
  })
  it('a day of 32 or more, 00, a month of 13 or more, or 31 in a 30-day month cannot be typed', () => {
    expect(autoDate('32', now)).toBe('3')
    expect(autoDate('34', now)).toBe('3')
    expect(autoDate('00', now)).toBe('0')
    expect(autoDate('2113', now)).toBe('21-1')
    expect(autoDate('2100', now)).toBe('21-0')
    expect(autoDate('3104', now)).toBe('31-0')
    expect(autoDate('3102', now)).toBe('31-0')
    expect(autoDate('3001', now)).toBe('30-01')
    expect(autoDate('2902', now)).toBe('29-02')
  })
  it('adds the leading 0 when a digit can only start a one-digit day or month', () => {
    expect(autoDate('5', now)).toBe('05')
    expect(autoDate('215', now)).toBe('21-05')
    expect(autoDate('315', now)).toBe('31-05')
    expect(autoDate('314', now)).toBe('31')
  })
  it('the year starts 19 or 20, is never before 1900, and is never in the future', () => {
    expect(autoDate('21083', now)).toBe('21-08') // a year cannot start with 3
    expect(autoDate('210818', now)).toBe('21-08-1') // 18.. is before 1900
    expect(autoDate('2108195', now)).toBe('21-08-195') // 195. is the 1950s: fine
    expect(autoDate('2108203', now)).toBe('21-08-20') // 203. is later than 2026
    expect(autoDate('2108202', now)).toBe('21-08-202')
    expect(autoDate('21082027', now)).toBe('21-08-202') // 2027 is next year
    expect(autoDate('21082026', now)).toBe('21-08-2026')
  })
  it('the last year digit is not accepted if it would make the date a day in the future', () => {
    expect(autoDate('24112026', now)).toBe('24-11-202') // tomorrow
    expect(autoDate('23112026', now)).toBe('23-11-2026') // today
    expect(autoDate('22112026', now)).toBe('22-11-2026')
    expect(autoDate('01122026', now)).toBe('01-12-202') // next month
    expect(autoDate('31121990', now)).toBe('31-12-1990') // a year that is in the past
  })
  it('keeps digits only', () => {
    expect(autoDate('ab', now)).toBe('')
    expect(autoDate('', now)).toBe('')
  })
})

describe('parseBirthDate', () => {
  it('DD-MM-YYYY becomes YYYY-MM-DD', () => {
    expect(parseBirthDate('21-08-1990', now)).toBe('1990-08-21')
    expect(parseBirthDate('04-12-2015', now)).toBe('2015-12-04')
    expect(parseBirthDate('23-11-2026', now)).toBe('2026-11-23')
    expect(parseBirthDate('29-02-1992', now)).toBe('1992-02-29')
    expect(parseBirthDate('', now)).toBe('')
  })
  it('refuses dates that do not exist, are in the future, are before 1900, or have a short year', () => {
    for (const bad of ['32-01-1990', '31-04-1990', '00-01-1990', '10-13-1990', '29-02-1991', '24-11-2026', '01-01-2027', '01-01-1899', '21-08-90', '21-08-9', 'abc'])
      expect(parseBirthDate(bad, now), bad).toBeNull()
  })
  it('an old customer without a year still works: DD-MM becomes MM-DD', () => {
    expect(parseBirthDate('21-08', now)).toBe('08-21')
    expect(parseBirthDate('31-02', now)).toBeNull()
  })
})

describe('showing and matching stored dates', () => {
  it('back to the box, to the month and day, and to words', () => {
    expect(toBirthInput('1990-08-21')).toBe('21-08-1990')
    expect(toBirthInput('08-21')).toBe('21-08')
    expect(toBirthInput(null)).toBe('')
    expect(monthDayOf('1990-08-21')).toBe('08-21')
    expect(monthDayOf('08-21')).toBe('08-21')
    expect(showBirthDate('1990-08-21')).toBe('21 Aug 1990')
    expect(showBirthDate('08-21')).toBe('21 Aug')
    expect(showBirthDate(null)).toBe('—')
  })
})
