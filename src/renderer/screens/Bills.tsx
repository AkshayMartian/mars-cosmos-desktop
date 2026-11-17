import { useCallback, useEffect, useRef, useState } from 'react'
import { formatRupees } from '@shared/money'
import { receiptText, whatsappText } from '@shared/receipt'
import type { BillDetail, BillListRow, BillPeriod } from '@shared/bills'
import type { BillingContext } from '@shared/billing'
import type { StaffPublic } from '@shared/types'
import { fmtDate, Modal, useMsg } from '../ui'
import { ApprovalModal } from './Billing'

const modeName = (m: string): string => m.replace('_', ' ').toUpperCase()

/** Tell the top bar ("My sales today") that a bill changed. */
const announce = () => window.dispatchEvent(new Event('mars:sale-saved'))

type Dlg = { t: 'receipt' } | { t: 'cancel'; error?: string } | { t: 'approval'; reason: string; error?: string } | null

export function Bills(_props: { user: StaffPublic }) {
  const [period, setPeriod] = useState<BillPeriod>('today')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<BillListRow[] | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BillDetail | null>(null)
  const [ctx, setCtx] = useState<BillingContext | null>(null)
  const [dlg, setDlg] = useState<Dlg>(null)
  const [reason, setReason] = useState('')
  const approval = useRef<{ staffId: string; pin: string } | undefined>(undefined)
  const { run, setMsg, node } = useMsg()
  const { run: runP, node: printMsg } = useMsg()

  const load = useCallback(() => {
    void run(() => window.api.bills.list(period, q)).then((r) => r && setRows(r))
  }, [run, period, q])
  useEffect(() => { load() }, [load])
  useEffect(() => { void window.api.billing.context().then(setCtx, () => undefined) }, [])

  const open = useCallback(async (id: string) => {
    setSelId(id)
    const d = await run(() => window.api.bills.detail(id))
    if (d) setDetail(d)
  }, [run])

  async function cancel() {
    if (!detail) return
    const text = reason.trim()
    if (!text) return setDlg({ t: 'cancel', error: 'Type a reason.' })
    if (detail.needsApproval && !approval.current) return setDlg({ t: 'approval', reason: 'Cancelling a bill needs a manager or owner.' })
    try {
      const d = await window.api.bills.cancel({ billId: detail.bill.id, reason: text, approval: approval.current })
      setDetail(d); setDlg(null); setReason(''); approval.current = undefined
      setMsg({ ok: true, text: `Bill ${d.bill.no} cancelled. Stock is back.` })
      announce(); load()
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Something went wrong.'
      if (approval.current && /approv|PIN/i.test(m)) { approval.current = undefined; setDlg({ t: 'approval', reason: 'Cancelling a bill needs a manager or owner.', error: m }) }
      else setDlg({ t: 'cancel', error: m })
    }
  }

  const b = detail?.bill
  const mobile = b?.customer?.mobile
  const noConsent = !!b?.customer && b.customer.waConsent === false // they have not agreed to WhatsApp bills
  const wa = b && ctx && mobile && !noConsent && b.type === 'sale' ? `https://wa.me/91${mobile}?text=${encodeURIComponent(whatsappText(b, ctx.shop))}` : null

  return (
    <>
      <div className="head"><h1>Bills</h1></div>
      {node}
      <div className="cols">
        <div className="panel">
          <div className="row">
            <div className="f"><label htmlFor="bq">Bill number, mobile or name</label>
              <input id="bq" autoFocus autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="f" style={{ maxWidth: 170 }}><label htmlFor="bp">Period</label>
              <select id="bp" value={period} onChange={(e) => setPeriod(e.target.value as BillPeriod)}>
                <option value="today">Today</option><option value="7">Last 7 days</option><option value="all">All</option>
              </select></div>
          </div>
          {rows?.length ? (
            <div className="tw"><table>
              <thead><tr><th>Bill no</th><th>Time</th><th>Customer</th><th className="r">Total</th><th>Paid by</th><th>Status</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className={`click${selId === r.id ? ' sel' : ''}`} onClick={() => void open(r.id)}>
                  <td className="mono">{r.no}</td><td>{fmtDate(r.at)}</td><td>{r.customerName ?? 'Walk-in'}</td>
                  <td className="r num">{formatRupees(r.grand)}</td><td>{r.modes.map(modeName).join(' + ')}</td>
                  <td>{r.type === 'return' ? <span className="chip warn">Return</span> : r.status === 'cancelled' ? <span className="chip bad">Cancelled</span> : <span className="chip good">Paid</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty">{rows ? 'No bills for this filter. Make a bill on Billing, or choose "All".' : 'Loading…'}</div>}
        </div>

        <div className="panel">
          {b && detail ? (
            <>
              <h2 className="mono">{b.no}</h2>
              <div className="sub">{fmtDate(b.at)} · {b.staffName} · {b.customer?.name ?? 'Walk-in'}</div>
              <div className="tw"><table><tbody>
                {b.lines.map((l, i) => (
                  <tr key={i}><td>{l.name}<div className="sub">{l.colour} · {l.size}</div></td><td className="num">× {l.qty}</td><td className="r num">{formatRupees(l.total)}</td></tr>
                ))}
              </tbody></table></div>
              <div className="tot">
                <span>Total</span><b className="num">{formatRupees(b.grand)}</b>
                <span className="sub">Paid</span><span className="sub">{b.payments.map((p) => `${p.mode.replace('_', ' ')} ${formatRupees(p.amount)}`).join(' + ') || '—'}</span>
                {detail.cancelReason && <><span className="sub">Cancelled</span><span className="sub">{detail.cancelReason}{detail.cancelledBy ? ` (by ${detail.cancelledBy})` : ''}</span></>}
              </div>
              <div className="row">
                <button className="btn" onClick={() => setDlg({ t: 'receipt' })}>Reprint</button>
                {wa ? <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a> : <button className="btn" disabled title={b.type === 'return' ? 'Not for return bills' : noConsent ? 'This customer has not agreed to WhatsApp bills. Edit the customer to record their consent.' : 'This bill has no customer mobile'}>Send on WhatsApp</button>}
                {detail.cancellable && <button className="btn danger" onClick={() => { setReason(''); setDlg({ t: 'cancel' }) }}>Cancel bill</button>}
              </div>
              {detail.cancelHint && b.status === 'completed' && b.type === 'sale' && <div className="hint">{detail.cancelHint}</div>}
            </>
          ) : <div className="empty">Click a bill to see it.</div>}
        </div>
      </div>

      {dlg?.t === 'receipt' && b && ctx && (
        <Modal title={`${b.type === 'return' ? 'Return receipt' : 'Receipt'} (duplicate)`} wide onClose={() => setDlg(null)}>
          <div className="receipt" aria-label="Receipt">{receiptText(b, ctx.shop, ctx.gstScheme, true)}</div>
          {printMsg}
          <div className="mfoot"><button className="btn" onClick={() => void runP(() => window.api.print.receipt(b.id, true), 'Sent to the receipt printer.')}>Print</button><button className="btn p" autoFocus onClick={() => setDlg(null)}>Close</button></div>
        </Modal>
      )}
      {dlg?.t === 'cancel' && b && (
        <Modal title="Cancel this bill?" onClose={() => setDlg(null)}>
          <p style={{ margin: 0 }}>Stock goes back and the sale is removed from today's totals. The bill stays in the list as Cancelled.</p>
          <div className="f"><label htmlFor="cf-r">Reason</label>
            <input id="cf-r" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void cancel()} /></div>
          <div className="err" role="alert">{dlg.error ?? ''}</div>
          <div className="mfoot"><button className="btn" onClick={() => setDlg(null)}>Keep</button><button className="btn danger" onClick={() => void cancel()}>Cancel bill</button></div>
        </Modal>
      )}
      {dlg?.t === 'approval' && ctx && (
        <ApprovalModal reasons={[dlg.reason]} error={dlg.error} approvers={ctx.approvers} onCancel={() => setDlg(null)}
          onApprove={(a) => { approval.current = a; void cancel() }} />
      )}

    </>
  )
}
