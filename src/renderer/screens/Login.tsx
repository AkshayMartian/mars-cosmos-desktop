import { useEffect, useRef, useState } from 'react'
import type { AppInfo, StaffPublic } from '@shared/types'

const roleName: Record<StaffPublic['role'], string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', store: 'Store staff' }

/** Staff tiles → PIN pad (keyboard works too) → forced new-PIN step when the PIN is still the default. */
export function Login({ info, onDone }: { info: AppInfo | null; onDone: (s: StaffPublic) => void }) {
  const [staff, setStaff] = useState<StaffPublic[]>([])
  const [sel, setSel] = useState<StaffPublic | null>(null)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState('')
  const [newPin, setNewPin] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [note, setNote] = useState('')
  const busy = useRef(false)

  useEffect(() => { void window.api.auth.staff().then(setStaff) }, [])

  const len = 4 // every PIN is exactly 4 digits

  async function submit(value = pin) {
    if (!sel || busy.current) return
    busy.current = true
    const r = await window.api.auth.login(sel.id, value).catch(() => null)
    busy.current = false
    setPin('')
    if (!r) return setErr('Could not log in.')
    if (!r.ok) return setErr(r.error ?? 'Could not log in.')
    setErr('')
    if (r.mustChangePin) return setNewPin(true)
    onDone(r.staff!)
  }

  async function saveNewPin() {
    if (pin !== pin2) return setErr('The two PINs do not match.')
    const r = await window.api.auth.changePin(pin)
    if (!r.ok || !r.staff) { setPin(''); setPin2(''); return setErr(r.error ?? 'Could not save PIN.') }
    onDone(r.staff)
  }

  // Physical keyboard on the PIN pad (only while no text box has focus).
  useEffect(() => {
    if (!sel || newPin) return
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement?.tagName ?? ''))) return
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p))
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter') void submit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (forgot && sel) return <ForgotPin who={sel} staff={staff} onBack={(m) => { setForgot(false); setPin(''); setErr(''); setNote(m ?? '') }} />

  if (newPin && sel) {
    return (
      <div className="login">
        <div className="lcard">
          <div><div className="sub">{sel.name} · {roleName[sel.role]}</div><h1>Set your own PIN</h1></div>
          <p>You are using the default PIN. Choose a new {len}-digit PIN that only you know.</p>
          <div className="f"><label htmlFor="np1">New PIN</label>
            <input id="np1" type="password" inputMode="numeric" maxLength={len} className="big" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="f"><label htmlFor="np2">Confirm new PIN</label>
            <input id="np2" type="password" inputMode="numeric" maxLength={len} className="big" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && void saveNewPin()} /></div>
          <div className="err" role="alert">{err}</div>
          <button className="btn p lg" onClick={() => void saveNewPin()}>Save PIN and continue</button>
        </div>
      </div>
    )
  }

  return (
    <div className="login">
      <div className="lcard">
        <div><div className="sub">{info?.shopName ?? ''} · Counter {info?.counter ?? ''}</div><h1>Who is billing?</h1></div>
        <div className="tiles">
          {staff.map((s) => (
            <button key={s.id} className="tile" aria-pressed={s.id === sel?.id} onClick={() => { setSel(s); setPin(''); setErr(''); setNote('') }}>
              <b>{s.name}</b><span>{roleName[s.role]}</span>
            </button>
          ))}
        </div>
        {sel ? (
          <>
            <div className="dots" aria-label="PIN entered">{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
            <div className="pad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} onClick={() => setPin((p) => (p.length < 4 ? p + n : p))}>{n}</button>)}
              <button aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
              <button onClick={() => setPin((p) => (p.length < 4 ? p + '0' : p))}>0</button>
              <button className="ok" onClick={() => void submit()}>OK</button>
            </div>
          </>
        ) : <p className="sub" style={{ textAlign: 'center' }}>Tap your name, then type your PIN (keyboard works too).</p>}
        <div className="err" role="alert">{err}</div>
        {note && <div role="status" style={{ textAlign: 'center', color: 'var(--good)', fontWeight: 600 }}>{note}</div>}
        {sel && <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => { setForgot(true); setErr(''); setNote('') }}>Forgot PIN?</button>}
      </div>
    </div>
  )
}

/** "Forgot PIN": the owner uses the recovery code; everyone else is reset by a manager / the owner approving with their own PIN. */
function ForgotPin({ who, staff, onBack }: { who: StaffPublic; staff: StaffPublic[]; onBack: (message?: string) => void }) {
  const isOwner = who.role === 'owner'
  const approvers = staff.filter((s) => s.id !== who.id && (who.role === 'manager' ? s.role === 'owner' : s.role === 'owner' || s.role === 'manager'))
  const [code, setCode] = useState('')
  const [approver, setApprover] = useState(approvers[0]?.id ?? '')
  const [apin, setApin] = useState('')
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [err, setErr] = useState('')
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4)

  async function save() {
    if (p1 !== p2) return setErr('The two PINs do not match.')
    try {
      if (isOwner) await window.api.auth.resetOwnerPin(code, p1)
      else await window.api.auth.resetPin({ staffId: who.id, approverId: approver, approverPin: apin, newPin: p1 })
      onBack(isOwner ? 'PIN changed. Log in with your new PIN, then make a new recovery code in Settings → Staff.' : 'PIN reset. Log in with the temporary PIN; you will then choose your own.')
    } catch (e) { setApin(''); setErr(e instanceof Error ? e.message : 'Could not reset the PIN.') }
  }

  return (
    <div className="login">
      <div className="lcard">
        <div><div className="sub">{who.name} · {roleName[who.role]}</div><h1>Forgot PIN</h1></div>
        {isOwner ? (
          <>
            <p>Type the recovery code the owner wrote down (Settings → Staff), then choose a new PIN.</p>
            <div className="f"><label htmlFor="fp-c">Recovery code</label>
              <input id="fp-c" autoFocus autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 14))} /></div>
          </>
        ) : approvers.length === 0 ? <p>There is no one who can approve this. Contact the owner.</p> : (
          <>
            <p>{who.role === 'manager' ? 'The owner' : 'A manager or the owner'} must approve with their own PIN, then you get a temporary PIN.</p>
            <div className="f"><label htmlFor="fp-a">Approved by</label>
              <select id="fp-a" value={approver} onChange={(e) => setApprover(e.target.value)}>
                {approvers.map((s) => <option key={s.id} value={s.id}>{s.name} ({roleName[s.role]})</option>)}</select></div>
            <div className="f"><label htmlFor="fp-ap">Their PIN</label>
              <input id="fp-ap" type="password" inputMode="numeric" maxLength={4} autoFocus value={apin} onChange={(e) => setApin(digits(e.target.value))} /></div>
          </>
        )}
        <div className="f"><label htmlFor="fp-1">{isOwner ? 'New PIN' : 'Temporary PIN'} (4 digits)</label>
          <input id="fp-1" type="password" inputMode="numeric" maxLength={4} value={p1} onChange={(e) => setP1(digits(e.target.value))} /></div>
        <div className="f"><label htmlFor="fp-2">Confirm</label>
          <input id="fp-2" type="password" inputMode="numeric" maxLength={4} value={p2} onChange={(e) => setP2(digits(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void save()} /></div>
        <div className="err" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="btn" onClick={() => onBack()}>Back</button>
          <button className="btn p" disabled={!isOwner && approvers.length === 0} onClick={() => void save()}>Reset PIN</button>
        </div>
      </div>
    </div>
  )
}
