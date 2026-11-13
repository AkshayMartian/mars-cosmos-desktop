import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { calc } from '@shared/calc'
import { formatRupees, toPaise } from '@shared/money'
import { sizesText } from '@shared/customers'
import { receiptText, whatsappText } from '@shared/receipt'
import type { BillDto, BillingContext, CustomerDto, HeldBillDto, PayMode, SellableVariant } from '@shared/billing'
import type { StaffPublic } from '@shared/types'
import { fmtDate, Modal, useMsg } from '../ui'

interface CartLine { v: SellableVariant; qty: number; disc: string }
type Dlg =
  | { t: 'pay' }
  | { t: 'approval'; reasons: string[]; error?: string }
  | { t: 'held' }
  | { t: 'customer' }
  | { t: 'receipt'; bill: BillDto }
  | null

/** Tell the top bar ("My sales today") that a bill was saved. */
const announceSale = () => window.dispatchEvent(new Event('mars:sale-saved'))

export function Billing({ user }: { user: StaffPublic }) {
  const [ctx, setCtx] = useState<BillingContext | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SellableVariant[]>([])
  const [mobile, setMobile] = useState('')
  const [customer, setCustomer] = useState<CustomerDto | null>(null)
  const [miss, setMiss] = useState(false)
  const [billDisc, setBillDisc] = useState('')
  const [salesBy, setSalesBy] = useState(user.id)
  const [dlg, setDlg] = useState<Dlg>(null)
  const [heldCount, setHeldCount] = useState(0)
  const approval = useRef<{ staffId: string; pin: string } | undefined>(undefined)
  const scanRef = useRef<HTMLInputElement>(null)
  const mobileRef = useRef<HTMLInputElement>(null)
  const { msg, run, attempt, setMsg, node } = useMsg()

  const loadCtx = useCallback(() => run(() => window.api.billing.context()).then((c) => c && setCtx(c)), [run])
  const loadHeld = useCallback(() => window.api.billing.held().then((h) => setHeldCount(h.length), () => undefined), [])
  useEffect(() => { void loadCtx(); void loadHeld() }, [loadCtx, loadHeld])

  // live search while typing (Enter does its own lookup so a fast scanner never races this)
  useEffect(() => {
    if (!q.trim()) return setResults([])
    let stale = false
    void window.api.billing.search(q).then((r) => { if (!stale) setResults(r) }, () => undefined)
    return () => { stale = true }
  }, [q])

  // Photo of the colour that was scanned, loaded once per item on the bill (null = that colour has no photo).
  const [photos, setPhotos] = useState<Record<string, string | null>>({})
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const l of cart) {
      const id = l.v.id
      if (asked.current.has(id)) continue
      asked.current.add(id)
      void window.api.billing.photo(id).then((p) => setPhotos((x) => ({ ...x, [id]: p })), () => setPhotos((x) => ({ ...x, [id]: null })))
    }
  }, [cart])

  const scheme = ctx?.gstScheme ?? 'regular'
  const totals = useMemo(
    () => calc(scheme, cart.map((l) => ({ variantId: l.v.id, qty: l.qty, price: l.v.price, disc: toPaise(l.disc), gst: l.v.gst })), toPaise(billDisc)),
    [scheme, cart, billDisc]
  )

  /* ----- cart ----- */
  /** Nothing without stock goes on a bill, and never more than the stock. */
  function add(v: SellableVariant) {
    const inCart = cart.find((l) => l.v.id === v.id)?.qty ?? 0
    if (v.stock <= 0) { setMsg({ ok: false, text: `${v.label} is out of stock.` }); setQ(''); setResults([]); scanRef.current?.focus(); return }
    if (inCart + 1 > v.stock) { setMsg({ ok: false, text: `Only ${v.stock} of ${v.label} in stock.` }); setQ(''); setResults([]); scanRef.current?.focus(); return }
    setMsg(null)
    setCart((c) => (c.some((l) => l.v.id === v.id) ? c.map((l) => (l.v.id === v.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { v, qty: 1, disc: '' }]))
    setQ(''); setResults([])
    scanRef.current?.focus()
  }
  function setQty(i: number, d: number) {
    const l = cart[i]
    if (!l) return
    const next = Math.max(1, l.qty + d)
    if (next > l.v.stock) return setMsg({ ok: false, text: `Only ${l.v.stock} of ${l.v.label} in stock.` })
    setMsg(null)
    setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: next } : x)))
  }
  const setLineDisc = (i: number, v: string) => setCart((c) => c.map((l, j) => (j === i ? { ...l, disc: v } : l)))
  const remove = (i: number) => setCart((c) => c.filter((_, j) => j !== i))

  function clearBill() {
    setCart([]); setQ(''); setResults([]); setMobile(''); setCustomer(null); setMiss(false); setBillDisc(''); setSalesBy(user.id)
    approval.current = undefined
    setMsg(null)
    scanRef.current?.focus()
  }

  async function scanEnter() {
    const found = await run(() => window.api.billing.search(q))
    if (!found) return
    if (found.length === 1) add(found[0]!)
    else if (!found.length && q.trim()) {
      const archived = await window.api.billing.archived(q).catch(() => [] as string[])
      setMsg({
        ok: false,
        text: archived.length
          ? `No item found for "${q.trim()}". "${archived.join('", "')}" ${archived.length === 1 ? 'is' : 'are'} archived: restore it in Products → Show archived to sell it.`
          : `No item found for "${q.trim()}".`
      })
    }
  }

  /* ----- customer ----- */
  async function findCustomer(number = mobile) {
    const c = await run(() => window.api.customers.find(number))
    if (c === undefined) return // error shown
    setCustomer(c); setMiss(!c)
  }

  /* ----- pay ----- */
  const approvalReasons = (): string[] => {
    if (!ctx || ctx.actorRole === 'owner' || ctx.actorRole === 'manager') return []
    const pct = totals.subtotal ? Math.round((totals.discount / totals.subtotal) * 100) : 0
    return pct > ctx.maxDiscountPct ? [`Discount ${pct}% is more than your limit of ${ctx.maxDiscountPct}%.`] : []
  }

  function startPay() {
    if (!cart.length || !ctx?.session) return
    const reasons = approvalReasons()
    if (reasons.length && !approval.current) return setDlg({ t: 'approval', reasons })
    setDlg({ t: 'pay' })
  }

  async function saveBill(payments: { mode: PayMode; amount: number }[]) {
    try {
      const bill = await window.api.billing.create({
        lines: cart.map((l) => ({ variantId: l.v.id, qty: l.qty, disc: toPaise(l.disc) })),
        customerId: customer?.id ?? null, billDisc: toPaise(billDisc), salesBy, payments, approval: approval.current
      })
      setMsg(null); announceSale(); setDlg({ t: 'receipt', bill })
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Something went wrong.'
      // A refused approval (wrong PIN, or locked after too many tries) goes back to the approval dialog with the real reason.
      if (approval.current && /approv|PIN/i.test(text)) { approval.current = undefined; setMsg(null); setDlg({ t: 'approval', reasons: approvalReasons(), error: text }) }
      else setMsg({ ok: false, text })
    }
  }

  /* ----- hold / resume ----- */
  async function hold() {
    if (!cart.length) return setMsg({ ok: false, text: 'Nothing to hold.' })
    const ok = await attempt(() => window.api.billing.hold({ lines: cart.map((l) => ({ variantId: l.v.id, qty: l.qty, disc: toPaise(l.disc) })), customerId: customer?.id ?? null }))
    if (ok) { clearBill(); void loadHeld(); setMsg({ ok: true, text: 'Bill held. Find it under "Held".' }) }
  }

  async function resume(h: HeldBillDto) {
    const payload = await run(() => window.api.billing.resume(h.id))
    if (!payload) return
    const items = await run(() => window.api.billing.variants(payload.lines.map((l) => l.variantId)))
    if (!items) return
    const byId = new Map(items.map((v) => [v.id, v]))
    clearBill()
    // Stock may have changed while the bill was held: keep only what can still be sold, and say so.
    const notes: string[] = []
    const back: CartLine[] = []
    for (const l of payload.lines) {
      const v = byId.get(l.variantId)
      if (!v) { notes.push('an item that is no longer available was removed'); continue }
      const qty = Math.min(l.qty, v.stock)
      if (qty <= 0) { notes.push(`${v.label} is out of stock and was removed`); continue }
      if (qty < l.qty) notes.push(`${v.label} reduced to ${qty} (all that is in stock)`)
      back.push({ v, qty, disc: l.disc ? String(l.disc / 100) : '' })
    }
    setCart(back)
    if (notes.length) setMsg({ ok: false, text: `Bill resumed, but ${notes.join('; ')}.` })
    setDlg(null); void loadHeld()
  }

  /* ----- keyboard: F2 search, F4 customer, F9 pay, Esc clear ----- */
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined)
  keys.current = (e) => {
    if (dlg || !ctx?.session) return
    if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus() }
    else if (e.key === 'F4') { e.preventDefault(); mobileRef.current?.focus() }
    else if (e.key === 'F9') { e.preventDefault(); startPay() }
    else if (e.key === 'Escape') clearBill()
  }
  useEffect(() => { const f = (e: KeyboardEvent) => keys.current(e); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f) }, [])

  const exactBarcode = results.length === 1 && results[0]!.barcode === q.trim()
  const gstTotal = totals.cgst + totals.sgst

  return (
    <>
      <div className="head">
        <div><h1>Billing</h1><div className="sub">F2 search · F4 customer · F9 pay · Esc clear</div></div>
        <div className="row">
          <button className="btn" onClick={() => void hold()}>Hold bill</button>
          <button className="btn" onClick={() => setDlg({ t: 'held' })}>Held ({heldCount})</button>
          <button className="btn" onClick={clearBill}>Clear</button>
        </div>
      </div>
      {node}
      <div className="cols">
        <div className="panel">
          <div className="f">
            <label htmlFor="scan">Scan barcode or type item name</label>
            <input id="scan" ref={scanRef} className="big" autoFocus autoComplete="off" placeholder="2000000000015 or 'shirt'" value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scanEnter() } }} />
          </div>
          {results.length > 0 && !exactBarcode && (
            <div className="results">
              {results.map((v) => (
                <button key={v.id} onClick={() => add(v)} style={v.stock <= 0 ? { opacity: 0.6 } : undefined}>
                  <span>{v.label}</span>
                  <span className="sub num">{formatRupees(v.price)} · {v.stock > 0 ? `stock ${v.stock}` : <b style={{ color: 'var(--bad)' }}>out of stock</b>}</span>
                </button>
              ))}
            </div>
          )}
          {cart.length ? (
            <div className="tw">
              <table>
                <thead><tr><th>Item</th><th>Qty</th><th className="r">Price</th><th className="r">Discount ₹</th><th className="r">GST</th><th className="r">Total</th><th /></tr></thead>
                <tbody>
                  {totals.lines.map((l, i) => {
                    const line = cart[i]!
                    return (
                      <tr key={line.v.id}>
                        <td>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div className="thumb" aria-hidden={!photos[line.v.id]}>{photos[line.v.id] ? <img src={photos[line.v.id]!} alt={`${line.v.name} ${line.v.colour}`} /> : null}</div>
                            <div>
                              <b>{line.v.name}</b>
                              <div className="sub">{line.v.colour} · {line.v.size} · <span className="mono">{line.v.barcode}</span> · {line.v.stock} in stock</div>
                            </div>
                          </div>
                        </td>
                        <td><span className="qty"><button aria-label="Less" onClick={() => setQty(i, -1)}>−</button><span className="num">{line.qty}</span><button aria-label="More" onClick={() => setQty(i, 1)}>+</button></span></td>
                        <td className="r num">{formatRupees(line.v.price)}</td>
                        <td className="r"><input type="number" min="0" aria-label="Line discount" value={line.disc} onChange={(e) => setLineDisc(i, e.target.value)} /></td>
                        <td className="r num">{l.rate}%</td>
                        <td className="r num"><b>{formatRupees(l.net)}</b></td>
                        <td><button className="btn sm" aria-label="Remove" onClick={() => remove(i)}>✕</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="empty">Scan the first item to start a bill.</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel">
            <div className="row">
              <div className="f" style={{ flex: 1 }}>
                <label htmlFor="custMobile">Customer mobile (F4)</label>
                <input id="custMobile" ref={mobileRef} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" value={mobile}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '')
                    setMobile(digits); setMiss(false)
                    if (digits.length === 10) void findCustomer(digits) // the card (with sizes) appears as soon as the number is complete
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void findCustomer() } }} />
              </div>
              <button className="btn" onClick={() => void findCustomer()}>Find</button>
            </div>
            {customer ? (
              <div className="cust">
                <b>{customer.name}</b>
                {sizesText(customer.sizes) && <span className="sub" aria-label="Usual sizes">{sizesText(customer.sizes)}</span>}
                {customer.gstin && <span className="sub">GSTIN {customer.gstin} (business bill)</span>}
                <div><button className="btn sm" onClick={() => { setCustomer(null); setMobile(''); setMiss(false) }}>Change customer</button></div>
              </div>
            ) : miss ? (
              <div className="cust"><span>No customer with this number.</span><div><button className="btn sm p" onClick={() => setDlg({ t: 'customer' })}>Add customer</button></div></div>
            ) : <div className="hint">Walk-in bill if left empty.</div>}
          </div>

          <div className="panel">
            <div className="f">
              <label htmlFor="salesBy">Salesperson (for commission)</label>
              <select id="salesBy" value={salesBy} onChange={(e) => setSalesBy(e.target.value)}>
                {ctx?.salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="f"><label htmlFor="billDisc">Bill discount ₹</label><input id="billDisc" type="number" min="0" value={billDisc} onChange={(e) => setBillDisc(e.target.value)} /></div>
            <div className="tot">
              <span>Items</span><span className="num">{totals.qty}</span>
              <span>Subtotal</span><span className="num">{formatRupees(totals.subtotal)}</span>
              {totals.discount > 0 && <><span>Discount</span><span className="num">−{formatRupees(totals.discount)}</span></>}
              <span className="sub">{scheme === 'regular' ? 'GST included' : 'Bill of supply (no GST)'}</span><span className="sub num">{formatRupees(gstTotal)}</span>
              {totals.roundOff !== 0 && <><span className="sub">Round off</span><span className="sub num">{formatRupees(totals.roundOff)}</span></>}
              <span className="g">Total</span><span className="g">{formatRupees(totals.grand)}</span>
            </div>
            {approval.current && <span className="chip good">Approved by {ctx?.approvers.find((a) => a.id === approval.current?.staffId)?.name}</span>}
            <button className="btn p lg block" disabled={!cart.length || !ctx?.session} onClick={startPay}>Pay (F9)</button>
          </div>
        </div>
      </div>

      {ctx && !ctx.session && <OpeningModal onStarted={() => void loadCtx()} />}
      {dlg?.t === 'pay' && ctx && <PayModal grand={totals.grand} error={msg && !msg.ok ? msg.text : undefined} onBack={() => { setMsg(null); setDlg(null) }} onSave={saveBill} />}
      {dlg?.t === 'approval' && ctx && (
        <ApprovalModal reasons={dlg.reasons} error={dlg.error} approvers={ctx.approvers}
          onCancel={() => setDlg(null)} onApprove={(a) => { approval.current = a; setDlg({ t: 'pay' }) }} />
      )}
      {dlg?.t === 'held' && <HeldModal onClose={() => setDlg(null)} onResume={(h) => void resume(h)} />}
      {dlg?.t === 'customer' && <CustomerModal mobile={mobile} onClose={() => setDlg(null)} onSaved={(c) => { setCustomer(c); setMobile(c.mobile); setMiss(false); setDlg(null) }} />}
      {dlg?.t === 'receipt' && ctx && <ReceiptModal bill={dlg.bill} ctx={ctx} onNew={() => { setDlg(null); clearBill(); void loadCtx(); void loadHeld() }} />}
    </>
  )
}

/* ---------- dialogs ---------- */

/** Shared by Billing (first bill of the day) and Day end ("Open the day"). */
export function OpeningModal({ onStarted }: { onStarted: () => void }) {
  const [cash, setCash] = useState('2000')
  const { attempt, node } = useMsg()
  const start = async () => { if (await attempt(() => window.api.billing.openDay(toPaise(cash)))) onStarted() }
  return (
    <Modal title="Start the day" onClose={() => undefined}>
      <p style={{ margin: 0 }}>Count the cash in the drawer before the first bill.</p>
      {node}
      <div className="f"><label htmlFor="oc">Opening cash ₹</label>
        <input id="oc" type="number" min="0" className="big" autoFocus value={cash} onChange={(e) => setCash(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void start()} /></div>
      <div className="mfoot"><button className="btn p" onClick={() => void start()}>Start day</button></div>
    </Modal>
  )
}

/** Shared by Billing, Stock out, Stock adjust and Stock count: a manager or owner picks their name and types their PIN. */
export function ApprovalModal({ reasons, error, approvers, onCancel, onApprove }: {
  reasons: string[]; error?: string; approvers: BillingContext['approvers']; onCancel: () => void; onApprove: (a: { staffId: string; pin: string }) => void
}) {
  const [who, setWho] = useState(approvers[0]?.id ?? '')
  const [pin, setPin] = useState('')
  const go = () => pin && onApprove({ staffId: who, pin })
  return (
    <Modal title="Manager approval" onClose={onCancel}>
      {reasons.map((r) => <p key={r} style={{ margin: 0 }}>{r}</p>)}
      <div className="f"><label htmlFor="ap-who">Approved by</label>
        <select id="ap-who" value={who} onChange={(e) => setWho(e.target.value)}>{approvers.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}</select></div>
      <div className="f"><label htmlFor="ap">Their PIN</label>
        <input id="ap" type="password" inputMode="numeric" maxLength={6} className="big" autoComplete="off" autoFocus value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && go()} /></div>
      <div className="err" role="alert">{error ?? ''}</div>
      <div className="mfoot"><button className="btn" onClick={onCancel}>Cancel</button><button className="btn p" onClick={go}>Approve</button></div>
    </Modal>
  )
}

const MODES: { k: PayMode; label: string }[] = [{ k: 'cash', label: 'Cash' }, { k: 'upi', label: 'UPI' }, { k: 'card', label: 'Card' }]

function PayModal({ grand, error, onBack, onSave }: { grand: number; error?: string; onBack: () => void; onSave: (p: { mode: PayMode; amount: number }[]) => Promise<void> }) {
  const [amt, setAmt] = useState<Record<PayMode, string>>({ cash: String(grand / 100), upi: '', card: '' })
  const [recv, setRecv] = useState('')
  const [busy, setBusy] = useState(false)
  const paid = MODES.reduce((a, m) => a + toPaise(amt[m.k]), 0)
  const left = grand - paid
  const change = toPaise(recv) - toPaise(amt.cash)
  const full = (k: PayMode) => setAmt({ ...amt, [k]: String(Math.max(0, grand - MODES.filter((m) => m.k !== k).reduce((a, m) => a + toPaise(amt[m.k]), 0)) / 100) })
  const save = async () => {
    setBusy(true)
    await onSave(MODES.filter((m) => toPaise(amt[m.k]) > 0).map((m) => ({ mode: m.k, amount: toPaise(amt[m.k]) })))
    setBusy(false) // only matters when saving failed and this dialog stays open
  }
  return (
    <Modal title={`Payment · ${formatRupees(grand)}`} wide onClose={onBack}>
      <div className="tw">
        <table><tbody>
          {MODES.map((m) => (
            <tr key={m.k}>
              <td><b>{m.label}</b></td>
              <td><input type="number" min="0" aria-label={`${m.label} amount`} value={amt[m.k]} onChange={(e) => setAmt({ ...amt, [m.k]: e.target.value })} /></td>
              <td><button className="btn sm" onClick={() => full(m.k)}>Full</button></td>
            </tr>
          ))}
        </tbody></table>
      </div>
      {toPaise(amt.cash) > 0 && (
        <div className="row">
          <div className="f"><label htmlFor="recv">Cash received ₹</label><input id="recv" type="number" value={recv} onChange={(e) => setRecv(e.target.value)} /></div>
          {recv !== '' && <div className={`chip ${change < 0 ? 'bad' : 'good'}`} style={{ marginBottom: 8 }}>Return change {formatRupees(Math.max(0, change))}</div>}
        </div>
      )}
      <div className="tot">
        <span>Paid</span><span className="num">{formatRupees(paid)}</span>
        <span className="g">{left > 0 ? 'Still to pay' : left < 0 ? 'Too much' : 'Fully paid'}</span><span className="g">{formatRupees(Math.abs(left))}</span>
      </div>
      <div className="err" role="alert">{error ?? ''}</div>
      <div className="mfoot"><button className="btn" onClick={onBack}>Back</button><button className="btn p lg" disabled={left !== 0 || busy} onClick={() => void save()}>Save bill</button></div>
    </Modal>
  )
}

function HeldModal({ onClose, onResume }: { onClose: () => void; onResume: (h: HeldBillDto) => void }) {
  const [rows, setRows] = useState<HeldBillDto[] | null>(null)
  useEffect(() => { void window.api.billing.held().then(setRows, () => setRows([])) }, [])
  return (
    <Modal title="Held bills" onClose={onClose}>
      {rows?.length ? (
        <div className="tw"><table><tbody>
          {rows.map((h) => <tr key={h.id}><td>{fmtDate(h.at)}</td><td>{h.items} item{h.items === 1 ? '' : 's'}</td><td>{h.staffName}</td><td><button className="btn sm p" onClick={() => onResume(h)}>Resume</button></td></tr>)}
        </tbody></table></div>
      ) : <div className="empty">No held bills.</div>}
      <div className="mfoot"><button className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  )
}

function CustomerModal({ mobile, onClose, onSaved }: { mobile: string; onClose: () => void; onSaved: (c: CustomerDto) => void }) {
  const [f, setF] = useState({ mobile, name: '', wa: false, offers: false })
  const { run, node } = useMsg()
  const save = async () => { const c = await run(() => window.api.customers.create({ mobile: f.mobile, name: f.name, waConsent: f.wa, offersConsent: f.offers })); if (c) onSaved(c) }
  return (
    <Modal title="Add customer" onClose={onClose}>
      {node}
      <div className="row">
        <div className="f"><label htmlFor="cu-m">Mobile *</label><input id="cu-m" inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="f"><label htmlFor="cu-n">Name *</label><input id="cu-n" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} /></div>
      </div>
      <div className="panel" style={{ background: 'var(--sunk)', border: 0 }}>
        <b>Ask the customer and tick only if they agree</b>
        <label className="check"><input type="checkbox" checked={f.wa} onChange={(e) => setF({ ...f, wa: e.target.checked })} /> Send my bill on WhatsApp</label>
        <label className="check"><input type="checkbox" checked={f.offers} onChange={(e) => setF({ ...f, offers: e.target.checked })} /> Send me offers and birthday wishes</label>
        <span className="hint">Saved with today's date and your name. We use the number only for this shop's bills and offers.</span>
      </div>
      <div className="mfoot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={() => void save()}>Save customer</button></div>
    </Modal>
  )
}

function ReceiptModal({ bill, ctx, onNew }: { bill: BillDto; ctx: BillingContext; onNew: () => void }) {
  const mobile = bill.customer?.mobile
  const wa = mobile ? `https://wa.me/91${mobile}?text=${encodeURIComponent(whatsappText(bill, ctx.shop))}` : null
  return (
    <Modal title="Receipt" wide onClose={onNew}>
      <div className="banner good">Bill {bill.no} saved · {formatRupees(bill.grand)}</div>
      <div className="receipt" aria-label="Receipt">{receiptText(bill, ctx.shop, ctx.gstScheme)}</div>
      <div className="hint">Printing to the receipt printer arrives with the printing milestone. The bill is saved.</div>
      <div className="mfoot">
        {wa ? <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a> : <button className="btn" disabled title="Add the customer's mobile on the bill to send it on WhatsApp">Send on WhatsApp</button>}
        <button className="btn p" autoFocus onClick={onNew}>New bill</button>
      </div>
    </Modal>
  )
}
