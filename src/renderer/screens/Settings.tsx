import { useCallback, useEffect, useState } from 'react'
import { formatRupees, toPaise } from '@shared/money'
import type { AltContext, TailorDto } from '@shared/alterations'
import { GST_SCHEMES, ROLE_NAMES, type AllSettings, type BackupInfo, type StaffAdminRow } from '@shared/settings'
import { LABEL_SIZES } from '@shared/stickers'
import type { GstScheme, Role } from '@shared/types'
import { cleanMobile } from '@shared/mobile'
import { MobileHint, Modal, fmtDate, num, useMsg } from '../ui'

const TABS = [['shop', 'Shop'], ['gst', 'GST'], ['receipt', 'Receipt'], ['printers', 'Printers'], ['coins', 'Coins'], ['staff', 'Staff'], ['alter', 'Alterations'], ['backup', 'Backup']] as const
type Tab = (typeof TABS)[number][0]

const changed = (): void => { window.dispatchEvent(new Event('mars:settings-saved')) }

export function Settings() {
  const [tab, setTab] = useState<Tab>('shop')
  const [all, setAll] = useState<AllSettings | null>(null)
  const { run, node } = useMsg()
  useEffect(() => { void run(() => window.api.settings.get()).then((a) => a && setAll(a)) }, [run])
  return (
    <>
      <div className="head"><h1>Settings</h1></div>
      {node}
      <div className="panel">
        <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
        {!all ? <div className="empty">Loading…</div>
          : tab === 'shop' ? <ShopTab all={all} onSaved={(shop) => { setAll({ ...all, shop }); changed() }} />
          : tab === 'gst' ? <GstTab value={all.gst} onSaved={(gst) => setAll({ ...all, gst })} />
          : tab === 'receipt' ? <ReceiptTab all={all} onSaved={(receipt) => setAll({ ...all, receipt })} />
          : tab === 'printers' ? <PrintersTab all={all} onSaved={(printers) => setAll({ ...all, printers })} />
          : tab === 'coins' ? <CoinsTab all={all} onSaved={(coins) => setAll({ ...all, coins })} />
          : tab === 'staff' ? <StaffTab />
          : tab === 'alter' ? <AlterTab />
          : <BackupTab />}
      </div>
    </>
  )
}

/* ---------- shop ---------- */

export function ShopTab({ all, onSaved }: { all: AllSettings; onSaved: (s: AllSettings['shop']) => void }) {
  const [f, setF] = useState(all.shop)
  const { run, node } = useMsg()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <>
      {node}
      <div className="row"><div className="f"><label htmlFor="s-n">Shop name *</label><input id="s-n" value={f.name} onChange={set('name')} /></div><div className="f"><label htmlFor="s-p">Phone</label><input id="s-p" value={f.phone} onChange={set('phone')} /></div></div>
      <div className="f"><label htmlFor="s-a">Address</label><input id="s-a" value={f.address} onChange={set('address')} /></div>
      <div className="row"><div className="f"><label htmlFor="s-g">GSTIN</label><input id="s-g" value={f.gstin} onChange={set('gstin')} /></div><div className="f"><label htmlFor="s-s">State</label><input id="s-s" value={f.state} onChange={set('state')} /></div></div>
      <div><button className="btn p" onClick={() => void run(() => window.api.settings.saveShop(f), 'Shop details saved.').then((s) => s && onSaved(s))}>Save</button></div>
    </>
  )
}

/* ---------- GST ---------- */

export function GstTab({ value, onSaved }: { value: GstScheme; onSaved: (g: GstScheme) => void }) {
  const { run, node } = useMsg()
  return (
    <>
      {node}
      {GST_SCHEMES.map((g) => (
        <label key={g.id} className="radio-card"><input type="radio" name="gst" checked={value === g.id} onChange={() => void run(() => window.api.settings.saveGst(g.id), 'GST type saved. New bills use it.').then((v) => v && onSaved(v))} />
          <span><b>{g.name}</b><br /><span className="sub">{g.text}</span></span></label>
      ))}
      <div className="hint">Clothing: 5% up to ₹2,500 per piece, 18% above. Belts, watches, goggles, wallets: fixed rate from the category. Old bills keep the GST they were made with.</div>
    </>
  )
}

