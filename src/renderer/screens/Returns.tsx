import { useEffect, useMemo, useRef, useState } from 'react'
import { calc } from '@shared/calc'
import { formatRupees, roundToRupee } from '@shared/money'
import { receiptText } from '@shared/receipt'
import { returnPart, type BillForReturn, type ReturnBillRow, type ReturnResult } from '@shared/returns'
import type { BillingContext, PayMode, SellableVariant } from '@shared/billing'
import { SERIAL_MSG } from '@shared/serials'
import { fmtDate, fmtDay, Modal, useMsg } from '../ui'
import { ApprovalModal, OpeningModal } from './Billing'

/** serials = the pieces of an item that uses serial numbers (scanned; the quantity is how many) */
interface NewLine { v: SellableVariant; qty: number; serials?: string[] }

/** Tell the top bar ("My sales today") that money moved. */
const announce = () => window.dispatchEvent(new Event('mars:sale-saved'))

export function Returns() {
  const [ctx, setCtx] = useState<BillingContext | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<ReturnBillRow[] | null>(null)
  const [bill, setBill] = useState<BillForReturn | null>(null)
  const [sel, setSel] = useState<Record<number, string>>({})
  const [serialSel, setSerialSel] = useState<Record<number, string[]>>({}) // bill line id → serials of the pieces coming back
  const [nq, setNq] = useState('')
  const [results, setResults] = useState<SellableVariant[]>([])
  const [newLines, setNewLines] = useState<NewLine[]>([])
  const [settle, setSettle] = useState<'credit_note' | 'cash'>('credit_note')
  const [payMode, setPayMode] = useState<PayMode>('cash')
  const [dlg, setDlg] = useState<{ t: 'approval'; error?: string } | { t: 'done'; r: ReturnResult } | null>(null)
  const [busy, setBusy] = useState(false)
  const approval = useRef<{ staffId: string; pin: string } | undefined>(undefined)
  const { run, setMsg, node } = useMsg()

  const loadCtx = () => run(() => window.api.billing.context()).then((c) => c && setCtx(c))
  useEffect(() => { void loadCtx(); void window.api.returns.find('').then(setFound, () => undefined) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!nq.trim()) return setResults([])
    let stale = false
    void window.api.billing.search(nq).then((r) => { if (!stale) setResults(r) }, () => undefined)
    return () => { stale = true }
  }, [nq])

  const scheme = ctx?.gstScheme ?? 'regular'
  const picked = useMemo(() => {
    if (!bill) return []
    return bill.lines.map((l) => ({ l, q: l.pieces.length ? (serialSel[l.id] ?? []).length : Math.max(0, Math.min(l.returnable, Math.floor(Number(sel[l.id]) || 0))) })).filter((x) => x.q > 0)
  }, [bill, sel, serialSel])
  const returnValue = roundToRupee(picked.reduce((a, x) => a + returnPart(x.l.total, x.l.qty, x.l.returned, x.q), 0))
  const exchange = useMemo(
    () => calc(scheme, newLines.map((n) => ({ variantId: n.v.id, qty: n.qty, price: n.v.price, gst: n.v.gst })), 0),
    [scheme, newLines]
  )
  const diff = newLines.length ? exchange.grand - returnValue : -returnValue // > 0 customer pays, < 0 customer is owed
  const walkIn = bill ? !bill.customerId : false
  const effectiveSettle = walkIn ? 'cash' : settle

  async function find() {
    const r = await run(() => window.api.returns.find(q))
    if (r) setFound(r)
  }
  async function pick(id: string) {
    const b = await run(() => window.api.returns.bill(id))
    if (!b) return
    setBill(b); setSel({}); setSerialSel({}); setNewLines([]); setNq(''); setSettle('credit_note'); setPayMode('cash'); approval.current = undefined; setMsg(null)
  }
  function back() { setBill(null); setFound(null); approval.current = undefined; setMsg(null) }

  function addNew(v: SellableVariant) {
    if (v.tracked) { setMsg({ ok: false, text: SERIAL_MSG.noSerial }); setNq(''); setResults([]); return }
    const have = newLines.find((n) => n.v.id === v.id)?.qty ?? 0
    if (v.stock <= 0) { setMsg({ ok: false, text: `${v.label} is out of stock.` }); return }
    if (have + 1 > v.stock) { setMsg({ ok: false, text: `Only ${v.stock} of ${v.label} in stock.` }); return }
    setMsg(null)
    setNewLines((c) => (c.some((n) => n.v.id === v.id) ? c.map((n) => (n.v.id === v.id ? { ...n, qty: n.qty + 1 } : n)) : [...c, { v, qty: 1 }]))
    setNq(''); setResults([])
  }
  /** a scanned piece of a serial item for the exchange: one row per variant, the pieces listed under it */
  function addNewPiece(v: SellableVariant, serial: string) {
    setMsg(null)
    setNewLines((c) => (c.some((n) => n.v.id === v.id)
      ? c.map((n) => (n.v.id === v.id ? { ...n, serials: [...(n.serials ?? []), serial], qty: n.qty + 1 } : n))
      : [...c, { v, qty: 1, serials: [serial] }]))
    setNq(''); setResults([])
  }
  const bump = (i: number, d: number) => {
    const n = newLines[i]!
    if (n.serials) return
    const next = n.qty + d
    if (next < 1) return
    if (next > n.v.stock) return setMsg({ ok: false, text: `Only ${n.v.stock} of ${n.v.label} in stock.` })
    setMsg(null)
    setNewLines((c) => c.map((x, j) => (j === i ? { ...x, qty: next } : x)))
  }

  function start() {
    if (!bill) return
    if (bill.needsApproval && !approval.current) return setDlg({ t: 'approval' })
    void complete()
  }
  async function complete() {
    if (!bill) return
    setBusy(true)
    try {
      const r = await window.api.returns.do({
        billId: bill.id, lines: picked.map((x) => ({ lineId: x.l.id, qty: x.q, ...(x.l.pieces.length ? { serials: serialSel[x.l.id] } : {}) })),
        newLines: newLines.map((n) => ({ variantId: n.v.id, qty: n.qty, ...(n.serials ? { serials: n.serials } : {}) })), settle: effectiveSettle, payMode, approval: approval.current
      })
      announce(); setMsg(null); setDlg({ t: 'done', r })
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Something went wrong.'
      if (approval.current && /approv|PIN/i.test(text)) { approval.current = undefined; setDlg({ t: 'approval', error: text }) }
      else setMsg({ ok: false, text })
    } finally { setBusy(false) }
  }
  function finished() { setDlg(null); back(); setQ(''); void loadCtx() }

  return (
    <>
      <div className="head"><div><h1>Return / exchange</h1><div className="sub">Find the bill, choose what comes back, optionally add new items.</div></div></div>
      {node}
      {!bill ? (
        <div className="panel">
          <div className="row">
            <div className="f"><label htmlFor="rq">Bill number or customer mobile</label>
              <input id="rq" className="big" autoFocus autoComplete="off" placeholder="Bill number (12 or C1/2026-27/0012) or 10-digit mobile" value={q}
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find() } }} /></div>
            <button className="btn p" onClick={() => void find()}>Find bills</button>
          </div>
          {found === null ? <div className="hint">No paper bill needed. The customer's mobile number finds every bill.</div>
            : found.length ? (
              <div className="tw"><table>
                <thead><tr><th>Bill no</th><th>Date</th><th>Customer</th><th className="r">Total</th><th /></tr></thead>
                <tbody>{found.map((b) => (
                  <tr key={b.id}><td className="mono">{b.no}</td><td>{fmtDate(b.at)}</td><td>{b.customerName ?? 'Walk-in'}</td><td className="r num">{formatRupees(b.grand)}</td>
                    <td><button className="btn sm p" onClick={() => void pick(b.id)}>Choose</button></td></tr>
                ))}</tbody>
              </table></div>
            ) : <div className="empty">{q.trim() ? 'No bills found for that number. Walk-in bills have no mobile: use the bill number.' : 'No bills yet.'}</div>}
        </div>
      ) : (
        <div className="cols">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="panel">
              <div className="head"><h2>Items coming back · <span className="mono">{bill.no}</span></h2><button className="btn sm" onClick={back}>Other bill</button></div>
              <div className="sub">{fmtDay(bill.at)} · {bill.customerName ?? 'Walk-in'} · {formatRupees(bill.grand)}</div>
              {bill.overWindow && (
                <div className="banner">
                  This bill is {bill.ageDays} days old (window {bill.windowDays} days).{bill.needsApproval ? " A manager's approval will be asked." : ''}
                </div>
              )}
              <div className="tw"><table>
                <thead><tr><th>Item</th><th className="r">Paid each</th><th>Sold</th><th>Return qty</th></tr></thead>
                <tbody>{bill.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}<div className="sub">{l.colour} · {l.size}</div></td>
                    <td className="r num">{formatRupees(Math.round(l.total / l.qty))}</td>
                    <td className="num">{l.qty}{l.returned ? ` (${l.returned} back)` : ''}</td>
                    <td>{l.returnable > 0 && l.pieces.length > 0
                      ? (
                        <div aria-label={`Pieces to return for ${l.name} ${l.colour} ${l.size}`}>
                          {l.pieces.map((s) => (
                            <label key={s} className="check mono"><input type="checkbox" checked={(serialSel[l.id] ?? []).includes(s)}
                              onChange={(e) => setSerialSel((x) => ({ ...x, [l.id]: e.target.checked ? [...(x[l.id] ?? []), s] : (x[l.id] ?? []).filter((y) => y !== s) }))} /> {s}</label>
                          ))}
                        </div>
                      )
                      : l.returnable > 0
                      ? <input type="number" min="0" max={l.returnable} aria-label={`Return quantity for ${l.name} ${l.colour} ${l.size}`} value={sel[l.id] ?? ''}
                          onChange={(e) => setSel({ ...sel, [l.id]: e.target.value })} />
                      : <span className="sub">{l.service ? 'Service' : 'All returned'}</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>

            <div className="panel">
              <h2>New items (exchange)</h2>
              <input id="rnq" autoComplete="off" placeholder="Scan or search the new item" aria-label="New item" value={nq} onChange={(e) => setNq(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const code = nq
                  const piece = await run(() => window.api.billing.scanPiece(code, newLines.flatMap((n) => (n.serials ?? []).map((serial) => ({ variantId: n.v.id, serial })))))
                  if (piece === undefined) return setNq('')
                  if (piece) return addNewPiece(piece.variant, piece.serial)
                  const r = await run(() => window.api.billing.search(nq))
                  if (r?.length === 1) addNew(r[0]!)
                }} />
              {results.length > 0 && (
                <div className="results">{results.map((v) => (
                  <button key={v.id} onClick={() => addNew(v)} style={v.stock <= 0 ? { opacity: 0.6 } : undefined}>
                    <span>{v.label}</span>
                    <span className="sub num">{formatRupees(v.price)} · {v.stock > 0 ? `stock ${v.stock}` : <b style={{ color: 'var(--bad)' }}>out of stock</b>}</span>
                  </button>
                ))}</div>
              )}
              {newLines.length ? (
                <div className="tw"><table><tbody>{newLines.map((n, i) => (
                  <tr key={n.v.id}>
                    <td>{n.v.label}{n.serials && <div className="sub mono">Serial {n.serials.join(', ')}</div>}</td>
                    <td>{n.serials ? <b className="num">{n.qty}</b> : <span className="qty"><button aria-label="Less" onClick={() => bump(i, -1)}>−</button><span className="num">{n.qty}</span><button aria-label="More" onClick={() => bump(i, 1)}>+</button></span>}</td>
                    <td className="r num">{formatRupees(n.v.price * n.qty)}</td>
                    <td><button className="btn sm" aria-label="Remove" onClick={() => setNewLines((c) => c.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}</tbody></table></div>
              ) : <div className="hint">Leave empty for a plain return.</div>}
            </div>
          </div>

          <div className="panel">
            <h2>Settle</h2>
            <div className="tot">
              <span>Return value</span><span className="num">{formatRupees(returnValue)}</span>
              <span>New items</span><span className="num">{formatRupees(newLines.length ? exchange.grand : 0)}</span>
              <span className="g">{diff > 0 ? 'Customer pays' : diff < 0 ? 'Give back' : 'Difference'}</span><span className="g">{formatRupees(Math.abs(diff))}</span>
            </div>
            {diff > 0 && (
              <div className="f"><label htmlFor="rpm">Customer pays by</label>
                <select id="rpm" value={payMode} onChange={(e) => setPayMode(e.target.value as PayMode)}>
                  <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
                </select></div>
            )}
            {diff < 0 && (
              <>
                <label className="radio-card" style={walkIn ? { opacity: 0.55 } : undefined}>
                  <input type="radio" name="settle" disabled={walkIn} checked={effectiveSettle === 'credit_note'} onChange={() => setSettle('credit_note')} />
                  <span><b>Credit note</b><br /><span className="sub">{walkIn ? 'Needs a customer on the original bill' : 'Use on a later bill before it expires'}</span></span>
                </label>
                <label className="radio-card">
                  <input type="radio" name="settle" checked={effectiveSettle === 'cash'} onChange={() => setSettle('cash')} />
                  <span><b>Refund cash</b><br /><span className="sub">From today's drawer</span></span>
                </label>
              </>
            )}
            {ctx && !ctx.session && <div className="banner">The day has not been started. Start the day to complete a return.</div>}
            <button className="btn p lg block" disabled={!picked.length || busy || !ctx?.session} onClick={start}>Complete {newLines.length ? 'exchange' : 'return'}</button>
          </div>
        </div>
      )}

      {ctx && !ctx.session && <OpeningModal onStarted={() => void loadCtx()} />}
      {dlg?.t === 'approval' && ctx && (
        <ApprovalModal reasons={[`Bill is ${bill?.ageDays} days old; the return window is ${bill?.windowDays} days.`]} error={dlg.error} approvers={ctx.approvers}
          onCancel={() => setDlg(null)} onApprove={(a) => { approval.current = a; setDlg(null); void complete() }} />
      )}
      {dlg?.t === 'done' && ctx && <DoneModal r={dlg.r} ctx={ctx} onClose={finished} />}
    </>
  )
}

function DoneModal({ r, ctx, onClose }: { r: ReturnResult; ctx: BillingContext; onClose: () => void }) {
  const { run: runP, node: printMsg } = useMsg()
  const lines: string[] = []
  if (r.creditNote) lines.push(`Credit note ${formatRupees(r.creditNote.amount)} issued, valid till ${fmtDay(r.creditNote.expiresAt)}.`)
  if (r.cashRefund) lines.push(`Refund ${formatRupees(r.cashRefund)} in cash from the drawer.`)
  if (r.customerPaid) lines.push(`Customer paid ${formatRupees(r.customerPaid)}.`)
  return (
    <Modal title={r.saleBill ? 'Exchange done' : 'Return done'} wide onClose={onClose}>
      <div className="banner good">{r.returnBill.no}{r.saleBill ? ` + ${r.saleBill.no}` : ''} saved{lines.length ? ' · ' + lines.join(' ') : ''}</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="receipt" style={{ flex: 1 }} aria-label="Return receipt">{receiptText(r.returnBill, ctx.shop, ctx.gstScheme)}</div>
        {r.saleBill && <div className="receipt" style={{ flex: 1 }} aria-label="Exchange receipt">{receiptText(r.saleBill, ctx.shop, ctx.gstScheme)}</div>}
      </div>
      {printMsg}
      <div className="mfoot">
        <button className="btn" onClick={() => void runP(async () => { await window.api.print.receipt(r.returnBill.id); if (r.saleBill) await window.api.print.receipt(r.saleBill.id) }, 'Sent to the receipt printer.')}>Print receipt{r.saleBill ? 's' : ''}</button>
        <button className="btn p" autoFocus onClick={onClose}>Done</button>
      </div>
    </Modal>
  )
}
