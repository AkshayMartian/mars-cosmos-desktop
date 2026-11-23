import { describe, expect, it } from 'vitest'
import { checkMobile, cleanMobile, isIndianMobile, MOBILE_MSG } from './mobile'

describe('Indian mobile numbers', () => {
  it('accepts 10 digits starting with 6, 7, 8 or 9', () => {
    for (const m of ['6000000000', '7123456789', '8123456789', '9876543210']) expect(isIndianMobile(m)).toBe(true)
  })
  it('refuses a number starting 0-5, or not 10 digits', () => {
    for (const m of ['5876543210', '0876543210', '987654321', '98765432100', '']) expect(isIndianMobile(m)).toBe(false)
  })
  it('drops +91, 91 and 0 in front, spaces and dashes', () => {
    expect(cleanMobile('+91 98765-43210')).toBe('9876543210')
    expect(cleanMobile('919876543210')).toBe('9876543210')
    expect(cleanMobile('09876543210')).toBe('9876543210')
    expect(cleanMobile('98765 43210')).toBe('9876543210')
  })
  it('checkMobile returns the clean number or throws; optional allows empty', () => {
    expect(checkMobile('+91 98765 43210')).toBe('9876543210')
    for (const bad of ['12345', '5876543210', 'abcdefghij', '98765432101', '']) expect(() => checkMobile(bad)).toThrow(MOBILE_MSG)
    expect(checkMobile('  ', true)).toBe('')
    expect(checkMobile(undefined, true)).toBe('')
    expect(() => checkMobile('abc', true)).toThrow(MOBILE_MSG)
  })
})