/* ---------- receipt ---------- */

function ReceiptTab({ all, onSaved }: { all: AllSettings; onSaved: (r: AllSettings['receipt']) => void }) {
  const r = all.receipt
  const [f, setF] = useState({ footer: r.footer, policy: r.policy, review: r.review, returnDays: String(r.returnDays), creditNoteDays: String(r.creditNoteDays), width: r.width })
  const { run, node } = useMsg()
  const save = () => run(() => window.api.settings.saveReceipt({ ...f, returnDays: num(f.returnDays), creditNoteDays: num(f.creditNoteDays) }), 'Receipt settings saved.').then((v) => v && onSaved(v))
  return (
    <>
      {node}
      <div className="f"><label htmlFor="r-f">Footer line</label><input id="r-f" value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} /></div>
      <div className="f"><label htmlFor="r-p">Return policy text</label><input id="r-p" value={f.policy} onChange={(e) => setF({ ...f, policy: e.target.value })} /></div>
      <div className="f"><label htmlFor="r-l">Google review link (printed on the receipt)</label><input id="r-l" value={f.review} onChange={(e) => setF({ ...f, review: e.target.value })} /></div>
      <div className="row">
        <div className="f"><label htmlFor="r-d">Return window (days)</label><input id="r-d" type="number" min="0" value={f.returnDays} onChange={(e) => setF({ ...f, returnDays: e.target.value })} /></div>
        <div className="f"><label htmlFor="r-c">Credit note valid (days)</label><input id="r-c" type="number" min="1" value={f.creditNoteDays} onChange={(e) => setF({ ...f, creditNoteDays: e.target.value })} /></div>
        <div className="f"><label htmlFor="r-w">Paper</label><select id="r-w" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value as '80 mm' | '58 mm' })}><option>80 mm</option><option>58 mm</option></select></div>
      </div>
      <div className="hint">The return window and credit note days apply to new returns at once. The review QR and paper width are used when receipt printing is built.</div>
      <div><button className="btn p" onClick={() => void save()}>Save</button></div>
    </>
  )
}

/* ---------- printers ---------- */

/** Windows "printers" that only save a file or open a program: a receipt sent there never comes out of a roll printer. */
const NOT_REAL = /onenote|pdf|xps|fax|virtual|anydesk|teamviewer/i

