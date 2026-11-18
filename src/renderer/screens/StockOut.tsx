import { useEffect, useRef, useState } from 'react'
import type { SupplierDto, VariantSearchRow } from '@shared/catalogue'
import { OUT_TYPES, type ApprovalInput, type ApproverDto, type OutType } from '@shared/stockops'
import type { StaffPublic } from '@shared/types'
import { SERIAL_MSG } from '@shared/serials'
import { num, useMsg, useScanFocus } from '../ui'
import { ApprovalModal } from './Billing'

/** serials = the exact pieces going out (items with serial numbers); qty is then how many of them */
interface Line { v: VariantSearchRow; qty: string; serials?: string[] }

export function StockOut({ user }: { user: StaffPublic }) {
  const [type, setType] = useState<OutType>('supplier_return')
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [reason, setReason] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<VariantSearchRow[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [approvers, setApprovers] = useState<ApproverDto[]>([])
  const [asking, setAsking] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const scan = useRef<HTMLInputElement>(null)
  useScanFocus(scan)
  const { msg, run, setMsg, node } = useMsg()

  useEffect(() => {
    void run(() => window.api.stock.suppliers()).then((s) => { if (s) { setSuppliers(s); setSupplierId(s[0]?.id ?? '') } })
    void window.api.stock.approvers().then(setApprovers, () => undefined)
  }, [run])

  useEffect(() => {
    if (!q.trim()) return setResults([])
    let stale = false
    void window.api.stock.search(q).then((r) => { if (!stale) setResults(r) }, () => undefined)
    return () => { stale = true }
  }, [q])

  function addPiece(v: VariantSearchRow, serial: string) {
    setMsg(null)
    setLines((ls) => (ls.some((l) => l.v.id === v.id)
      ? ls.map((l) => (l.v.id === v.id ? { ...l, serials: [...(l.serials ?? []), serial], qty: String((l.serials ?? []).length + 1) } : l))
      : [...ls, { v, qty: '1', serials: [serial] }]))
    setQ(''); setResults([])
    scan.current?.focus()
  }

  function add(v: VariantSearchRow) {
    if (v.tracked) { setMsg({ ok: false, text: SERIAL_MSG.noSerial }); setQ(''); setResults([]); return }
    setLines((ls) => (ls.some((l) => l.v.id === v.id) ? ls.map((l) => (l.v.id === v.id ? { ...l, qty: String(num(l.qty) + 1) } : l)) : [...ls, { v, qty: '1' }]))
    setQ(''); setResults([])
    scan.current?.focus()
  }

  async function scanEnter() {
    const code = q
    // a sticker of a serial item: that exact piece
    const piece = await run(() => window.api.stock.scanPiece(code, lines.flatMap((l) => (l.serials ?? []).map((serial) => ({ variantId: l.v.id, serial })))))
    if (piece === undefined) return setQ('')
    if (piece) return addPiece(piece.variant, piece.serial)
    const found = await run(() => window.api.stock.search(q))
    if (!found) return
    if (found.length) add(found[0]!)
    else if (q.trim()) { setMsg({ ok: false, text: `No item found for "${q.trim()}".` }); setQ("") }
  }

  const pieces = lines.reduce((a, l) => a + num(l.qty), 0)
  const needsApproval = user.role === 'store' ? lines.filter((l) => num(l.qty) > l.v.stock) : []

  async function submit(approval?: ApprovalInput) {
    setBusy(true)
    const r = await run(() => window.api.stock.out({
      type, supplierId: type === 'supplier_return' ? supplierId || null : null, reason,
      lines: lines.map((l) => ({ variantId: l.v.id, qty: l.serials ? l.serials.length : num(l.qty), ...(l.serials ? { serials: l.serials } : {}) })), approval
    }))
    setBusy(false)
    if (!r) return // the error is shown (inside the approval dialog if it is open)
    setAsking(null); setLines([]); setReason('')
    setMsg({ ok: true, text: `${r.qty} pieces taken out of stock.` })
  }

  function save() {
    if (needsApproval.length) setAsking(needsApproval.map((l) => `${l.v.label}: taking ${l.qty}, only ${l.v.stock} in stock.`))
    else void submit()
  }

  return (
    <>
      <div className="head"><h1>Stock out</h1></div>
      {node}
      {asking && <ApprovalModal reasons={['Some items would go below zero stock.', ...asking]} approvers={approvers} error={msg && !msg.ok ? msg.text : undefined}
        onCancel={() => { setAsking(null); setMsg(null) }} onApprove={(a) => void submit(a)} />}
      <div className="cols">
        <div className="panel">
          <div className="row">
            <div className="f">
              <label htmlFor="so-t">Reason</label>
              <select id="so-t" value={type} onChange={(e) => setType(e.target.value as OutType)}>
                {OUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {type === 'supplier_return' && (
              <div className="f">
                <label htmlFor="so-s">Supplier</label>
                <select id="so-s" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  {suppliers.length === 0 && <option value="">Add a supplier in Stock in first</option>}
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div className="f"><label htmlFor="so-r">Note</label><input id="so-r" placeholder={type === 'other' ? 'Required' : 'Optional'} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </div>
          <div className="f">
            <label htmlFor="soq">Scan or search item</label>
            <input id="soq" ref={scan} onFocus={(e) => e.target.select()} className="big" autoFocus autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scanEnter() } }} />
          </div>
          {results.length > 0 && (
            <div className="results">
              {results.map((v) => <button key={v.id} onClick={() => add(v)}><span>{v.label}</span><span className="sub num">{v.barcode} · stock {v.stock}</span></button>)}
            </div>
          )}
          {lines.length ? (
            <div className="tw">
              <table>
                <thead><tr><th>Item</th><th className="r">In stock</th><th>Qty</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.v.id}>
                      <td>{l.v.label}<div className="sub mono">{l.v.barcode}</div>
                        {l.serials && <div className="sub mono" aria-label="Serial numbers">Serial {l.serials.join(', ')}</div>}</td>
                      <td className="r num">{l.v.stock}</td>
                      <td>{l.serials
                        ? <b className="num">{l.serials.length}</b>
                        : <input type="number" min="1" aria-label="Quantity" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />}</td>
                      <td><button className="btn sm" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty">Scan or search items to add them. Items with serial numbers are added by scanning each piece's sticker.</div>}
        </div>
        <div className="panel">
          <div className="tot"><span>Pieces going out</span><span className="g">{pieces}</span></div>
          <button className="btn p lg block" disabled={!pieces || busy} onClick={save}>Save stock out</button>
          <div className="hint">Stock goes down at once. Going below zero needs manager approval.</div>
        </div>
      </div>
    </>
  )
}
