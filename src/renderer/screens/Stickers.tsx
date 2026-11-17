import { useEffect, useRef, useState } from 'react'
import type { VariantSearchRow } from '@shared/catalogue'
import { LABEL_CSS, LABEL_SIZES, MAX_PER_ITEM, labelHtml, labelSize, type StickerContext, type StickerItem } from '@shared/stickers'
import { Modal, num, useMsg, useScanFocus } from '../ui'

interface Line { item: StickerItem; qty: string }

export function Stickers({ intent }: { intent?: string }) {
  const [ctx, setCtx] = useState<StickerContext | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<VariantSearchRow[]>([])
  const [sel, setSel] = useState<string | null>(null) // line shown in the preview
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(false)
  const scan = useRef<HTMLInputElement>(null)
  useScanFocus(scan)
  const { run, setMsg, node } = useMsg()

  useEffect(() => {
    void run(() => window.api.stickers.context()).then((c) => c && setCtx(c))
    if (intent?.startsWith('purchase')) void loadLast(intent.split(':')[1])
    else if (intent?.startsWith('variants:')) void loadStock(intent.slice(9).split(',').filter(Boolean))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!q.trim()) return setResults([])
    let stale = false
    void window.api.stock.search(q).then((r) => { if (!stale) setResults(r) }, () => undefined)
    return () => { stale = true }
  }, [q])

  function put(items: StickerItem[], qtyOf: (i: StickerItem) => number) {
    setLines((ls) => {
      let next = [...ls]
      for (const it of items) {
        const add = qtyOf(it)
        next = next.some((l) => l.item.variantId === it.variantId)
          ? next.map((l) => (l.item.variantId === it.variantId ? { ...l, qty: String(num(l.qty) + add) } : l))
          : [...next, { item: it, qty: String(add) }]
      }
      return next
    })
    if (items[0]) setSel(items[0].variantId)
  }

  async function add(v: VariantSearchRow) {
    setQ(''); setResults([])
    const items = await run(() => window.api.stickers.items([v.id]))
    if (items) { setMsg(null); put(items, () => 1) }
    scan.current?.focus()
  }

  async function onEnter() {
    if (results.length === 1) return void add(results[0]!)
    if (!results.length && q.trim()) { setMsg({ ok: false, text: `No item found for "${q.trim()}".` }); setQ("") }
  }

  /** from Products / Import: one label for every piece in stock of these items */
  async function loadStock(ids: string[]) {
    const items = await run(() => window.api.stickers.stock(ids))
    if (items) put(items, (i) => i.qty)
  }

  async function loadLast(purchaseId?: string) {
    const items = await run(() => window.api.stickers.lastPurchase(purchaseId))
    if (!items) return
    if (!items.length) return setMsg({ ok: false, text: 'There is no purchase yet. Receive stock in Stock in first.' })
    put(items, (i) => i.qty)
    setMsg({ ok: true, text: `Added the ${items.length} item${items.length === 1 ? '' : 's'} of the purchase, one sticker per piece received.` })
  }

  const total = lines.reduce((n, l) => n + Math.max(0, Math.floor(num(l.qty))), 0)
  const bad = lines.find((l) => !Number.isInteger(num(l.qty)) || num(l.qty) < 1 || num(l.qty) > MAX_PER_ITEM)
  const shown = lines.find((l) => l.item.variantId === sel) ?? lines[0]
  const size = labelSize(ctx?.sizeId ?? '50x25')

  async function print() {
    if (bad) return setMsg({ ok: false, text: `Enter 1 to ${MAX_PER_ITEM} stickers for ${bad.item.name}.` })
    setBusy(true)
    const r = await run(() => window.api.stickers.print(lines.map((l) => ({ variantId: l.item.variantId, qty: num(l.qty) }))))
    setBusy(false)
    if (r) setMsg({ ok: true, text: `Sent ${r.printed} sticker${r.printed === 1 ? '' : 's'} to the printer.` })
  }

  return (
    <>
      <div className="head"><div><h1>Print stickers</h1><div className="sub">Scan or search an item, set how many stickers, then print.</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void loadLast()}>Last purchase</button>
          <button className="btn" disabled={!lines.length} onClick={() => { setLines([]); setSel(null); setMsg(null) }}>Clear list</button>
        </div>
      </div>
      {node}
      <style>{LABEL_CSS}</style>
      <div className="cols">
        <div className="panel">
          <div className="f">
            <label htmlFor="stk-q">Scan or search item</label>
            <input id="stk-q" ref={scan} onFocus={(e) => e.target.select()} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onEnter() } }} autoComplete="off" />
            {results.length > 0 && (
              <div className="results">
                {results.map((v) => (
                  <button key={v.id} onClick={() => void add(v)}><span>{v.label}</span><span className="sub num">{v.barcode}</span></button>
                ))}
              </div>
            )}
          </div>
          {lines.length ? (
            <div className="tw"><table>
              <thead><tr><th>Item</th><th>Barcode</th><th>Stickers</th><th /></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.item.variantId} className={l.item.variantId === shown?.item.variantId ? 'sel' : ''} onClick={() => setSel(l.item.variantId)}>
                  <td>{l.item.name} · {l.item.colour} · {l.item.size}</td>
                  <td className="mono">{l.item.barcode}</td>
                  <td><input type="number" min="1" max={MAX_PER_ITEM} aria-label={`Stickers for ${l.item.name} ${l.item.size}`} style={{ width: 90 }} value={l.qty}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.item.variantId === l.item.variantId ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td><button className="btn sm" aria-label={`Remove ${l.item.name} ${l.item.size}`} onClick={(e) => { e.stopPropagation(); setLines((ls) => ls.filter((x) => x.item.variantId !== l.item.variantId)) }}>✕</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty">Nothing on the list yet. Scan an item, or press <b>Last purchase</b> to print what just arrived.</div>}
        </div>

        <div className="panel">
          <h2>Preview · {size.wMm} × {size.hMm} mm</h2>
          {shown
            ? <div className="lblprev" aria-label="Sticker preview" dangerouslySetInnerHTML={{ __html: labelHtml(shown.item, size) }} />
            : <div className="empty">The label appears here.</div>}
          <button className="btn p lg block" disabled={!lines.length || busy || !ctx} onClick={() => void print()}>{busy ? 'Printing…' : `Print ${total} sticker${total === 1 ? '' : 's'}`}</button>
          <div className="sub printer-line"><span>Printer: {ctx ? (ctx.printer || 'ask when printing') : '…'}</span>{ctx?.canManage && <><button className="btn sm" onClick={() => setSettings(true)}>Change</button></>}</div>
        </div>
      </div>
      {settings && ctx && <PrinterModal ctx={ctx} onClose={() => setSettings(false)} onSaved={(c) => { setCtx(c); setSettings(false); setMsg({ ok: true, text: 'Label settings saved.' }) }} />}
    </>
  )
}