export function PrintersTab({ all, onSaved }: { all: AllSettings; onSaved: (p: AllSettings['printers']) => void }) {
  const [receipt, setReceipt] = useState(all.printers.receipt)
  const [drawer, setDrawer] = useState(all.printers.drawer)
  const [sticker, setSticker] = useState('')
  const [size, setSize] = useState('50x25')
  const [names, setNames] = useState<string[]>([])
  const { run, node } = useMsg()
  useEffect(() => {
    void window.api.stickers.printers().then(setNames, () => undefined)
    void window.api.stickers.context().then((c) => { setSticker(c.printer); setSize(c.sizeId) }, () => undefined)
  }, [])
  const withCurrent = (cur: string) => (cur && !names.includes(cur) ? [cur, ...names] : names)
  async function save() {
    const p = await run(() => window.api.settings.savePrinters({ receipt, drawer }))
    if (!p) return
    const c = await run(() => window.api.stickers.savePrefs({ size, printer: sticker }), 'Printer settings saved.')
    if (c) onSaved(p)
  }
  async function saveThen(fn: () => Promise<void>, ok: string) {
    const p = await run(() => window.api.settings.savePrinters({ receipt, drawer }))
    if (!p) return
    const c = await run(() => window.api.stickers.savePrefs({ size, printer: sticker }))
    if (!c) return
    onSaved(p)
    await run(fn, ok)
  }
  return (
    <>
      {node}
      <div className="row">
        <div className="f" style={{ flex: 1 }}><label htmlFor="pr-r">Receipt printer</label>
          <select id="pr-r" value={receipt} onChange={(e) => setReceipt(e.target.value)}><option value="">Not chosen</option>{withCurrent(receipt).map((n) => <option key={n} value={n}>{n}{NOT_REAL.test(n) ? ' (not a real printer)' : ''}</option>)}</select></div>
        <button className="btn" onClick={() => void saveThen(() => window.api.print.testReceipt(), 'Test receipt sent.')}>Test receipt</button>
      </div>
      {receipt && NOT_REAL.test(receipt) && <div className="banner">"{receipt}" is not a real printer: it saves a file or opens another program, so nothing prints on your receipt roll. Choose your receipt printer{names.find((n) => !NOT_REAL.test(n) && /80|58|pos|thermal|receipt|tvs|epson/i.test(n)) ? <> (for example <b>{names.find((n) => !NOT_REAL.test(n) && /80|58|pos|thermal|receipt|tvs|epson/i.test(n))}</b>)</> : null}.</div>}
      <div className="row">
        <div className="f" style={{ flex: 1 }}><label htmlFor="pr-s">Sticker printer</label>
          <select id="pr-s" value={sticker} onChange={(e) => setSticker(e.target.value)}><option value="">Ask me every time (print dialog)</option>{withCurrent(sticker).map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        <div className="f" style={{ flex: 1 }}><label htmlFor="pr-z">Sticker size</label>
          <select id="pr-z" value={size} onChange={(e) => setSize(e.target.value)}>{LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        <button className="btn" onClick={() => void saveThen(() => window.api.print.testSticker(), 'Test sticker sent.')}>Test sticker</button>
      </div>
      <label className="check"><input type="checkbox" checked={drawer} onChange={(e) => setDrawer(e.target.checked)} /> Open cash drawer on cash payment</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn p" onClick={() => void save()}>Save</button>
        <button className="btn" onClick={() => void saveThen(() => window.api.print.openDrawer(), 'Drawer signal sent.')}>Open drawer now</button>
      </div>
      <div className="hint">The lists show the printers installed in Windows. The test buttons save your choice first. The drawer opens through the receipt printer: set that printer's Windows driver to open the drawer when a job prints.</div>
    </>
  )
}

/* ---------- coins ---------- */

function CoinsTab({ all, onSaved }: { all: AllSettings; onSaved: (c: AllSettings['coins']) => void }) {
  const c = all.coins
  const [f, setF] = useState({ on: c.on, per: String(c.per), value: String(c.value), expiryMonths: String(c.expiryMonths), maxPct: String(c.maxPct) })
  const { run, node } = useMsg()
  const save = () => run(() => window.api.settings.saveCoins({ on: f.on, per: num(f.per), value: num(f.value), expiryMonths: num(f.expiryMonths), maxPct: num(f.maxPct) }), 'Coin settings saved.').then((v) => v && onSaved(v))
  return (
    <>
      {node}
      <label className="check"><input type="checkbox" checked={f.on} onChange={(e) => setF({ ...f, on: e.target.checked })} /> Coins on</label>
      <div className="row">
        <div className="f"><label htmlFor="co-p">1 coin for every ₹</label><input id="co-p" type="number" min="1" value={f.per} onChange={(e) => setF({ ...f, per: e.target.value })} /></div>
        <div className="f"><label htmlFor="co-v">1 coin is worth ₹</label><input id="co-v" type="number" min="0" step="0.5" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
        <div className="f"><label htmlFor="co-e">Expire after (months)</label><input id="co-e" type="number" min="1" value={f.expiryMonths} onChange={(e) => setF({ ...f, expiryMonths: e.target.value })} /></div>
        <div className="f"><label htmlFor="co-m">Max use per bill (%)</label><input id="co-m" type="number" min="0" max="100" value={f.maxPct} onChange={(e) => setF({ ...f, maxPct: e.target.value })} /></div>
      </div>
      <div className="hint">Customers earn coins on every bill and spend them on a later bill as a discount before GST. Ask the CA how coins show on the GST bill before turning them on at the shop.</div>
      <div><button className="btn p" onClick={() => void save()}>Save</button></div>
    </>
  )
}

/* ---------- staff ---------- */

interface StaffForm { id?: string; name: string; role: Role; maxDiscountPct: string; commissionPct: string; canCancel: boolean; canChangePrice: boolean; active: boolean; pin: string }
const blankStaff: StaffForm = { name: '', role: 'cashier', maxDiscountPct: '10', commissionPct: '1', canCancel: false, canChangePrice: false, active: true, pin: '' }

function StaffTab() {
  const [rows, setRows] = useState<StaffAdminRow[]>([])
  const [edit, setEdit] = useState<StaffForm | null>(null)
  const { run, node } = useMsg()
  useEffect(() => { void run(() => window.api.settings.staff()).then((r) => r && setRows(r)) }, [run])
  const open = (s?: StaffAdminRow) => setEdit(s
    ? { id: s.id, name: s.name, role: s.role, maxDiscountPct: String(s.maxDiscountPct), commissionPct: String(s.commissionPct), canCancel: s.canCancel, canChangePrice: s.canChangePrice, active: s.active, pin: '' }
    : blankStaff)
  return (
    <>
      {node}
      <div className="tw"><table>
        <thead><tr><th>Name</th><th>Role</th><th className="r">Max discount</th><th className="r">Commission</th><th>Change price</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.id}><td>{s.name}</td><td>{ROLE_NAMES[s.role]}</td><td className="r num">{s.maxDiscountPct}%</td><td className="r num">{s.commissionPct}%</td>
            <td>{s.canChangePrice ? 'Yes' : 'No'}</td>
            <td>{s.active ? <span className="chip good">Active</span> : <span className="chip muted">Inactive</span>}</td>
            <td><button className="btn sm" onClick={() => open(s)}>Edit</button></td></tr>
        ))}</tbody>
      </table></div>
      <div><button className="btn p" onClick={() => open()}>+ Add staff</button></div>
      <RecoveryCode />
      {edit && <StaffModal form={edit} onClose={() => setEdit(null)} onSaved={(r) => { setRows(r); setEdit(null) }} />}
    </>
  )
}

