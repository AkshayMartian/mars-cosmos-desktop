import { useEffect, useState } from 'react'
import type { LicenceInfo } from '@shared/licence'
import { KEY_MSG, KEY_RE, TRIAL_DAYS, formatKey } from '@shared/licence'
import { MOBILE_MSG, cleanMobile, isIndianMobile } from '@shared/mobile'
import { useMsg } from '../ui'

const dmy = (iso: string | null): string => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

/**
 * First screen of a new install: nothing else opens until this PC is activated.
 *   Online:  key + owner mobile -> the MARS server checks it.
 *   No internet: the PC shows a request code -> the owner sends it to MARS -> types the response code that comes back.
 *   Free trial: mobile + one-time code, 14 days.
 */
export function Activate({ info, onDone }: { info: LicenceInfo | null; onDone: (l: LicenceInfo) => void }) {
  const [mode, setMode] = useState<'online' | 'code' | 'trial'>('online')
  const [key, setKey] = useState('')
  const [mobile, setMobile] = useState('')
  const [shop, setShop] = useState('')
  const [request, setRequest] = useState('')
  const [response, setResponse] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const { run, node, setMsg } = useMsg()

  const go = async (fn: () => Promise<LicenceInfo>) => {
    setBusy(true)
    const l = await run(fn)
    setBusy(false)
    if (l) onDone(l)
  }
  const pick = (m: typeof mode) => { setMode(m); setMsg(null) }
  const keyOk = KEY_RE.test(key)
  const mobileOk = isIndianMobile(mobile)
  const keyBox = (
    <>
      <div className="f"><label htmlFor="ac-k">Activation key</label>
        <input id="ac-k" className="mono" autoFocus placeholder="MARS-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} value={key} aria-invalid={!!key && !keyOk} onChange={(e) => { setKey(formatKey(e.target.value)); setMsg(null) }} />
        {key.length >= 19 && !keyOk ? <div role="alert" style={{ color: 'var(--bad)', fontWeight: 600, fontSize: 13 }}>{KEY_MSG}</div> : <div className="hint">Example: MARS-7K2Q-9XFD-4LPA. The dashes are added for you.</div>}</div>
      <div className="f"><label htmlFor="ac-m">Owner's mobile number</label>
        <input id="ac-m" inputMode="numeric" placeholder="10 digits" value={mobile} aria-invalid={mobile.length === 10 && !mobileOk} onChange={(e) => setMobile(cleanMobile(e.target.value))} />
        {mobile.length === 10 && !mobileOk ? <div role="alert" style={{ color: 'var(--bad)', fontWeight: 600, fontSize: 13 }}>{MOBILE_MSG}</div> : null}</div>
    </>
  )

  return (
    <div className="login">
      <div className="lcard">
        <div><div className="sub">Welcome to Mars Cosmos</div><h1>Activate this PC</h1></div>
        {info?.state === 'invalid' && <div className="banner bad" role="alert">{info.problem}</div>}
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'online'} onClick={() => pick('online')}>Activation key</button>
          <button role="tab" aria-selected={mode === 'code'} onClick={() => pick('code')}>No internet</button>
          <button role="tab" aria-selected={mode === 'trial'} onClick={() => pick('trial')}>Free trial</button>
        </div>

        {mode === 'online' && (
          <>
            <p>Type the key MARS sent you on WhatsApp. The PC needs internet only this once.</p>
            {keyBox}
            <button className="btn p lg" disabled={busy || !keyOk || !mobileOk} onClick={() => void go(() => window.api.licence.activateOnline(key, mobile))}>{busy ? 'Checking…' : 'Activate'}</button>
          </>
        )}

        {mode === 'code' && (
          <>
            <p>No internet here? Three steps, with a phone call or WhatsApp to MARS support.</p>
            {keyBox}
            <button className="btn" disabled={!keyOk || !mobileOk} onClick={() => void run(() => window.api.licence.request(key, mobile)).then((r) => r && setRequest(r))}>1. Make the request code</button>
            {request && (
              <div className="f"><label htmlFor="ac-rq">2. Send this request code to MARS support</label>
                <textarea id="ac-rq" readOnly rows={3} className="mono" value={request} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => void navigator.clipboard.writeText(request).then(() => setMsg({ ok: true, text: 'Copied. Paste it into WhatsApp.' }))}>Copy</button>
                <div className="hint">PC ID {info?.machine}. Support sends back a response code.</div></div>
            )}
            <div className="f"><label htmlFor="ac-rs">3. Type or paste the response code</label>
              <textarea id="ac-rs" rows={3} className="mono" placeholder="MARSL1.…" value={response} onChange={(e) => setResponse(e.target.value)} /></div>
            <button className="btn p lg" disabled={busy || !response.trim().startsWith('MARSL1.')} onClick={() => void go(async () => window.api.licence.activateCode(response))}>Activate</button>
          </>
        )}

        {mode === 'trial' && (
          <>
            <p>Try everything free for {TRIAL_DAYS} days. We send a one-time code to your mobile (internet needed).</p>
            <div className="f"><label htmlFor="tr-s">Shop name</label><input id="tr-s" value={shop} onChange={(e) => setShop(e.target.value)} /></div>
            <div className="f"><label htmlFor="tr-m">Mobile number</label>
              <input id="tr-m" inputMode="numeric" placeholder="10 digits" value={mobile} disabled={otpSent} aria-invalid={mobile.length === 10 && !mobileOk} onChange={(e) => setMobile(cleanMobile(e.target.value))} />
              {mobile.length === 10 && !mobileOk ? <div role="alert" style={{ color: 'var(--bad)', fontWeight: 600, fontSize: 13 }}>{MOBILE_MSG}</div> : null}</div>
            {!otpSent
              ? <button className="btn p lg" disabled={busy || !mobileOk || !shop.trim()} onClick={() => { setBusy(true); void run(() => window.api.licence.trialOtp(mobile), 'Code sent. Type it below.').then((ok) => { setBusy(false); if (ok) setOtpSent(true) }) }}>Send me the code</button>
              : (
                <>
                  <div className="f"><label htmlFor="tr-o">Code from the message</label>
                    <input id="tr-o" inputMode="numeric" autoFocus maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && void go(() => window.api.licence.trialVerify(mobile, otp, shop))} /></div>
                  <button className="btn p lg" disabled={busy || otp.length < 4} onClick={() => void go(() => window.api.licence.trialVerify(mobile, otp, shop))}>Start free trial</button>
                  <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => { setOtpSent(false); setOtp(''); setMsg(null) }}>Change the number</button>
                </>
              )}
          </>
        )}
        {node}
      </div>
    </div>
  )
}

