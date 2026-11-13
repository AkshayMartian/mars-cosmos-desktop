import { useCallback, useEffect, useState } from 'react'
import { formatRupees, toPaise } from '@shared/money'
import {
  ALT_NEXT, ALT_STATUS, altDue, readyMessage, type AltContext, type AltJobDto, type AltKpis, type GarmentChoice, type TailorDto
} from '@shared/alterations'
import type { CustomerDto, PayMode } from '@shared/billing'
import type { StaffPublic } from '@shared/types'
import { Modal, useMsg } from '../ui'
import { AltFields, altFormCommon, altFormError, emptyAltForm, TagModal, type AltForm } from './AlterationForm'
import { CustomerModal, OpeningModal, ReceiptModal } from './Billing'
import type { BillDto, BillingContext } from '@shared/billing'

type Tab = 'open' | 'received' | 'with_tailor' | 'ready' | 'late' | 'delivered'
const TABS: [Tab, string][] = [['open', 'Open'], ['received', 'Received'], ['with_tailor', 'With tailor'], ['ready', 'Ready'], ['late', 'Late'], ['delivered', 'Delivered']]

type Dlg =
  | { t: 'new' }
  | { t: 'tag'; jobs: AltJobDto[] }
  | { t: 'wa'; job: AltJobDto }
  | { t: 'pay'; job: AltJobDto }
  | { t: 'tailors' }
  | { t: 'receipt'; bill: BillDto; ctx: BillingContext }
  | null

const announce = () => window.dispatchEvent(new Event('mars:sale-saved'))