function StaffModal({ form, onClose, onSaved }: { form: StaffForm; onClose: () => void; onSaved: (r: StaffAdminRow[]) => void }) {
  const [f, setF] = useState(form)
  const [newPin, setNewPin] = useState<string | null>(null)
  const { run, node } = useMsg()
  const isOwner = f.role === 'owner'
  const save = () => run(() => window.api.settings.saveStaff({
    id: f.id, name: f.name, role: f.role, maxDiscountPct: num(f.maxDiscountPct), commissionPct: num(f.commissionPct),
    canCancel: f.canCancel, canChangePrice: f.canChangePrice, active: f.active, pin: f.pin
  })).then((r) => r && onSaved(r))
  return (
    <Modal title={f.id ? 'Edit staff' : 'Add staff'} onClose={onClose}>
      {node}
      <div className="row">
        <div className="f"><label htmlFor="st-n">Name *</label><input id="st-n" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="f"><label htmlFor="st-r">Role</label>
          <select id="st-r" disabled={isOwner} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(isOwner ? ['owner'] : ['manager', 'cashier', 'store']).map((r) => <option key={r} value={r}>{ROLE_NAMES[r as Role]}</option>)}</select></div>
      </div>
      <div className="row">
        <div className="f"><label htmlFor="st-d">Max discount %</label><input id="st-d" type="number" min="0" max="100" value={f.maxDiscountPct} onChange={(e) => setF({ ...f, maxDiscountPct: e.target.value })} /></div>
        <div className="f"><label htmlFor="st-cm">Commission %</label><input id="st-cm" type="number" min="0" max="100" step="0.5" value={f.commissionPct} onChange={(e) => setF({ ...f, commissionPct: e.target.value })} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={f.canChangePrice} onChange={(e) => setF({ ...f, canChangePrice: e.target.checked })} /> Can change price</label>
      <label className="check"><input type="checkbox" disabled={isOwner} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      {!f.id && <div className="f"><label htmlFor="st-pin">PIN (4 digits) *</label><input id="st-pin" type="password" inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
        <div className="hint">They must choose their own PIN at the first login.</div></div>}
      {f.id && newPin !== null && (
        <div className="f"><label htmlFor="st-np">New PIN (4 digits)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="st-np" type="password" inputMode="numeric" maxLength={4} autoFocus value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
            <button className="btn" onClick={() => void run(() => window.api.settings.setPin(f.id!, newPin), 'PIN changed.').then(() => setNewPin(null))}>Set PIN</button>
          </div></div>
      )}
      <div className="mfoot">
        {f.id && newPin === null && <button className="btn" onClick={() => setNewPin('')}>Change PIN</button>}
        <button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={() => void save()}>Save</button>
      </div>
    </Modal>
  )
}