/** Settings → Licence: what the licence is, a check-now button and the renewal code box. */
export function LicenceTab({ onChange }: { onChange?: (l: LicenceInfo) => void }) {
  const [info, setInfo] = useState<LicenceInfo | null>(null)
  const [code, setCode] = useState('')
  const { run, node, setMsg } = useMsg()
  useEffect(() => { void run(() => window.api.licence.status()).then((l) => l && setInfo(l)) }, [run])
  const changed = (l: LicenceInfo) => { setInfo(l); onChange?.(l) }
  if (!info) return <div className="empty">Loading…</div>
  const chip = info.state === 'expired' ? <span className="chip bad">Expired: read-only</span>
    : info.state === 'expiring' ? <span className="chip warn">{info.daysLeft === 0 ? 'Last day' : `${info.daysLeft} days left`}</span>
    : info.state === 'active' ? <span className="chip good">Active</span> : <span className="chip muted">Not activated</span>
  return (
    <>
      {node}
      {info.state === 'expired' && <div className="banner bad" role="alert">The licence has expired. You can see and reprint old bills, but new bills are blocked until you renew. Nothing is deleted.</div>}
      {info.staleCheck && <div className="banner" role="status">This PC has not reached the MARS server for {info.checkedDaysAgo} days. Billing still works; connect to the internet when you can.</div>}
      <div className="tw"><table><tbody>
        <tr><th scope="row">Status</th><td>{chip}{info.kind === 'trial' && <> <span className="chip muted">Free trial</span></>}</td></tr>
        <tr><th scope="row">Shop</th><td>{info.shopName || '—'}</td></tr>
        <tr><th scope="row">Plan</th><td>{info.plan || '—'}{info.mode ? ` · ${info.mode === 'cloud' ? 'Cloud backup' : 'Local-only'}` : ''}{info.counters ? ` · ${info.counters} counter${info.counters > 1 ? 's' : ''}` : ''}</td></tr>
        <tr><th scope="row">Valid till</th><td>{dmy(info.expires) || '—'}</td></tr>
        <tr><th scope="row">PC ID</th><td className="mono">{info.machine}</td></tr>
      </tbody></table></div>
      <div className="row">
        <button className="btn" onClick={() => void run(() => window.api.licence.refresh(), 'Checked with the MARS server.').then((l) => l && changed(l))}>Check with MARS now</button>
      </div>
      <div className="f"><label htmlFor="rn-c">Renewal code</label>
        <textarea id="rn-c" rows={3} className="mono" placeholder="Paste the code MARS support sent (MARSL1.…)" value={code} onChange={(e) => setCode(e.target.value)} />
        <div className="hint">Online shops renew by themselves. Use this when there is no internet: tell support your PC ID, then paste the code they send.</div></div>
      <div><button className="btn p" disabled={!code.trim()} onClick={() => void run(async () => window.api.licence.activateCode(code)).then((l) => { if (l) { setCode(''); changed(l); setMsg({ ok: true, text: 'Licence renewed.' }) } })}>Renew</button></div>
    </>
  )
}
