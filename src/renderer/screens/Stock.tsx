import { useCallback, useEffect, useRef, useState } from 'react'
import { formatRupees } from '@shared/money'
import type { MoveRow, StockRow } from '@shared/catalogue'
import { ADJUST_REASONS, type AdjustReason, type ApprovalInput, type ApproverDto, type CountDto, type MoveFullRow } from '@shared/stockops'
import type { StaffPublic } from '@shared/types'
import { fmtDate, Modal, useMsg, useScanFocus } from '../ui'
import { ApprovalModal } from './Billing'

type Tab = 'levels' | 'count' | 'moves'
const TABS: { k: Tab; label: string }[] = [{ k: 'levels', label: 'Stock levels' }, { k: 'count', label: 'Stock count' }, { k: 'moves', label: 'Recent moves' }]
const typeText = (t: string) => t.replace(/_/g, ' ')

export function Stock({ user }: { user: StaffPublic }) {
  const [tab, setTab] = useState<Tab>('levels')
  return (
    <>
      <div className="head"><h1>Stock</h1></div>
      <div className="panel">
        <div className="tabs" role="tablist">
          {TABS.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}>{t.label}</button>)}
        </div>
        {tab === 'levels' && <Levels user={user} />}
        {tab === 'count' && <Count user={user} />}
        {tab === 'moves' && <Moves />}
      </div>
    </>
  )
}

/* ---------- levels ---------- */

