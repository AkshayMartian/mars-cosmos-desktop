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

  if (forgot && sel) return <ForgotPin who={sel} onBack={(m) => { setForgot(false); setPin(''); setErr(''); setNote(m ?? '') }} />

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
        {sel?.role === 'owner' && <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => { setForgot(true); setErr(''); setNote('') }}>Forgot PIN?</button>}
      </div>
    </div>
  )
}

/**
 * Owner "Forgot PIN" (online only). The app asks the MARS server to email a link to the owner's email on file, shows a masked hint of the
 * address, and checks every few seconds until the owner has chosen the new PIN on the web page. Other staff have no Forgot PIN here:
 * the owner (or a manager) sets their PIN in Settings → Staff.
 */
function ForgotPin({ who, onBack }: { who: StaffPublic; onBack: (message?: string) => void }) {
  const [phase, setPhase] = useState<'starting' | 'waiting' | 'failed' | 'expired'>('starting')
  const [hint, setHint] = useState('')
  const [left, setLeft] = useState(0)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const started = useRef(false)
  const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  async function start() {
    setPhase('starting'); setErr(''); setNote('')
    try {
      const r = await window.api.auth.forgotPinStart()
      setHint(r.emailHint); setLeft(r.resendsLeft); setPhase('waiting')
    } catch (e) { setErr(msg(e, 'Could not start the PIN reset.')); setPhase('failed') }
  }
  useEffect(() => { if (!started.current) { started.current = true; void start() } }, [])

  // check the server every few seconds while waiting; a dropped connection shows a message and keeps trying
  useEffect(() => {
    if (phase !== 'waiting') return
    let stop = false
    const tick = async () => {
      try {
        const r = await window.api.auth.forgotPinStatus()
        if (stop) return
        if (r.status === 'applied') return onBack('PIN changed. Log in with your new PIN.')
        if (r.status === 'expired') return setPhase('expired')
        setErr('')
      } catch (e) { if (!stop) setErr(msg(e, 'Could not check the PIN reset.')) }
    }
    const t = setInterval(() => void tick(), 4000)
    return () => { stop = true; clearInterval(t) }
  }, [phase, onBack])

  async function resend() {
    setErr(''); setNote('')
    try {
      const r = await window.api.auth.forgotPinResend()
      setHint(r.emailHint); setLeft(r.resendsLeft); setNote('Email sent again.')
    } catch (e) { setErr(msg(e, 'Could not send the email again.')) }
  }

  return (
    <div className="login">
      <div className="lcard">
        <div><div className="sub">{who.name} · {roleName[who.role]}</div><h1>Forgot PIN</h1></div>
        {phase === 'starting' && <p role="status">Contacting MARS…</p>}
        {phase === 'failed' && (
          <>
            <div className="err" role="alert">{err}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button className="btn" onClick={() => onBack()}>Back</button>
              <button className="btn p" onClick={() => void start()}>Try again</button>
            </div>
          </>
        )}
        {phase === 'expired' && (
          <>
            <p>The link has expired or was already used. Send a new email to try again.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button className="btn" onClick={() => onBack()}>Back</button>
              <button className="btn p" onClick={() => void start()}>Send a new email</button>
            </div>
          </>
        )}
        {phase === 'waiting' && (
          <>
            <p>We sent a link to <b>{hint}</b>. Open it on your phone or any computer and choose a new 4-digit PIN.</p>
            <p role="status" style={{ fontWeight: 600 }}>Waiting for you to set the new PIN…</p>
            <div className="err" role="alert">{err}</div>
            {note && <div role="status" style={{ color: 'var(--good)', fontWeight: 600 }}>{note}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button className="btn" onClick={() => onBack()}>Back</button>
              <button className="btn" disabled={left <= 0} onClick={() => void resend()} title={left <= 0 ? 'The email was already sent three times' : undefined}>Resend email{left > 0 ? ` (${left} left)` : ''}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
