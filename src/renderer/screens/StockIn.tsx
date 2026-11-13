import { useEffect, useRef, useState } from 'react'
import { formatRupees, toPaise } from '@shared/money'
import type { PurchaseRow, SupplierDto, VariantSearchRow } from '@shared/catalogue'
import { fmtDay, Modal, num, useMsg } from '../ui'

interface Line { v: VariantSearchRow; qty: string; cost: string }
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const STICKERS_SOON = 'Sticker printing arrives with the printing milestone. Your stock is already saved.'

export function StockIn({ onNewProduct, canAddProduct }: { onNewProduct: () => void; canAddProduct: boolean }) {
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState(today())
  const [q, setQ] = useState('')
  const [results, setResults] = useState<VariantSearchRow[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [recent, setRecent] = useState<PurchaseRow[]>([])
  const [dlg, setDlg] = useState(false)
  const [busy, setBusy] = useState(false)
  const scan = useRef<HTMLInputElement>(null)
  const { run, setMsg, node } = useMsg()

  const loadSuppliers = () => run(() => window.api.stock.suppliers()).then((s) => { if (s) { setSuppliers(s); setSupplierId((cur) => cur || s[0]?.id || '') } })
  const loadRecent = () => run(() => window.api.stock.recent()).then((r) => r && setRecent(r))
  useEffect(() => { void loadSuppliers(); void loadRecent() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!q.trim()) return setResults([])
    let stale = false
    void window.api.stock.search(q).then((r) => { if (!stale) setResults(r) }, () => undefined)
    return () => { stale = true }
  }, [q])

  function add(v: VariantSearchRow) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.v.id === v.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: String(num(l.qty) + 1) } : l))
      return [...ls, { v, qty: '1', cost: String(v.cost / 100) }]
    })
    setQ(''); setResults([])
    scan.current?.focus()
  }

  /** Enter looks the text up again itself, so a fast scanner never adds an out-of-date result. */
  async function scanEnter() {
    const found = await run(() => window.api.stock.search(q))
    if (!found) return
    if (found.length >= 1) add(found[0]!)
    else if (q.trim()) setMsg({ ok: false, text: `No item found for "${q.trim()}". New product? Use "+ New product".` })
  }

  const pieces = lines.reduce((a, l) => a + num(l.qty), 0)
  const value = lines.reduce((a, l) => a + num(l.qty) * toPaise(l.cost), 0)

  async function save() {
    setBusy(true)
    const r = await run(() => window.api.stock.in({
      supplierId: supplierId || null, billNo, billDate,
      lines: lines.map((l) => ({ variantId: l.v.id, qty: num(l.qty), cost: toPaise(l.cost) }))
    }))
    setBusy(false)
    if (!r) return
    setLines([]); setBillNo('')
    await loadRecent()
    setMsg({ ok: true, text: `Saved: ${r.qty} pieces added to stock.` })
  }

  return (
    <>
      <div className="head">
        <h1>Stock in</h1>
        {canAddProduct && <button className="btn" onClick={onNewProduct}>+ New product</button>}
      </div>
      {node}
      {dlg && <SupplierModal onClose={() => setDlg(false)} onSaved={async (s) => { setDlg(false); await loadSuppliers(); setSupplierId(s.id); setMsg({ ok: true, text: 'Supplier added.' }) }} />}
      <div className="cols">
        <div className="panel">
          <div className="row">
            <div className="f">
              <label htmlFor="pi-s">Supplier</label>
              <select id="pi-s" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— none —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button className="btn" onClick={() => setDlg(true)}>+ Supplier</button>
            <div className="f"><label htmlFor="pi-b">Supplier bill no</label><input id="pi-b" value={billNo} onChange={(e) => setBillNo(e.target.value)} /></div>
            <div className="f"><label htmlFor="pi-d">Bill date</label><input id="pi-d" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
          </div>
          <div className="f">
            <label htmlFor="piq">Scan or search item</label>
            <input id="piq" ref={scan} className="big" autoComplete="off" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scanEnter() } }} />
          </div>
          {results.length > 0 && (
            <div className="results">
              {results.map((v) => (
                <button key={v.id} onClick={() => add(v)}><span>{v.label}</span><span className="sub num">{v.barcode} · stock {v.stock}</span></button>
              ))}
            </div>
          )}
          {lines.length ? (
            <div className="tw">
              <table>
                <thead><tr><th>Item</th><th className="r">In stock</th><th>Qty</th><th>Cost ₹</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.v.id}>
                      <td>{l.v.label}<div className="sub mono">{l.v.barcode}</div></td>
                      <td className="r num">{l.v.stock}</td>
                      <td><input type="number" min="1" aria-label="Quantity" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                      <td><input type="number" min="0" aria-label="Cost" value={l.cost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} /></td>
                      <td><button className="btn sm" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty">Scan or search items to add them.</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel">
            <div className="tot">
              <span>Lines</span><span className="num">{lines.length}</span>
              <span>Pieces</span><span className="num">{pieces}</span>
              <span className="g">Cost value</span><span className="g">{formatRupees(value)}</span>
            </div>
            <button className="btn p lg block" disabled={!pieces || busy} onClick={() => void save()}>Save stock in</button>
          </div>
          <div className="panel">
            <h2>Recent purchases</h2>
            {recent.length ? recent.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{p.supplier ?? 'No supplier'} · {p.billNo ?? '—'}<br /><span className="sub">{fmtDay(p.at)} · {p.qty} pcs</span></span>
                <button className="btn sm" onClick={() => setMsg({ ok: true, text: STICKERS_SOON })}>Stickers</button>
              </div>
            )) : <div className="hint">None yet.</div>}
          </div>
        </div>
      </div>
    </>
  )
}

function SupplierModal({ onClose, onSaved }: { onClose: () => void; onSaved: (s: SupplierDto) => void }) {
  const [f, setF] = useState({ name: '', mobile: '', gstin: '' })
  const { run, node } = useMsg()
  const save = async () => { const s = await run(() => window.api.stock.addSupplier(f)); if (s) onSaved(s) }
  return (
    <Modal title="Add supplier" onClose={onClose}>
      {node}
      <div className="f"><label htmlFor="su-n">Name</label><input id="su-n" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} /></div>
      <div className="row">
        <div className="f"><label htmlFor="su-m">Mobile</label><input id="su-m" inputMode="numeric" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
        <div className="f"><label htmlFor="su-g">GSTIN</label><input id="su-g" maxLength={15} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></div>
      </div>
      <div className="mfoot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={() => void save()}>Save</button></div>
    </Modal>
  )
}