export function Alterations(_props: { user: StaffPublic }) {
  const [ctx, setCtx] = useState<AltContext | null>(null)
  const [jobs, setJobs] = useState<AltJobDto[] | null>(null)
  const [kpis, setKpis] = useState<AltKpis>({ open: 0, dueToday: 0, late: 0, waiting: 0 })
  const [tab, setTab] = useState<Tab>('open')
  const [q, setQ] = useState('')
  const [dlg, setDlg] = useState<Dlg>(null)
  const { run, setMsg, node } = useMsg()

  const load = useCallback(async () => {
    const r = await run(() => window.api.alterations.list(q))
    if (r) { setJobs(r.jobs); setKpis(r.kpis) }
  }, [run, q])
  const loadCtx = useCallback(() => run(() => window.api.alterations.context()).then((c) => c && setCtx(c)), [run])
  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadCtx() }, [loadCtx])

  const shown = (jobs ?? []).filter((j) => {
    if (tab === 'open') return !['delivered', 'cancelled'].includes(j.status)
    if (tab === 'late') return j.late
    return j.status === tab
  })

  async function next(j: AltJobDto) {
    if (j.status === 'ready' && j.charge > 0 && !j.paid) return setDlg({ t: 'pay', job: j })
    const r = await run(() => window.api.alterations.advance(j.id))
    if (!r) return
    void load()
    if (r.status === 'with_tailor') setMsg({ ok: true, text: `${r.no} sent to ${r.tailorName}.` })
    else if (r.status === 'ready') setDlg({ t: 'wa', job: r })
    else setMsg({ ok: true, text: `${r.no} handed over.` })
  }

  return (
    <>
      <div className="head">
        <div><h1>Alterations</h1><div className="sub">Every job gets a tailor tag. Scan or type the job number to find it.</div></div>
        <div className="row">
          {ctx?.canManage && <button className="btn" onClick={() => setDlg({ t: 'tailors' })}>Tailors</button>}
          <button className="btn p" onClick={() => setDlg({ t: 'new' })}>+ New alteration</button>
        </div>
      </div>
      {node}
      <div className="kpis">
        <div className="kpi"><b>{kpis.open}</b><span>Open jobs</span></div>
        <div className="kpi"><b>{kpis.dueToday}</b><span>Ready by today</span></div>
        <div className="kpi"><b style={{ color: 'var(--bad)' }}>{kpis.late}</b><span>Late</span></div>
        <div className="kpi"><b>{kpis.waiting}</b><span>Waiting for pickup</span></div>
      </div>
      <div className="panel">
        <div className="row"><div className="f"><label htmlFor="aq">Job number, customer name or mobile</label>
          <input id="aq" autoComplete="off" placeholder="ALT-0002 or 9824012345" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
        {shown.length ? (
          <div className="tw"><table>
            <thead><tr><th>Job</th><th>Customer</th><th>Item and work</th><th>Tailor</th><th>Ready by</th><th>Status</th><th /></tr></thead>
            <tbody>{shown.map((a) => {
              const st = ALT_STATUS[a.status]
              const due = a.status === 'ready' && a.charge > 0 && !a.paid
              return (
                <tr key={a.id}>
                  <td><b className="mono">{a.no}</b><div className="sub mono">{a.billNo ?? 'No bill'}</div></td>
                  <td>{a.customerName}<div className="sub mono">{a.customerMobile}</div></td>
                  <td>{a.item}<div className="sub">{a.work.join(', ')}{a.notes ? ' · ' + a.notes : ''}</div>
                    {a.charge > 0 && <div className="sub">{formatRupees(a.charge)} {a.paid ? 'paid' : 'to collect'}</div>}</td>
                  <td>{a.tailorName}</td>
                  <td>{altDue(a.dueAt)}{a.late && <div><span className="chip bad">Late</span></div>}</td>
                  <td><span className={`chip ${st.tone}`}>{st.label}</span></td>
                  <td><div className="row">
                    {ALT_NEXT[a.status] && (
                      <button className="btn sm p" disabled={due && !ctx?.canCollect} title={due && !ctx?.canCollect ? 'The cashier collects the charge' : undefined} onClick={() => void next(a)}>
                        {due ? 'Collect and hand over' : ALT_NEXT[a.status]}
                      </button>
                    )}
                    <button className="btn sm" onClick={() => setDlg({ t: 'tag', jobs: [a] })}>Tag</button>
                    {a.status === 'ready' && <button className="btn sm" onClick={() => setDlg({ t: 'wa', job: a })}>WhatsApp</button>}
                  </div></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        ) : <div className="empty">{jobs ? 'No jobs here.' : 'Loading…'}</div>}
      </div>

      {dlg?.t === 'new' && ctx && <NewAlteration ctx={ctx} onClose={() => setDlg(null)} onSaved={(j) => { setDlg({ t: 'tag', jobs: [j] }); void load(); void loadCtx() }} />}
      {dlg?.t === 'tag' && ctx && <TagModal jobs={dlg.jobs} ctx={ctx} onClose={() => setDlg(null)} />}
      {dlg?.t === 'wa' && ctx && <WaModal job={dlg.job} ctx={ctx} onClose={() => setDlg(null)} />}
      {dlg?.t === 'pay' && (
        <PayModal job={dlg.job} onClose={() => setDlg(null)}
          onDone={(job, bill, bctx) => { setDlg(bill && bctx ? { t: 'receipt', bill, ctx: bctx } : null); void load(); announce(); setMsg({ ok: true, text: `${job.no} paid and handed over.` }) }}
          onNoDay={() => setDlg(null)} />
      )}
      {dlg?.t === 'receipt' && <ReceiptModal bill={dlg.bill} ctx={dlg.ctx} onNew={() => setDlg(null)} />}
      {dlg?.t === 'tailors' && ctx && <TailorsModal ctx={ctx} onClose={() => setDlg(null)} onChanged={() => void loadCtx()} />}

    </>
  )
}

/* ---------- dialogs ---------- */

function WaModal({ job, ctx, onClose }: { job: AltJobDto; ctx: AltContext; onClose: () => void }) {
  const text = readyMessage(job, ctx.shop)
  return (
    <Modal title="Tell the customer it is ready" onClose={onClose}>
      <p style={{ margin: 0 }}>{job.no} is ready. This opens WhatsApp on the PC with the message ready; staff press Send.</p>
      <div className="receipt">{text}</div>
      <div className="mfoot">
        <a className="btn p" href={`https://wa.me/91${job.customerMobile}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

function PayModal({ job, onClose, onDone, onNoDay }: {
  job: AltJobDto; onClose: () => void; onNoDay: () => void
  onDone: (job: AltJobDto, bill: BillDto | null, ctx: BillingContext | null) => void
}) {
  const [mode, setMode] = useState<PayMode>('cash')
  const [day, setDay] = useState<'checking' | 'open' | 'closed'>('checking')
  const { run, node } = useMsg()
  useEffect(() => { void window.api.billing.context().then((c) => setDay(c.session ? 'open' : 'closed'), () => setDay('open')) }, [])
  async function save() {
    const r = await run(() => window.api.alterations.deliver({ id: job.id, payMode: mode }))
    if (!r) return
    const bill = r.billId ? await window.api.billing.bill(r.billId).catch(() => null) : null
    const bctx = await window.api.billing.context().catch(() => null)
    onDone(r.job, bill, bctx)
  }
  if (day === 'closed') return <OpeningModal onStarted={() => setDay('open')} />

  return (
    <Modal title="Collect alteration charge" onClose={onClose}>
      {node}
      <p style={{ margin: 0 }}>{job.no} · {job.item}</p>
      <div className="tot"><span className="g">To collect</span><span className="g">{formatRupees(job.charge)}</span></div>
      <div className="f"><label htmlFor="ap-m">Paid by</label>
        <select id="ap-m" value={mode} onChange={(e) => setMode(e.target.value as PayMode)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></div>
      <div className="hint">The charge includes {job.gstRate}% GST. A bill is made for it.</div>
      <div className="mfoot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={day !== 'open'} onClick={() => void save()}>Save and hand over</button></div>
    </Modal>
  )
}

function NewAlteration({ ctx, onClose, onSaved }: { ctx: AltContext; onClose: () => void; onSaved: (j: AltJobDto) => void }) {
  const [mobile, setMobile] = useState('')
  const [cust, setCust] = useState<{ id: string; name: string; mobile: string } | null>(null)
  const [miss, setMiss] = useState(false)
  const [garments, setGarments] = useState<GarmentChoice[]>([])
  const [garment, setGarment] = useState('own')
  const [own, setOwn] = useState('')
  const [form, setForm] = useState<AltForm>(() => emptyAltForm(ctx))
  const [adding, setAdding] = useState(false)
  const { run, setMsg, node } = useMsg()

  async function find(m = mobile) {
    const c = await run(() => window.api.alterations.customer(m))
    if (c === undefined) return
    setCust(c); setMiss(!c)
    if (c) { const g = await window.api.alterations.garments(c.id).catch(() => []); setGarments(g); setGarment(g[0]?.key ?? 'own') }
  }
  async function save() {
    if (!cust) return
    const err = altFormError(form)
    if (err) return setMsg({ ok: false, text: err })
    const g = garments.find((x) => x.key === garment)
    const j = await run(() => window.api.alterations.create({
      customerId: cust.id, billId: g?.billId ?? null, variantId: g?.variantId ?? null, ownItem: own, ...altFormCommon(form)
    }))
    if (j) onSaved(j)
  }

  return (
    <Modal title="New alteration" wide onClose={onClose}>
      {node}
      <div className="row">
        <div className="f"><label htmlFor="an-m">Customer mobile</label>
          <input id="an-m" autoFocus inputMode="numeric" maxLength={10} value={mobile}
            onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); setMobile(d); setMiss(false); setCust(null); if (d.length === 10) void find(d) }}
            onKeyDown={(e) => e.key === 'Enter' && void find()} /></div>
        <button className="btn" onClick={() => void find()}>Find</button>
      </div>
      {cust ? (
        <>
          <div className="cust"><b>{cust.name}</b><span className="sub">{cust.mobile}</span></div>
          <div className="f"><label htmlFor="an-i">Garment</label>
            <select id="an-i" value={garment} onChange={(e) => setGarment(e.target.value)}>
              {garments.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              <option value="own">Customer's own garment (type below)</option>
            </select></div>
          {garment === 'own' && <div className="f"><label htmlFor="an-o">What is the garment?</label><input id="an-o" value={own} placeholder="e.g. Grey formal trouser" onChange={(e) => setOwn(e.target.value)} /></div>}
          <AltFields ctx={ctx} value={form} onChange={setForm} />
          <div className="hint">A charge is collected when the customer picks the garment up.</div>
        </>
      ) : miss ? (
        <div className="cust"><span>No customer with this number.</span>
          <div>{ctx.canCollect ? <button className="btn sm p" onClick={() => setAdding(true)}>Add customer</button> : <span className="sub">Ask the counter to add the customer first.</span>}</div></div>
      ) : <div className="hint">Find the customer first. The tag and the ready message need their mobile.</div>}
      <div className="mfoot"><button className="btn" onClick={onClose}>Cancel</button>{cust && <button className="btn p" onClick={() => void save()}>Save and print tag</button>}</div>
      {adding && <CustomerModal mobile={mobile} onClose={() => setAdding(false)} onSaved={(c: CustomerDto) => { setAdding(false); setMobile(c.mobile); void find(c.mobile) }} />}
    </Modal>
  )
}

function TailorsModal({ ctx, onClose, onChanged }: { ctx: AltContext; onClose: () => void; onChanged: () => void }) {
  const [tailors, setTailors] = useState<TailorDto[]>(ctx.tailors)
  const [f, setF] = useState({ name: '', mobile: '', kind: 'In-house' as 'In-house' | 'Outside', rate: '60' })
  const { run, node } = useMsg()

  async function add() {
    const t = await run(() => window.api.alterations.saveTailor({ name: f.name, mobile: f.mobile, kind: f.kind, ratePerJob: toPaise(f.rate), active: true }), 'Tailor added.')
    if (t) { setTailors(t); setF({ ...f, name: '', mobile: '' }); onChanged() }
  }
  async function toggle(t: TailorDto) {
    const r = await run(() => window.api.alterations.saveTailor({ id: t.id, name: t.name, mobile: t.mobile, kind: t.kind, ratePerJob: t.ratePerJob, active: !t.active }))
    if (r) { setTailors(r); onChanged() }
  }
  return (
    <Modal title="Tailors" wide onClose={onClose}>
      {node}
      <div className="tw"><table>
        <thead><tr><th>Name</th><th>Mobile</th><th>Type</th><th className="r">Rate per job</th><th className="r">Open jobs</th><th /></tr></thead>
        <tbody>{tailors.map((t) => (
          <tr key={t.id}><td>{t.name}{!t.active && <> <span className="chip muted">Inactive</span></>}</td><td className="mono">{t.mobile}</td><td>{t.kind}</td>
            <td className="r num">{formatRupees(t.ratePerJob)}</td><td className="r num">{t.openJobs}</td>
            <td><button className="btn sm" onClick={() => void toggle(t)}>{t.active ? 'Make inactive' : 'Make active'}</button></td></tr>
        ))}</tbody>
      </table></div>
      <div className="row">
        <div className="f"><label htmlFor="tl-n">New tailor name</label><input id="tl-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="f"><label htmlFor="tl-m">Mobile</label><input id="tl-m" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
        <div className="f"><label htmlFor="tl-k">Type</label><select id="tl-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'In-house' | 'Outside' })}><option>In-house</option><option>Outside</option></select></div>
        <div className="f"><label htmlFor="tl-c">Rate per job ₹</label><input id="tl-c" type="number" min="0" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
        <button className="btn" onClick={() => void add()}>Add tailor</button>
      </div>
      <div className="mfoot"><button className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  )
}
