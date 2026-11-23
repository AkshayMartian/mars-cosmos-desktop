import { describe, expect, it } from 'vitest'
import { altFormCommon, altFormError, altNotes, type AltForm } from './AlterationForm'

const form = (over: Partial<AltForm> = {}): AltForm => ({ work: [], measures: {}, notes: '', tailorId: 't1', due: '2026-11-25T18:00', charge: '', ...over })

describe('alteration form: each type of work has its own measurement', () => {
  it('the tailor reads one entry per ticked type, in the order of the tick boxes, then anything else', () => {
    const f = form({ work: ['Waist', 'Length'], measures: { Length: '39 inch', Waist: 'take in 1 inch' }, notes: 'keep the stitching' })
    expect(altNotes(f)).toBe('Length: 39 inch; Waist: take in 1 inch; keep the stitching')
    expect(altFormCommon(f).work).toEqual(['Length', 'Waist'])
    expect(altFormCommon(f).notes).toBe(altNotes(f))
  })
  it('a measurement typed for a type that is then unticked is not sent', () => {
    expect(altNotes(form({ work: ['Hem'], measures: { Length: '39 inch', Hem: 'keep original' } }))).toBe('Hem: keep original')
  })
  it('every ticked type needs its measurement or instruction', () => {
    expect(altFormError(form({ work: ['Length', 'Waist'], measures: { Length: '39 inch' } }))).toBe('Add the measurement or instruction for Waist.')
    expect(altFormError(form({ work: ['Length'], measures: { Length: '  ' } }))).toBe('Add the measurement or instruction for Length.')
    expect(altFormError(form({ work: ['Length'], measures: { Length: '39 inch' } }))).toBeNull()
    expect(altFormError(form())).toBe('Tick at least one type of work.')
  })
})
