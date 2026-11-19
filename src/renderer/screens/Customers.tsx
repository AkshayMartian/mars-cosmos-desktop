import { useEffect, useState } from 'react'
import { formatMonthDay, toDayMonth } from '@shared/dates'
import { formatRupees } from '@shared/money'
import type { CelebrationDto, CustomerListRow, CustomerProfile, CustomerSaveInput, CustomerSizes } from '@shared/customers'
import { NO_SIZES, sizesText } from '@shared/customers'
import type { StaffPublic } from '@shared/types'
import { fmtDay, Modal, useMsg } from '../ui'

type Dlg = { t: 'form'; editing: CustomerProfile | null } | { t: 'delete' } | null

export function Customers({ user }: { user: StaffPublic }) {
  const [rows, setRows] = useState<CustomerListRow[]>([])
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [today, setToday] = useState<CelebrationDto[]>([])
  const [shop, setShop] = useState('')
  const [dlg, setDlg] = useState<Dlg>(null)
  const [tick, setTick] = useState(0)
  const { run, attempt, setMsg, node } = useMsg()
  const canDelete = user.role === 'owner' || user.role === 'manager'

  useEffect(() => { void run(() => window.api.customers.list(q)).then((r) => r && setRows(r)) }, [q, tick, run])
  useEffect(() => { void run(() => window.api.customers.today()).then((r) => r && setToday(r)) }, [tick, run])
  useEffect(() => { void window.api.app.info().then((i) => setShop(i.shopName), () => undefined) }, [])
  useEffect(() => {
    if (!selId) return setProfile(null)
    void window.api.customers.get(selId).then(setProfile, () => { setSelId(null); setProfile(null) })
  }, [selId, tick])

  const wish = (c: CelebrationDto) =>
    `https://wa.me/91${c.mobile}?text=${encodeURIComponent(`Dear ${c.name}, happy ${c.kind === 'birthday' ? 'birthday' : 'anniversary'} from all of us at ${shop}! Visit us this week for a special surprise.`)}`

  async function remove() {
    if (!profile) return
    const ok = await attempt(() => window.api.customers.remove(profile.id))
    setDlg(null)
    if (ok) { setSelId(null); setTick((t) => t + 1); setMsg({ ok: true, text: 'Customer deleted. Their old bills are kept.' }) }
  }

  return (
    <>
      <div className="head">
        <h1>Customers</h1>
        <button className="btn p" onClick={() => setDlg({ t: 'form', editing: null })}>+ Add customer</button>
      </div>
      {node}
      {today.length > 0 && (
        <div className="panel">
          <h2>Today's birthdays and anniversaries ({today.length})</h2>
          {today.map((c) => (
            <div key={c.id + c.kind} className="row" style={{ justifyContent: 'space-between' }}>
              <span><b>{c.name}</b> · {c.kind === 'birthday' ? 'Birthday' : 'Anniversary'} · {c.mobile}</span>
              {c.offersConsent
                ? <a className="btn sm" href={wish(c)} target="_blank" rel="noopener noreferrer">Send wish on WhatsApp</a>
                : <button className="btn sm" disabled title="This customer has not agreed to offers and wishes">No consent to send wishes</button>}
            </div>
          ))}
        </div>
      )}
      <div className="cols">
        <div className="panel">
          <div className="f"><label htmlFor="cq2">Search name or mobile</label><input id="cq2" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {rows.length ? (
            <div className="tw">
              <table>
                <thead><tr><th>Name</th><th>Mobile</th><th className="r">Visits</th><th className="r">Spent</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={`click ${selId === c.id ? 'sel' : ''}`} onClick={() => setSelId(c.id)}>
                      <td>{c.name}</td><td className="mono">{c.mobile}</td><td className="r num">{c.visits}</td><td className="r num">{formatRupees(c.spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty">{q ? 'No customers match.' : 'No customers yet. Click "Add customer", or add one while billing.'}</div>}
        </div>
        <div className="panel">
          {profile ? <Detail p={profile} canDelete={canDelete} onEdit={() => setDlg({ t: 'form', editing: profile })} onDelete={() => setDlg({ t: 'delete' })} />
            : <div className="empty">Click a customer to see the profile.</div>}
        </div>
      </div>

      {dlg?.t === 'form' && (
        <CustomerForm editing={dlg.editing} onClose={() => setDlg(null)}
          onSaved={(c) => { setDlg(null); setSelId(c.id); setTick((t) => t + 1); setMsg({ ok: true, text: 'Customer saved.' }) }} />
      )}
      {dlg?.t === 'delete' && profile && (
        <Modal title="Delete this customer?" onClose={() => setDlg(null)}>
          <p style={{ margin: 0 }}>Name, mobile, birthday and sizes of {profile.name} are removed. Their old bills stay, shown as "Deleted customer".</p>
          <div className="mfoot"><button className="btn" onClick={() => setDlg(null)}>Keep</button><button className="btn danger" onClick={() => void remove()}>Delete</button></div>
        </Modal>
      )}
    </>
  )
}

function Detail({ p, canDelete, onEdit, onDelete }: { p: CustomerProfile; canDelete: boolean; onEdit: () => void; onDelete: () => void }) {
  const sizes = sizesText(p.sizes)
  return (
    <>
      <h2>{p.name}</h2>
      <div className="sub mono">{p.mobile}</div>
      <div className="tot">
        <span className="sub">Birthday</span><span>{formatMonthDay(p.birthday || null)}</span>
        <span className="sub">Anniversary</span><span>{formatMonthDay(p.anniversary || null)}</span>
        <span className="sub">Sizes</span><span>{sizes || '—'}</span>
        <span className="sub">WhatsApp bill</span><span>{p.waConsent ? 'Yes' : 'No'}</span>
        <span className="sub">Offers</span><span>{p.offersConsent ? 'Yes' : 'No'}</span>
        <span className="sub">Visits</span><span className="num">{p.visits}</span>
        <span className="sub">Spent</span><span className="num">{formatRupees(p.spent)}</span>
        <span className="sub">Coins</span><span className="num">{p.coins}</span>
        <span className="sub">Credit notes</span><span className="num">{formatRupees(p.creditNotes)}</span>
      </div>
      {p.consentAt && <div className="hint">Consent recorded {fmtDay(p.consentAt)} by {p.consentBy ?? '—'}</div>}
      {p.notes && <div className="hint">Note: {p.notes}</div>}
      {p.gstin && <div className="hint">GSTIN {p.gstin}</div>}
      <h2>Recent bills</h2>
      {p.recentBills.length
        ? p.recentBills.map((b) => <div key={b.no} className="row" style={{ justifyContent: 'space-between' }}><span className="mono">{b.no}</span><span>{fmtDay(b.at)}</span><b className="num">{formatRupees(b.grand)}</b></div>)
        : <div className="hint">No bills yet.</div>}
      <div className="row">
        <button className="btn" onClick={onEdit}>Edit</button>
        {canDelete && <button className="btn danger" onClick={onDelete}>Delete</button>}
      </div>
    </>
  )
}

/** Add / edit dialog, contact, birthday, anniversary, notes, GSTIN, consent. */
function CustomerForm({ editing, onClose, onSaved }: { editing: CustomerProfile | null; onClose: () => void; onSaved: (c: CustomerProfile) => void }) {
  const [f, setF] = useState({
    mobile: editing?.mobile ?? '', name: editing?.name ?? '',
    birthday: toDayMonth(editing?.birthday ?? null), anniversary: toDayMonth(editing?.anniversary ?? null),
    sizes: { ...NO_SIZES, ...(editing?.sizes ?? {}) } as CustomerSizes,
    notes: editing?.notes ?? '', gstin: editing?.gstin ?? '',
    waConsent: editing?.waConsent ?? false, offersConsent: editing?.offersConsent ?? false
  })
  const [busy, setBusy] = useState(false)
  const { run, msg } = useMsg()
  const text = (k: 'name' | 'birthday' | 'anniversary' | 'notes') => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  async function save() {
    setBusy(true)
    const input: CustomerSaveInput = { ...f, id: editing?.id }
    const c = await run(() => window.api.customers.save(input))
    setBusy(false)
    if (c) onSaved(c)
  }

  return (
    <Modal title={editing ? 'Edit customer' : 'Add customer'} wide onClose={onClose}>
      <div className="row">
        <div className="f"><label htmlFor="cu-m">Mobile *</label><input id="cu-m" inputMode="numeric" maxLength={10} autoFocus={!editing} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="f"><label htmlFor="cu-n">Name *</label><input id="cu-n" value={f.name} onChange={text('name')} /></div>
      </div>
      <div className="row">
        <div className="f"><label htmlFor="cu-b">Birthday (DD-MM)</label><input id="cu-b" placeholder="21-08" value={f.birthday} onChange={text('birthday')} /></div>
        <div className="f"><label htmlFor="cu-a">Anniversary (DD-MM)</label><input id="cu-a" placeholder="04-12" value={f.anniversary} onChange={text('anniversary')} /></div>
      </div>
      <div className="row">
        <div className="f"><label htmlFor="cu-no">Notes</label><input id="cu-no" value={f.notes} onChange={text('notes')} /></div>
        <div className="f"><label htmlFor="cu-g">GSTIN (business bills only)</label><input id="cu-g" maxLength={15} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></div>
      </div>
      <div className="panel" style={{ background: 'var(--sunk)', border: 0 }}>
        <b>Ask the customer and tick only if they agree</b>
        <label className="check"><input type="checkbox" checked={f.waConsent} onChange={(e) => setF({ ...f, waConsent: e.target.checked })} /> Send my bill on WhatsApp</label>
        <label className="check"><input type="checkbox" checked={f.offersConsent} onChange={(e) => setF({ ...f, offersConsent: e.target.checked })} /> Send me offers and birthday wishes</label>
        <span className="hint">Saved with today's date and your name. We use the number only for this shop's bills and offers.</span>
      </div>
      <div className="err" role="alert">{msg && !msg.ok ? msg.text : ''}</div>
      <div className="mfoot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy} onClick={() => void save()}>Save customer</button></div>
    </Modal>
  )
}