function Levels({ user }: { user: StaffPublic }) {
  const [rows, setRows] = useState<StockRow[]>([])
  const [q, setQ] = useState('')
  const [low, setLow] = useState(false)
  const [tick, setTick] = useState(0)
  const [hist, setHist] = useState<StockRow | null>(null)
  const [adj, setAdj] = useState<StockRow | null>(null)
  const { run, setMsg, node } = useMsg()

  useEffect(() => { void run(() => window.api.stock.levels(q, low)).then((r) => r && setRows(r)) }, [q, low, tick, run])

  return (
    <>
      {node}
      <div className="row">
        <div className="f"><label htmlFor="stq">Search</label><input id="stq" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
      </div>
      {rows.length ? (
        <div className="tw">
          <table>
            <thead><tr><th>Item</th><th>Barcode</th><th className="r">In stock</th><th className="r">Min</th><th className="r">Value at cost</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variantId}>
                  <td>{r.label}</td><td className="mono">{r.barcode}</td>
                  <td className="r num">{r.qty <= r.minStock ? <span className={`chip ${r.qty <= 0 ? 'bad' : 'warn'}`}>{r.qty}</span> : r.qty}</td>
                  <td className="r num">{r.minStock}</td><td className="r num">{formatRupees(r.costValue)}</td>
                  <td><div className="row"><button className="btn sm" onClick={() => setHist(r)}>History</button><button className="btn sm" onClick={() => setAdj(r)}>Adjust</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">{low ? 'Nothing is low. Good.' : 'No items yet.'}</div>}
      {hist && <HistoryModal row={hist} onClose={() => setHist(null)} />}
      {adj && <AdjustModal row={adj} user={user} onClose={() => setAdj(null)} onDone={(text) => { setAdj(null); setTick((t) => t + 1); setMsg({ ok: true, text }) }} />}
    </>
  )
}

function HistoryModal({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [moves, setMoves] = useState<MoveRow[] | null>(null)
  useEffect(() => { void window.api.stock.history(row.variantId).then(setMoves, () => setMoves([])) }, [row.variantId])
  return (
    <Modal title={row.label} wide onClose={onClose}>
      <div className="sub">In stock now: <b>{row.qty}</b></div>
      {moves?.length ? (
        <div className="tw" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          <table>
            <thead><tr><th>When</th><th>Type</th><th className="r">Qty</th><th>Ref / reason</th><th>By</th></tr></thead>
            <tbody>{moves.map((m, i) => <tr key={i}><td>{fmtDate(m.at)}</td><td>{typeText(m.type)}</td><td className="r num">{m.qty > 0 ? '+' : ''}{m.qty}</td><td>{[m.ref, m.reason].filter(Boolean).join(' ')}</td><td>{m.staff ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <div className="empty">{moves ? 'No movements.' : 'Loading…'}</div>}
      <div className="mfoot"><button className="btn p" onClick={onClose}>Close</button></div>
    </Modal>
  )
}

function AdjustModal({ row, user, onClose, onDone }: { row: StockRow; user: StaffPublic; onClose: () => void; onDone: (text: string) => void }) {
  const [change, setChange] = useState('-1')
  const [reason, setReason] = useState<AdjustReason>('damaged')
  const [asking, setAsking] = useState(false)
  const [approvers, setApprovers] = useState<ApproverDto[]>([])
  const { msg, run, setMsg, node } = useMsg()
  useEffect(() => { if (user.role === 'store') void window.api.stock.approvers().then(setApprovers, () => undefined) }, [user.role])

  async function submit(approval?: ApprovalInput) {
    const r = await run(() => window.api.stock.adjust({ variantId: row.variantId, change: Number(change), reason, approval }))
    if (r) onDone(`Stock adjusted. ${row.label} is now ${r.stock}.`)
  }
  function save() {
    setMsg(null)
    if (user.role === 'store') setAsking(true)
    else void submit()
  }

  if (asking) {
    return <ApprovalModal reasons={['Stock adjustment needs a manager or owner.']} approvers={approvers} error={msg && !msg.ok ? msg.text : undefined}
      onCancel={() => { setAsking(false); setMsg(null) }} onApprove={(a) => void submit(a)} />
  }
  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <div>{row.label} · in stock <b>{row.qty}</b></div>
      {node}
      <div className="row">
        <div className="f"><label htmlFor="aj-q">Change (+ or −)</label><input id="aj-q" type="number" autoFocus value={change} onChange={(e) => setChange(e.target.value)} /></div>
        <div className="f"><label htmlFor="aj-r">Reason</label>
          <select id="aj-r" value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>{ADJUST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
        </div>
      </div>
      <div className="mfoot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={save}>Save adjustment</button></div>
    </Modal>
  )
}

/* ---------- stock count ---------- */

function Count({ user }: { user: StaffPublic }) {
  const [count, setCount] = useState<CountDto | null | undefined>(undefined)
  const [code, setCode] = useState('')
  const [asking, setAsking] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [approvers, setApprovers] = useState<ApproverDto[]>([])
  const scan = useRef<HTMLInputElement>(null)
  useScanFocus(scan)
  const { msg, run, attempt, setMsg, node } = useMsg()

  const load = useCallback(() => run(() => window.api.count.get()).then((c) => setCount(c ?? null)), [run])
  useEffect(() => { void load(); if (user.role === 'store') void window.api.stock.approvers().then(setApprovers, () => undefined) }, [load, user.role])

  async function start() { const c = await run(() => window.api.count.start()); if (c) setCount(c) }

  async function scanEnter() {
    const text = code
    setCode('')
    const r = await run(() => window.api.count.scan(text))
    if (r) setCount((c) => c && { ...c, lines: c.lines.map((l) => (l.variantId === r.variantId ? { ...l, counted: r.counted } : l)) })
    scan.current?.focus()
  }

  async function setCounted(variantId: string, value: string) {
    const n = value === '' ? 0 : Number(value)
    if (await attempt(() => window.api.count.set(variantId, n))) setCount((c) => c && { ...c, lines: c.lines.map((l) => (l.variantId === variantId ? { ...l, counted: n } : l)) })
  }

  async function approve(approval?: ApprovalInput) {
    const r = await run(() => window.api.count.approve(approval))
    if (!r) return
    setAsking(false); setCount(null)
    setMsg({ ok: true, text: `Count approved: ${r.adjusted} item${r.adjusted === 1 ? '' : 's'} adjusted.` })
  }

  async function discard() {
    setConfirmDiscard(false)
    if (await attempt(() => window.api.count.discard())) { setCount(null); setMsg({ ok: true, text: 'Count discarded. Stock was not changed.' }) }
  }

  if (count === undefined) return <>{node}</>
  if (count === null) {
    return (
      <>
        {node}
        <div className="empty">Count the shelf when the shop is closed. Start a count, scan every piece, then approve the differences.<br /><br />
          <button className="btn p" onClick={() => void start()}>Start stock count</button></div>
      </>
    )
  }

  const diffs = count.lines.filter((l) => l.counted !== l.system)
  const scanned = count.lines.reduce((a, l) => a + l.counted, 0)
  const shown = count.lines.filter((l) => l.counted > 0).concat(count.lines.filter((l) => l.counted === 0 && l.system > 0).slice(0, 8))

  return (
    <>
      {node}
      {asking && <ApprovalModal reasons={['Approving a stock count changes stock.']} approvers={approvers} error={msg && !msg.ok ? msg.text : undefined}
        onCancel={() => { setAsking(false); setMsg(null) }} onApprove={(a) => void approve(a)} />}
      {confirmDiscard && (
        <Modal title="Discard this count?" onClose={() => setConfirmDiscard(false)}>
          <p style={{ margin: 0 }}>The pieces you have scanned are forgotten. Stock is not changed.</p>
          <div className="mfoot"><button className="btn" onClick={() => setConfirmDiscard(false)}>Keep counting</button><button className="btn danger" onClick={() => void discard()}>Discard</button></div>
        </Modal>
      )}
      <div className="f">
        <label htmlFor="cq">Scan each piece on the shelf</label>
        <input id="cq" ref={scan} onFocus={(e) => e.target.select()} className="big" autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) { e.preventDefault(); void scanEnter() } }} />
      </div>
      <div className="hint">{scanned} pieces scanned · {diffs.length} items differ from the system.</div>
      <div className="tw">
        <table>
          <thead><tr><th>Item</th><th className="r">System</th><th>Counted</th><th className="r">Difference</th></tr></thead>
          <tbody>
            {shown.map((l) => {
              const d = l.counted - l.system
              return (
                <tr key={l.variantId}>
                  <td>{l.label}</td><td className="r num">{l.system}</td>
                  <td><input type="number" min="0" aria-label={`Counted ${l.label}`} defaultValue={l.counted} key={l.counted} onBlur={(e) => Number(e.target.value || 0) !== l.counted && void setCounted(l.variantId, e.target.value)} /></td>
                  <td className="r num">{d ? <span className={`chip ${d < 0 ? 'bad' : 'warn'}`}>{d > 0 ? '+' : ''}{d}</span> : '0'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="hint">Showing scanned items and some not yet scanned. Items never scanned count as 0 when you approve.</div>
      <div className="row">
        <button className="btn danger" onClick={() => setConfirmDiscard(true)}>Discard count</button>
        <button className="btn p" onClick={() => (user.role === 'store' ? setAsking(true) : void approve())}>Approve {diffs.length} adjustment{diffs.length === 1 ? '' : 's'}</button>
      </div>
    </>
  )
}

/* ---------- recent moves ---------- */

function Moves() {
  const [rows, setRows] = useState<MoveFullRow[] | null>(null)
  const { run, node } = useMsg()
  useEffect(() => { void run(() => window.api.stock.moves()).then((r) => r && setRows(r)) }, [run])
  return (
    <>
      {node}
      {rows?.length ? (
        <div className="tw">
          <table>
            <thead><tr><th>When</th><th>Item</th><th>Type</th><th className="r">Qty</th><th>Ref</th><th>By</th></tr></thead>
            <tbody>{rows.map((m, i) => <tr key={i}><td>{fmtDate(m.at)}</td><td>{m.label}</td><td>{typeText(m.type)}</td><td className="r num">{m.qty > 0 ? '+' : ''}{m.qty}</td><td className="mono">{m.ref ?? ''}</td><td>{m.staff ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <div className="empty">{rows ? 'No stock movements yet.' : 'Loading…'}</div>}
    </>
  )
}