/* ---------- alterations ---------- */

function AlterTab() {
  const [ctx, setCtx] = useState<AltContext | null>(null)
  const [tailors, setTailors] = useState<TailorDto[]>([])
  const [f, setF] = useState({ name: '', mobile: '', kind: 'In-house' as 'In-house' | 'Outside', rate: '60' })
  const [cfg, setCfg] = useState({ dueDays: '2', rate: '18', tagPrinter: 'sticker' as 'sticker' | 'receipt' })
  const [editT, setEditT] = useState<TailorDto | null>(null)
  const { run, node } = useMsg()
  const load = useCallback(async () => {
    const c = await run(() => window.api.alterations.context())
    if (!c) return
    setCtx(c); setTailors(c.tailors)
    setCfg({ dueDays: String(c.cfg.dueDays), rate: String(c.cfg.rate), tagPrinter: c.cfg.tagPrinter })
  }, [run])
  useEffect(() => { void load() }, [load])
  async function add() {
    const t = await run(() => window.api.alterations.saveTailor({ name: f.name, mobile: f.mobile, kind: f.kind, ratePerJob: toPaise(f.rate), active: true }), 'Tailor added.')
    if (t) { setTailors(t); setF({ ...f, name: '', mobile: '' }) }
  }
  if (!ctx) return <>{node}<div className="empty">Loading…</div></>
  return (
    <>
      {node}
      <h2>Tailors</h2>
      <div className="tw"><table>
        <thead><tr><th>Name</th><th>Mobile</th><th>Type</th><th className="r">Rate per job</th><th className="r">Open jobs</th></tr></thead>
        <tbody>{tailors.map((t) => (
          <tr key={t.id} className="click" style={{ cursor: 'pointer' }} title="Click to edit" onClick={() => setEditT(t)}><td>{t.name}{!t.active && <> <span className="chip muted">Inactive</span></>}</td><td className="mono">{t.mobile}</td><td>{t.kind}</td>
            <td className="r num">{formatRupees(t.ratePerJob)}</td><td className="r num">{t.openJobs}</td>
</tr>
        ))}</tbody>
      </table></div>
      <div className="row">
        <div className="f"><label htmlFor="tl-n">New tailor name</label><input id="tl-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="f"><label htmlFor="tl-m">Mobile</label><input id="tl-m" inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => setF({ ...f, mobile: cleanMobile(e.target.value) })} /><MobileHint value={f.mobile} /></div>
        <div className="f"><label htmlFor="tl-k">Type</label><select id="tl-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'In-house' | 'Outside' })}><option>In-house</option><option>Outside</option></select></div>
        <div className="f"><label htmlFor="tl-c">Rate per job ₹</label><input id="tl-c" type="number" min="0" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
        <button className="btn" onClick={() => void add()}>Add tailor</button>
      </div>
      <div className="hint">Click a tailor to change the details or make the tailor inactive.</div>
      {editT && <TailorModal t={editT} onClose={() => setEditT(null)} onSaved={(l) => { setTailors(l); setEditT(null) }} />}
      <h2>Rules</h2>
      <div className="row">
        <div className="f"><label htmlFor="al-d">Default ready in (days)</label><input id="al-d" type="number" min="0" value={cfg.dueDays} onChange={(e) => setCfg({ ...cfg, dueDays: e.target.value })} /></div>
        <div className="f"><label htmlFor="al-r">GST on alteration charge %</label><input id="al-r" type="number" min="0" value={cfg.rate} onChange={(e) => setCfg({ ...cfg, rate: e.target.value })} /></div>
        <div className="f"><label htmlFor="al-p">Print tailor tag on</label>
          <select id="al-p" value={cfg.tagPrinter} onChange={(e) => setCfg({ ...cfg, tagPrinter: e.target.value as 'sticker' | 'receipt' })}>
            <option value="sticker">Sticker printer (50 × 50 mm label)</option><option value="receipt">Receipt printer (slip to pin on)</option></select></div>
      </div>
      <div className="hint">Confirm the GST rate and SAC code for alteration service with the CA. Each job keeps the rate it was made with.</div>
      <div><button className="btn p" onClick={() => void run(() => window.api.alterations.saveConfig({ dueDays: num(cfg.dueDays), rate: num(cfg.rate), tagPrinter: cfg.tagPrinter }), 'Alteration rules saved.')}>Save</button></div>
    </>
  )
}

