import { useEffect, useState } from 'react'
import type { AllSettings } from '@shared/settings'
import { useMsg } from '../ui'
import { CategoriesPanel } from './CategoriesModal'
import { GstTab, PrintersTab, ShopTab, StaffTab } from './Settings'

const STEPS = ['Shop details', 'GST type', 'Categories', 'Printers', 'Your PIN', 'Staff'] as const

/**
 * First-run wizard for the owner: shop, GST type, categories, printers, the owner's own PIN and the staff. It reuses the Settings tabs, so what is saved here is
 * exactly what Settings shows later. Shown once (until `setup_done`), right after the owner's first login.
 */
export function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [all, setAll] = useState<AllSettings | null>(null)
  const { run, node } = useMsg()
  useEffect(() => { void run(() => window.api.settings.get()).then((a) => a && setAll(a)) }, [run])

  const finish = async () => { if (await run(() => window.api.settings.finishSetup())) onDone() }
  const named = !!all?.shop.name.trim()

  return (
    <>
      <div className="head">
        <div><h1>Set up your shop</h1><div className="sub">Six quick steps. You can change all of this later in Settings.</div></div>
        <button className="btn" onClick={() => void finish()}>Skip for now</button>
      </div>
      {node}
      <div className="panel">
        <div className="tabs" role="list" aria-label="Setup steps">
          {STEPS.map((s, i) => <button key={s} role="listitem" aria-current={step === i ? 'step' : undefined} aria-selected={step === i} disabled={i > step} onClick={() => setStep(i)}>{i + 1}. {s}</button>)}
        </div>
        {!all ? <div className="empty">Loading…</div>
          : step === 0 ? <ShopTab all={all} onSaved={(shop) => { setAll({ ...all, shop }); window.dispatchEvent(new Event('mars:settings-saved')) }} />
          : step === 1 ? <GstTab value={all.gst} onSaved={(gst) => setAll({ ...all, gst })} />
          : step === 2 ? <CategoriesPanel />
          : step === 3 ? <PrintersTab all={all} onSaved={(printers) => setAll({ ...all, printers })} />
          : step === 4 ? <OwnerPinStep />
          : <StaffTab />}
        <div className="mfoot" style={{ justifyContent: 'space-between' }}>
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          {step < STEPS.length - 1
            ? <button className="btn p" disabled={step === 0 && !named} title={step === 0 && !named ? 'Type the shop name and press Save first' : undefined} onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn p" onClick={() => void finish()}>Finish</button>}
        </div>
        {step === 0 && !named && <div className="hint">Type the shop name and press Save, then Next.</div>}
      </div>
    </>
  )
}

/** The owner replaces the default PIN with their own. Only the owner is in the wizard, so this is always "my PIN". */
function OwnerPinStep() {
  const [id, setId] = useState('')
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [saved, setSaved] = useState(false)
  const { run, node } = useMsg()
  useEffect(() => { void run(() => window.api.settings.staff()).then((r) => { const o = r?.find((x) => x.role === 'owner'); if (o) setId(o.id) }) }, [run])
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4)
  async function save() {
    if (p1 !== p2) return void run(async () => { throw new Error('The two PINs do not match.') })
    if (await run(() => window.api.settings.setPin(id, p1).then(() => true), 'Your PIN is saved. Use it from the next login.')) { setSaved(true); setP1(''); setP2('') }
  }
  return (
    <>
      {node}
      <p>The shop starts with a PIN that MARS gave you. Choose your own 4-digit PIN, one that only you know. It opens Settings, reports and the cash drawer check.</p>
      <div className="row">
        <div className="f"><label htmlFor="op-1">New PIN (4 digits)</label><input id="op-1" type="password" inputMode="numeric" maxLength={4} value={p1} onChange={(e) => { setP1(digits(e.target.value)); setSaved(false) }} /></div>
        <div className="f"><label htmlFor="op-2">Confirm PIN</label><input id="op-2" type="password" inputMode="numeric" maxLength={4} value={p2} onChange={(e) => { setP2(digits(e.target.value)); setSaved(false) }} onKeyDown={(e) => e.key === 'Enter' && void save()} /></div>
      </div>
      <div><button className="btn p" disabled={!id || p1.length !== 4} onClick={() => void save()}>{saved ? 'Saved' : 'Save my PIN'}</button></div>
      <div className="hint">You can skip this and change it later in Settings → Staff. Avoid 1234, 1111 and similar.</div>
    </>
  )
}
