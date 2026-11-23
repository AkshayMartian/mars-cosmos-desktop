import { toPaise } from '@shared/money'
import { ALT_WORKS, altDue, tagLines, slipText, type AltContext, type AltJobDto, type BillAlteration } from '@shared/alterations'
import { Modal, useMsg } from '../ui'

/** The form fields shared by the Billing cart-line dialog and the Alterations "New alteration" dialog. */
export interface AltForm {
  work: string[]
  /** the measurement or instruction for each type of work, by its name (only the ticked types are used) */
  measures: Record<string, string>
  /** anything else for the tailor */
  notes: string
  tailorId: string
  /** value of a datetime-local input */
  due: string
  /** rupees as typed; 0 or empty = free */
  charge: string
}

const pad = (n: number): string => String(n).padStart(2, '0')
export const toLocalInput = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Default ready-by: today + N days at 6 pm. */
export function defaultDue(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(18, 0, 0, 0)
  return toLocalInput(d)
}

export const emptyAltForm = (ctx: AltContext): AltForm => ({
  work: [], measures: {}, notes: '', tailorId: ctx.tailors.find((t) => t.active)?.id ?? '', due: defaultDue(ctx.cfg.dueDays), charge: ''
})

/**
 * What the tailor reads: one entry per ticked type of work with its own measurement, then anything else.
 * "Length: 39 inch; Waist: 32 inch; keep original hem". The types follow the order of the tick boxes, not the order they were ticked.
 */
export function altNotes(f: AltForm): string {
  const parts = ALT_WORKS.filter((w) => f.work.includes(w)).map((w) => `${w}: ${(f.measures[w] ?? '').trim()}`)
  return [...parts, f.notes.trim()].filter(Boolean).join('; ')
}

/** A message for the first problem with the form, or null. The main process checks everything again. */
export function altFormError(f: AltForm): string | null {
  if (!f.tailorId) return 'Add a tailor first (Alterations → Tailors), then choose one.'
  if (!f.work.length) return 'Tick at least one type of work.'
  const missing = ALT_WORKS.find((w) => f.work.includes(w) && !(f.measures[w] ?? '').trim())
  if (missing) return `Add the measurement or instruction for ${missing}.`
  if (!f.due || Number.isNaN(new Date(f.due).getTime())) return 'Choose the ready-by date and time.'
  const c = Number(f.charge || 0)
  if (!(c >= 0) || !Number.isInteger(c)) return 'Enter the charge in whole rupees (0 = free).'
  return null
}

export const altFormCommon = (f: AltForm) => ({ work: ALT_WORKS.filter((w) => f.work.includes(w)), notes: altNotes(f), tailorId: f.tailorId, dueAt: new Date(f.due).toISOString(), charge: toPaise(f.charge) })

export function billAlteration(variantId: string, f: AltForm, mode: 'bill' | 'pickup'): BillAlteration {
  return { variantId, ...altFormCommon(f), mode }
}

const HINTS: Record<string, string> = {
  Length: 'e.g. 39 inch', Waist: 'e.g. take in 1 inch', Sleeves: 'e.g. shorten 1.5 inch', Fitting: 'e.g. slim the sides',
  Hem: 'e.g. keep original hem', Buttons: 'e.g. replace 3', Other: 'what to do'
}

export function AltFields({ ctx, value, onChange }: { ctx: AltContext; value: AltForm; onChange: (f: AltForm) => void }) {
  const set = (p: Partial<AltForm>) => onChange({ ...value, ...p })
  return (
    <>
      <div className="f"><label>Work to do</label>
        <div className="works">{ALT_WORKS.map((w) => (
          <label key={w}><input type="checkbox" checked={value.work.includes(w)} onChange={(e) => set({ work: e.target.checked ? [...value.work, w] : value.work.filter((x) => x !== w) })} /> {w}</label>
        ))}</div></div>
      {ALT_WORKS.filter((w) => value.work.includes(w)).map((w) => (
        <div className="f" key={w}><label htmlFor={`al-m-${w}`}>{w}: measurement or instruction</label>
          <input id={`al-m-${w}`} value={value.measures[w] ?? ''} placeholder={HINTS[w]} onChange={(e) => set({ measures: { ...value.measures, [w]: e.target.value } })} /></div>
      ))}
      <div className="f"><label htmlFor="al-notes">Anything else for the tailor (optional)</label>
        <input id="al-notes" value={value.notes} placeholder="e.g. keep the original stitching" onChange={(e) => set({ notes: e.target.value })} /></div>
      <div className="row">
        <div className="f"><label htmlFor="al-t">Tailor</label>
          <select id="al-t" value={value.tailorId} onChange={(e) => set({ tailorId: e.target.value })}>
            {!ctx.tailors.some((t) => t.active) && <option value="">No tailor yet</option>}
            {ctx.tailors.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div className="f"><label htmlFor="al-due">Ready by</label><input id="al-due" type="datetime-local" value={value.due} onChange={(e) => set({ due: e.target.value })} /></div>
        <div className="f"><label htmlFor="al-c">Charge ₹ (0 = free)</label><input id="al-c" type="number" min="0" value={value.charge} onChange={(e) => set({ charge: e.target.value })} /></div>
      </div>
    </>
  )
}

/** The tailor tag for the garment and the slip for the customer. Printing arrives with the printing milestone. */
export function TagModal({ jobs, ctx, onClose }: { jobs: AltJobDto[]; ctx: AltContext; onClose: () => void }) {
  const { run, node } = useMsg()
  const where = ctx.cfg.tagPrinter === 'sticker' ? 'sticker printer' : 'receipt printer'
  return (
    <Modal title={jobs.length > 1 ? 'Tailor tags' : 'Tailor tag'} wide onClose={onClose}>
      <p className="sub" style={{ margin: 0 }}>Stick or pin the tag on the garment before it goes to the tailor. Give the customer the slip.</p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        {jobs.map((a) => {
          const [shop, no, who, ...rest] = tagLines(a, ctx.shop)
          return (
            <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="sub"><b>Tag for the garment</b></div>
              <div className="tagc" aria-label="Tailor tag">
                <span className="sub">{shop}</span><span className="no">{no}</span><div className="bc" aria-hidden="true">▌▍▌▌▍▍▌▍▌▌▍▌▍▍▌▌▍▌</div>
                <b>{who}</b>{rest.slice(0, -1).map((l, i) => <span key={i}>{l}</span>)}<span className="due">{rest[rest.length - 1]}</span>
              </div>
              <div className="sub"><b>Slip for the customer</b></div>
              <div className="receipt" style={{ maxWidth: 300 }}>{slipText(a, ctx.shop)}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm" onClick={() => void run(() => window.api.print.alteration(a.id, 'tag'), 'Tag sent to the printer.')}>Print tag</button>
                <button className="btn sm" onClick={() => void run(() => window.api.print.alteration(a.id, 'slip'), 'Slip sent to the printer.')}>Print slip</button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="hint">The tag goes to the {where} (Settings → Alterations).</div>
      {node}
      <div className="mfoot"><button className="btn p" autoFocus onClick={onClose}>Close</button></div>
    </Modal>
  )
}

export { altDue }