function TailorModal({ t, onClose, onSaved }: { t: TailorDto; onClose: () => void; onSaved: (l: TailorDto[]) => void }) {
  const [f, setF] = useState({ name: t.name, mobile: t.mobile, kind: t.kind, rate: String(t.ratePerJob / 100), active: t.active })
  const { run, node } = useMsg()
  return (
    <Modal title="Edit tailor" onClose={onClose}>
      {node}
      <div className="row">
        <div className="f"><label htmlFor="te-n">Name</label><input id="te-n" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="f"><label htmlFor="te-m">Mobile</label><input id="te-m" inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => setF({ ...f, mobile: cleanMobile(e.target.value) })} /><MobileHint value={f.mobile} /></div>
      </div>
      <div className="row">
        <div className="f"><label htmlFor="te-k">Type</label><select id="te-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'In-house' | 'Outside' })}><option>In-house</option><option>Outside</option></select></div>
        <div className="f"><label htmlFor="te-r">Rate per job ₹</label><input id="te-r" type="number" min="0" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (shown when choosing a tailor)</label>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" onClick={() => void run(() => window.api.alterations.saveTailor({ id: t.id, name: f.name, mobile: f.mobile, kind: f.kind, ratePerJob: toPaise(f.rate), active: f.active })).then((l) => l && onSaved(l))}>Save</button>
      </div>
    </Modal>
  )
}

/* ---------- backup ---------- */

