import { describe, expect, it } from 'vitest'
import { cleanAmountInput } from './money'

describe('cleanAmountInput (typing a discount)', () => {
  it('never starts with 0: "0" is nothing and "05" is 5', () => {
    expect(cleanAmountInput('0')).toBe('')
    expect(cleanAmountInput('00')).toBe('')
    expect(cleanAmountInput('05')).toBe('5')
    expect(cleanAmountInput('007')).toBe('7')
    expect(cleanAmountInput('10')).toBe('10')
    expect(cleanAmountInput('100')).toBe('100')
  })
  it('allows rupees and paise, typed as .5 or 12.5', () => {
    expect(cleanAmountInput('.')).toBe('0.')
    expect(cleanAmountInput('.5')).toBe('0.5')
    expect(cleanAmountInput('12.5')).toBe('12.5')
    expect(cleanAmountInput('12.567')).toBe('12.56')
    expect(cleanAmountInput('1.2.3')).toBe('1.23')
  })
  it('drops letters, minus and spaces', () => {
    expect(cleanAmountInput('-5')).toBe('5')
    expect(cleanAmountInput('a1b2')).toBe('12')
    expect(cleanAmountInput(' ')).toBe('')
  })
  it('cuts a bigger number back to the most allowed', () => {
    expect(cleanAmountInput('500', 299.9)).toBe('299.9')
    expect(cleanAmountInput('250', 299.9)).toBe('250')
    expect(cleanAmountInput('5', 0)).toBe('')
  })
})
