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
            <button key={s.id} className="tile" aria-pressed={s.id === sel?.id} onClick={() => { setSel(s); setPin(''); setErr('') }}>
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
      </div>
    </div>
  )
}