const mb = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function BackupTab() {
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<{ file?: string; label: string } | null>(null)
  const { run, setMsg, node } = useMsg()
  const take = (i: BackupInfo) => { setInfo(i); setFolder(i.folder) }
  useEffect(() => { void run(() => window.api.settings.backups()).then((i) => i && take(i)) }, [run])
  if (!info) return <>{node}<div className="empty">Loading…</div></>
  const last = info.list[0]
  return (
    <>
      {node}
      <div className="f"><label htmlFor="bk-f">Backup folder (USB drive or second disk)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="bk-f" style={{ flex: 1 }} value={folder} onChange={(e) => setFolder(e.target.value)} />
          <button className="btn" disabled={folder === info.folder} onClick={() => void run(() => window.api.settings.saveBackupFolder(folder), 'Backup folder saved.').then((i) => i && take(i))}>Save folder</button>
        </div>
        {info.isDefault && <div className="hint">This is the default folder on this PC. A copy on a USB drive or second disk protects you if this PC fails.</div>}
      </div>
      <div className="tot"><span>Last backup</span><b>{last ? fmtDate(last.at) : 'Never'}</b><span>Copies kept</span><span>{info.copies} of {info.keep}</span></div>
      <div style={{ display: 'flex', gap: 8 }}><button className="btn p" disabled={busy} onClick={() => { setBusy(true); void run(() => window.api.settings.backupNow(), 'Backup saved.').then((i) => { setBusy(false); if (i) take(i) }) }}>{busy ? 'Backing up…' : 'Back up now'}</button><button className="btn" onClick={() => setAsk({ label: 'a backup file you choose' })}>Restore from backup file…</button></div>
      {info.list.length > 0 && (
        <div className="tw"><table>
          <thead><tr><th>Backup file</th><th>When</th><th className="r">Size</th><th /></tr></thead>
          <tbody>{info.list.map((b) => <tr key={b.file}><td className="mono">{b.file}</td><td>{fmtDate(b.at)}</td><td className="r num">{mb(b.sizeBytes)}</td><td><button className="btn sm" onClick={() => setAsk({ file: b.file, label: fmtDate(b.at) })}>Restore</button></td></tr>)}</tbody>
        </table></div>
      )}
      <div className="hint">Day end also backs up automatically. Restoring replaces everything in the app with the backup, so use it only when needed.</div>
      {ask && (
        <Modal title="Restore this backup?" onClose={() => setAsk(null)}>
          <p style={{ margin: 0 }}>The app will be replaced with <b>{ask.label}</b>. Everything entered after that backup will be gone. A safety copy of the current data is taken first. The app restarts when it is done.</p>
          <div className="mfoot">
            <button className="btn" onClick={() => setAsk(null)}>Keep current data</button>
            <button className="btn danger" onClick={() => { const a = ask; setAsk(null); void run(() => (a.file ? window.api.settings.restore(a.file) : window.api.settings.restoreFromFile())).then((r) => { if (r) setMsg({ ok: true, text: 'Restored. The app is restarting…' }) }) }}>Restore</button>
          </div>
        </Modal>
      )}
    </>
  )
}

/** The owner's way back in if the owner PIN is forgotten: a code written down once and kept somewhere safe. */
function RecoveryCode() {
  const [isSet, setIsSet] = useState<boolean | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const { run, node } = useMsg()
  useEffect(() => { void window.api.app.info().then((i) => setIsSet(i.recoveryCodeSet)) }, [])
  const make = async () => {
    const c = await run(() => window.api.settings.recoveryCode())
    if (c) { setCode(c); setIsSet(true); window.dispatchEvent(new Event('mars:settings-saved')) }
  }
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3 style={{ margin: 0 }}>Forgot-PIN recovery code</h3>
      <p className="hint">If the owner forgets their PIN, this code lets them set a new one from the login screen. It is shown once, so write it down and keep it somewhere safe (not on this computer).</p>
      {node}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {isSet === null ? null : isSet ? <span className="chip good">Code made</span> : <span className="chip warn">No code yet</span>}
        <button className="btn" onClick={() => void make()}>{isSet ? 'Make a new code' : 'Make the code'}</button>
      </div>
      {code && (
        <Modal title="Your recovery code" onClose={() => setCode(null)}>
          <div className="banner" style={{ fontSize: 26, letterSpacing: 3, textAlign: 'center', fontFamily: 'var(--mono, monospace)' }}>{code}</div>
          <p className="hint">Write this down now. It will not be shown again, and making a new code cancels this one. Using it once also uses it up.</p>
          <div className="mfoot"><button className="btn p" onClick={() => setCode(null)}>I have written it down</button></div>
        </Modal>
      )}
    </div>
  )
}
