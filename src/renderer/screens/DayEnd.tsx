import { useCallback, useEffect, useState } from 'react'
import { formatRupees, toPaise } from '@shared/money'
import type { DayEndSummary } from '@shared/dayend'
import { fmtDay, Modal, useMsg } from '../ui'
import { OpeningModal } from './Billing'

const signed = (p: number): string => `${p >= 0 ? '+' : ''}${formatRupees(p)}`
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function DayEnd() {
  const [s, setS] = useState<DayEndSummary | null>(null)
  const [counted, setCounted] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [opening, setOpening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [closedId, setClosedId] = useState<string | null>(null) // the day just closed, for its slip
  const { run, attempt, setMsg, node } = useMsg()

  const load = useCallback(() => run(() => window.api.day.summary()).then((d) => d && setS(d)), [run])
  useEffect(() => { void load() }, [load])

  async function addExpense() {
    if (await attempt(() => window.api.day.addExpense(toPaise(amount), note))) { setAmount(''); setNote(''); setMsg(null); await load() }
  }

  async function close() {
    setConfirm(false)
    setBusy(true)
    const r = await run(() => window.api.day.close(toPaise(counted)))
    setBusy(false)
    if (!r) return
    setCounted(''); setClosedId(r.sessionId)
    const how = r.diff === 0 ? 'The cash matches.' : r.diff < 0 ? `Cash is short by ${formatRupees(-r.diff)}.` : `Cash is over by ${formatRupees(r.diff)}.`
    await load() // first: reloading clears the message, so the result is shown after it
    setMsg(r.backup.ok
      ? { ok: true, text: `Day closed. Expected ${formatRupees(r.expected)}, counted ${formatRupees(r.counted)}. ${how} Backup saved to ${r.backup.file}` }
      : { ok: false, text: `Day closed. Expected ${formatRupees(r.expected)}, counted ${formatRupees(r.counted)}. ${how} The backup could NOT be made: ${r.backup.error}` })
  }

  if (!s) return <>{node}</>

  if (!s.session) {
    return (
      <>
        <div className="head"><h1>Day end</h1></div>
        {node}
        {opening && <OpeningModal onStarted={() => { setOpening(false); setMsg(null); void load() }} />}
        <div className="panel">
          <div className="empty">No open day on this counter.<br /><br /><button className="btn p" onClick={() => setOpening(true)}>Open the day</button>{closedId && <> <button className="btn" onClick={() => void run(() => window.api.print.dayEnd(closedId), 'Day-end slip sent to the printer.')}>Print day-end slip</button></>}</div>
        </div>
      </>
    )
  }

  const hasCount = counted.trim() !== ''
  const countedP = toPaise(counted)
  const diff = countedP - s.expected

  return (
    <>
      <div className="head">
        <div>
          <h1>Day end</h1>
          <div className="sub">{fmtDay(s.session.openedAt)} · Counter {s.session.counter} · opened by {s.session.openedBy}</div>
        </div>
      </div>
      {node}
      {confirm && (
        <Modal title="Close the day?" onClose={() => setConfirm(false)}>
          <div className="tot">
            <span>Expected in drawer</span><span className="num">{formatRupees(s.expected)}</span>
            <span>You counted</span><span className="num">{formatRupees(countedP)}</span>
            <span>Difference</span><b className="num" style={{ color: diff < 0 ? 'var(--bad)' : 'var(--good)' }}>{signed(diff)}</b>
          </div>
          <p style={{ margin: 0 }}>A closed day cannot be changed. The database is backed up as part of closing.</p>
          <div className="mfoot"><button className="btn" onClick={() => setConfirm(false)}>Keep the day open</button><button className="btn p" autoFocus onClick={() => void close()}>Close day</button></div>
        </Modal>
      )}
      <div className="cols">
        <div className="panel">
          <div className="tot">
            <span>Opening cash</span><span className="num">{formatRupees(s.opening)}</span>
            <span>Cash sales ({plural(s.salesCount, 'bill')})</span><span className="num">{formatRupees(s.cashIn)}</span>
            <span>Cash refunds</span><span className="num">−{formatRupees(s.cashOut)}</span>
            <span>Expenses</span><span className="num">−{formatRupees(s.expensesTotal)}</span>
            <span className="g">Expected in drawer</span><span className="g">{formatRupees(s.expected)}</span>
          </div>
          <h2>Expenses</h2>
          {s.expenses.length
            ? s.expenses.map((e) => <div key={e.id} className="row" style={{ justifyContent: 'space-between' }}><span>{e.note}</span><span className="num">{formatRupees(e.amount)}</span></div>)
            : <div className="hint">None today.</div>}
          <div className="row">
            <div className="f"><label htmlFor="ex-a">Amount ₹</label><input id="ex-a" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addExpense()} /></div>
            <div className="f"><label htmlFor="ex-n">For</label><input id="ex-n" placeholder="Tea, courier…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addExpense()} /></div>
            <button className="btn" onClick={() => void addExpense()}>Add expense</button>
          </div>
        </div>
        <div className="panel">
          <div className="f">
            <label htmlFor="cc">Counted cash ₹</label>
            <input id="cc" className="big" type="number" min="0" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
          </div>
          {hasCount && (
            <div className="tot"><span>Difference</span><b className="num" style={{ color: diff < 0 ? 'var(--bad)' : 'var(--good)' }}>{signed(diff)}</b></div>
          )}
          <button className="btn p lg block" disabled={!hasCount || busy} onClick={() => setConfirm(true)}>Close day</button>
          <div className="hint">Closing also runs the backup. A closed day cannot be changed.</div>
        </div>
      </div>
    </>
  )
}
