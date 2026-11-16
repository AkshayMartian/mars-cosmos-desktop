import { useEffect, useState } from 'react'
import type { AllSettings } from '@shared/settings'
import { useMsg } from '../ui'
import { GstTab, PrintersTab, ShopTab } from './Settings'

const STEPS = ['Shop details', 'GST type', 'Printers'] as const

/**
 * First-run wizard for the owner: shop, GST type, printers. It reuses the Settings tabs, so what is saved here is
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
        <div><h1>Set up your shop</h1><div className="sub">Three quick steps. You can change all of this later in Settings.</div></div>
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
          : <PrintersTab all={all} onSaved={(printers) => setAll({ ...all, printers })} />}
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
