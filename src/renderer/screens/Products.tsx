import { useEffect, useState } from 'react'
import { formatRupees } from '@shared/money'
import type { CategoryDto, ProductListRow } from '@shared/catalogue'
import type { StaffPublic } from '@shared/types'
import { useMsg } from '../ui'
import { CategoriesModal } from './CategoriesModal'
import { ImportModal } from './ImportModal'
import { EditProduct, NewProduct } from './ProductForm'

type Mode = { k: 'list' } | { k: 'new' } | { k: 'edit'; id: string }

export function Products({ user, intent, onStickers }: { user: StaffPublic; intent?: string; onStickers: (variantIds: string[]) => void }) {
  const canEdit = user.role === 'owner' || user.role === 'manager'
  // intent 'new' = sent here by "+ New product" on Stock in: open the Add product form straight away
  const [mode, setMode] = useState<Mode>(intent === 'new' && canEdit ? { k: 'new' } : { k: 'list' })
  const [notice, setNotice] = useState<string | null>(null) // shown on the list after Save / Archive
  // `stickers` = the items to print labels for: leave this screen for Print stickers with them in the list
  const back = (text?: string, stickers?: string[]) => {
    if (stickers?.length) return onStickers(stickers)
    setNotice(text ?? null); setMode({ k: 'list' })
  }

  if (mode.k === 'new') return <NewProduct onDone={back} />
  if (mode.k === 'edit') return <EditProduct id={mode.id} canEdit={canEdit} onDone={back} />
  return <ProductList canEdit={canEdit} notice={notice} onNew={() => setMode({ k: 'new' })} onOpen={(id) => setMode({ k: 'edit', id })} onStickers={onStickers} />
}

function ProductList({ canEdit, notice, onNew, onOpen, onStickers }: { canEdit: boolean; notice: string | null; onNew: () => void; onOpen: (id: string) => void; onStickers: (variantIds: string[]) => void }) {
  const [rows, setRows] = useState<ProductListRow[]>([])
  const [cats, setCats] = useState<CategoryDto[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [archived, setArchived] = useState(false)
  const [dlg, setDlg] = useState<'cats' | 'import' | null>(null)
  const [tick, setTick] = useState(0) // bump to reload after a dialog changed data
  const { run, setMsg, node } = useMsg()

  useEffect(() => { void run(() => window.api.catalogue.categories()).then((c) => c && setCats(c)) }, [run, tick])
  useEffect(() => { void run(() => window.api.catalogue.products(q, cat, archived)).then((r) => r && setRows(r)) }, [q, cat, archived, run, tick])

  return (
    <>
      <div className="head">
        <h1>Products</h1>
        {canEdit && (
          <div className="row">
            <button className="btn" onClick={() => setDlg('cats')}>Categories</button>
            <button className="btn" onClick={() => setDlg('import')}>Import from Excel</button>
            <button className="btn p" onClick={onNew}>+ Add product</button>
          </div>
        )}
      </div>
      {notice && <div className="banner good" role="status">{notice}</div>}
      {node}
      {dlg === 'cats' && <CategoriesModal onClose={() => { setDlg(null); setTick((t) => t + 1) }} />}
      {dlg === 'import' && <ImportModal onClose={() => setDlg(null)} onStickers={onStickers} onDone={(text) => { setDlg(null); setTick((t) => t + 1); setMsg({ ok: true, text }) }} />}
      <div className="panel">
        <div className="row">
          <div className="f"><label htmlFor="pq">Search name, brand or barcode</label><input id="pq" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="f" style={{ maxWidth: 200 }}>
            <label htmlFor="pc">Category</label>
            <select id="pc" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {canEdit && <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>}
        </div>
        {archived && <div className="banner">Showing archived products only. They are hidden from billing and stock. Open one to restore it.</div>}
        {rows.length ? (
          <div className="tw">
            <table>
              <thead><tr><th>Product</th><th>Category</th><th>Sizes</th><th>Colours</th><th className="r">Stock</th><th className="r">MRP</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={canEdit ? 'click' : ''} onClick={canEdit ? () => onOpen(p.id) : undefined}>
                    <td><b>{p.name}</b><div className="sub">{p.brand}</div></td>
                    <td>{p.categoryName}</td><td>{p.sizes.join(', ')}</td><td>{p.colours.join(', ')}</td>
                    <td className="r num">{p.stock}</td><td className="r num">{formatRupees(p.mrp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">{archived ? 'No archived products.' : q || cat ? 'No products match.' : canEdit ? 'No products yet. Click "Add product" to start.' : 'No products yet. Ask the owner or manager to add them.'}</div>
        )}
      </div>
    </>
  )
}