function PrinterModal({ ctx, onClose, onSaved }: { ctx: StickerContext; onClose: () => void; onSaved: (c: StickerContext) => void }) {
  const [size, setSize] = useState(ctx.sizeId)
  const [printer, setPrinter] = useState(ctx.printer)
  const [printers, setPrinters] = useState<string[]>([])
  const { run, node } = useMsg()
  useEffect(() => { void window.api.stickers.printers().then(setPrinters, () => undefined) }, [])
  const names = printer && !printers.includes(printer) ? [printer, ...printers] : printers
  return (
    <Modal title="Label settings" onClose={onClose}>
      {node}
      <div className="f"><label htmlFor="ls-s">Label size</label>
        <select id="ls-s" value={size} onChange={(e) => setSize(e.target.value)}>{LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
      <div className="f"><label htmlFor="ls-p">Printer</label>
        <select id="ls-p" value={printer} onChange={(e) => setPrinter(e.target.value)}>
          <option value="">Ask me every time (print dialog)</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select></div>
      <div className="hint">With a printer chosen, stickers print straight away. Install the printer's Windows driver first (for example the TSC TE244 driver).</div>
      <div className="mfoot"><button className="btn p" onClick={() => void run(() => window.api.stickers.savePrefs({ size, printer })).then((c) => c && onSaved(c))}>Save</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Modal>
  )
}
