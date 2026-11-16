import { useCallback, useEffect, useRef, useState } from 'react'
import { gstRate } from '@shared/calc'
import { toPaise } from '@shared/money'
import type { CategoryDto, ProductDetail, ProductPhotoDto } from '@shared/catalogue'
import { Modal, num, pickPhoto, useMsg } from '../ui'


/** One colour's photo: shown in its row on the right-hand panel. */
interface ColourPhoto { colour: string; dataUrl: string | null; fileName: string | null }

/**
 * Right-hand panel: one photo row per colour (rows come from the Colours field), then the action buttons.
 * Each row: thumbnail, colour, file name, Add photo (Change once there is one) and ✕ to remove. All sizes of a colour share its photo.
 */
function PhotosPanel({ rows, editable, onAdd, onRemove, children }: {
  rows: ColourPhoto[]; editable: boolean; onAdd: (colour: string) => void; onRemove: (colour: string) => void; children?: React.ReactNode
}) {
  return (
    <div className="panel">
      <h2>Photos</h2>
      {rows.length ? (
        <div className="photo-rows">
          {rows.map((r) => (
            <div className="photo-row" key={r.colour}>
              <div className="thumb">{r.dataUrl ? <img src={r.dataUrl} alt={`${r.colour} photo`} /> : null}</div>
              <div className="photo-name">
                <b>{r.colour}</b>
                <div className="sub" title={r.fileName ?? undefined}>{r.fileName ?? 'No photo'}</div>
              </div>
              {editable && (
                <>
                  <button className="btn sm" onClick={() => onAdd(r.colour)}>{r.dataUrl ? 'Change' : 'Add photo'}</button>
                  {r.dataUrl && <button className="btn sm" aria-label={`Remove ${r.colour} photo`} onClick={() => onRemove(r.colour)}>✕</button>}
                </>
              )}
            </div>
          ))}
        </div>
      ) : <div className="hint">Type the colours to add a photo for each.</div>}
      <div className="hint">Optional. One photo per colour, shared by all its sizes. Kept on this PC, resized to 1,200 px.</div>
      {children && <div className="row" style={{ marginTop: 8 }}>{children}</div>}
    </div>
  )
}

const split = (s: string): string[] => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))]

export function NewProduct({ onDone }: { onDone: (notice?: string, stickers?: string[]) => void }) {
  const [cats, setCats] = useState<CategoryDto[]>([])
  const [f, setF] = useState({ name: '', brand: '', categoryId: '', mrp: '', sale: '', cost: '', sizes: 'S, M, L, XL', colours: 'Blue' })
  const [grid, setGrid] = useState<Record<string, string>>({})
  const [photos, setPhotos] = useState<Record<string, { file: string; dataUrl: string; name: string }>>({}) // by colour
  const [busy, setBusy] = useState(false)
  const { run, node } = useMsg()

  useEffect(() => {
    void run(() => window.api.catalogue.categories()).then((c) => { if (c) { setCats(c); setF((x) => ({ ...x, categoryId: x.categoryId || c[0]?.id || '' })) } })
  }, [run])

  const sizes = split(f.sizes)
  const colours = split(f.colours)
  // A photo belongs to a colour: if the colour is removed from the Colours field its photo row goes with it.
  const photoRows: ColourPhoto[] = colours.map((c) => ({ colour: c, dataUrl: photos[c]?.dataUrl ?? null, fileName: photos[c]?.name ?? null }))
  const cat = cats.find((c) => c.id === f.categoryId)
  const gst = cat ? gstRate('regular', cat, toPaise(f.sale || f.mrp)) : 0
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  async function save(printStickers: boolean) {
    setBusy(true)
    const opening: Record<string, number> = {}
    for (const [k, v] of Object.entries(grid)) if (num(v) > 0) opening[k] = Math.floor(num(v))
    const r = await run(() => window.api.catalogue.create({
      name: f.name, brand: f.brand, categoryId: f.categoryId, mrp: toPaise(f.mrp), salePrice: toPaise(f.sale || f.mrp),
      cost: toPaise(f.cost), sizes, colours, opening,
      photos: Object.fromEntries(colours.filter((c) => photos[c]).map((c) => [c, photos[c]!.file]))
    }))
    setBusy(false)
    if (r) onDone(`Saved ${r.variantIds.length} items.`, printStickers ? r.variantIds : undefined)
  }

  return (
    <>
      <div className="head">
        <div><h1>Add product</h1><div className="sub">Each size × colour becomes its own item with its own barcode.</div></div>
        <button className="btn" onClick={() => onDone()}>Back to products</button>
      </div>
      {node}
      <div className="cols">
        <div className="panel">
          <div className="row">
            <div className="f"><label htmlFor="e-name">Product name</label><input id="e-name" autoFocus value={f.name} onChange={set('name')} /></div>
            <div className="f"><label htmlFor="e-brand">Brand</label><input id="e-brand" value={f.brand} onChange={set('brand')} /></div>
          </div>
          <div className="row">
            <div className="f">
              <label htmlFor="e-cat">Category</label>
              <select id="e-cat" value={f.categoryId} onChange={set('categoryId')}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name} (HSN {c.hsn})</option>)}
              </select>
            </div>
            <div className="f"><label>GST</label>
              <div className="chip muted" style={{ marginTop: 6 }}>{cat ? (cat.mode === 'auto' ? `Auto: ${gst}% at this price` : `Fixed ${cat.rate}%`) : '—'}</div>
            </div>
          </div>
          <div className="row">
            <div className="f"><label htmlFor="e-mrp">MRP ₹</label><input id="e-mrp" type="number" min="0" value={f.mrp} onChange={set('mrp')} /></div>
            <div className="f"><label htmlFor="e-sale">Sale price ₹</label><input id="e-sale" type="number" min="0" value={f.sale} onChange={set('sale')} /></div>
            <div className="f"><label htmlFor="e-cost">Cost ₹</label><input id="e-cost" type="number" min="0" value={f.cost} onChange={set('cost')} /></div>
          </div>
          <div className="row">
            <div className="f"><label htmlFor="e-sizes">Sizes (comma separated)</label><input id="e-sizes" value={f.sizes} onChange={set('sizes')} /></div>
            <div className="f"><label htmlFor="e-cols">Colours (comma separated)</label><input id="e-cols" value={f.colours} onChange={set('colours')} /></div>
          </div>
          <h2>Opening stock</h2>
          {sizes.length && colours.length ? (
            <>
              <div className="tw">
                <table className="grid-inp">
                  <thead><tr><th>Colour</th>{sizes.map((s) => <th key={s}>{s}</th>)}</tr></thead>
                  <tbody>
                    {colours.map((c) => (
                      <tr key={c}>
                        <td><b>{c}</b></td>
                        {sizes.map((s) => (
                          <td key={s}><input type="number" min="0" aria-label={`${c} ${s}`} value={grid[`${c}|${s}`] ?? ''} onChange={(e) => setGrid({ ...grid, [`${c}|${s}`]: e.target.value })} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="hint">{sizes.length * colours.length} items will be created.</div>
            </>
          ) : <div className="hint">Enter sizes and colours to see the grid.</div>}
        </div>
        <PhotosPanel rows={photoRows} editable
          onAdd={(colour) => void run(() => pickPhoto()).then((p) => p && setPhotos((x) => ({ ...x, [colour]: p })))}
          onRemove={(colour) => setPhotos((x) => { const { [colour]: _gone, ...rest } = x; return rest })}>
          <button className="btn" disabled={busy} onClick={() => void save(false)}>Save</button>
          <button className="btn p" disabled={busy} onClick={() => void save(true)}>Save & print stickers</button>
        </PhotosPanel>
      </div>
    </>
  )
}

export function EditProduct({ id, canEdit, onDone }: { id: string; canEdit: boolean; onDone: (notice?: string, stickers?: string[]) => void }) {
  const [p, setP] = useState<ProductDetail | null>(null)
  const [cats, setCats] = useState<CategoryDto[]>([])
  const [head, setHead] = useState({ name: '', brand: '', categoryId: '' })
  const [prices, setPrices] = useState<Record<string, { mrp: string; sale: string }>>({})
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [photoByColour, setPhotoByColour] = useState<Record<string, ProductPhotoDto>>({})
  const [confirmArchive, setConfirmArchive] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const { run, attempt, setMsg, node } = useMsg()

  const load = useCallback(async () => {
    // Reload quietly: this must never clear a "Saved" message that the caller has just shown.
    let d: ProductDetail
    try { d = await window.api.catalogue.product(id) } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); return }
    setP(d)
    setHead({ name: d.name, brand: d.brand, categoryId: d.categoryId })
    setPrices(Object.fromEntries(d.variants.map((v) => [v.id, { mrp: String(v.mrp / 100), sale: String(v.salePrice / 100) }])))
    setCodes(Object.fromEntries(d.variants.map((v) => [v.id, v.brandBarcode ?? ''])))
    const list = await window.api.catalogue.photos(id).catch(() => [] as ProductPhotoDto[])
    setPhotoByColour(Object.fromEntries(list.map((p) => [p.colour, p])))
  }, [id, setMsg])

  useEffect(() => { void load(); void run(() => window.api.catalogue.categories()).then((c) => c && setCats(c)) }, [load, run])

  if (!p) return <>{node}</>

  // Colours of this product, in order, each with its photo if it has one. Photo changes are saved at once.
  const photoRows: ColourPhoto[] = [...new Set(p.variants.map((v) => v.colour))].map((c) => ({ colour: c, dataUrl: photoByColour[c]?.dataUrl ?? null, fileName: photoByColour[c]?.file ?? null }))

  async function addPhoto(colour: string) {
    const c = await run(() => pickPhoto())
    if (!c) return
    if (await attempt(() => window.api.catalogue.setColourPhoto(id, colour, c.file))) { setMsg({ ok: true, text: `${colour} photo saved.` }); await load() }
  }

  async function removePhoto(colour: string) {
    if (await attempt(() => window.api.catalogue.removePhoto(id, colour))) { setMsg({ ok: true, text: `${colour} photo removed.` }); await load() }
  }

  async function archive() {
    const done = await attempt(() => window.api.catalogue.archive(id))
    setConfirmArchive(false) // close the dialog whether it worked or not; a failure shows its message on the screen
    if (done) onDone('Product archived. Find it under Products → Show archived.')
  }

  async function restore() {
    if (await attempt(() => window.api.catalogue.restore(id))) onDone('Product restored. It is back in the product list.')
  }

  async function saveChanges() {
    if (!p) return
    const ok = await run(async () => {
      await window.api.catalogue.update(id, head)
      for (const v of p.variants) {
        const pr = prices[v.id]
        if (pr && (toPaise(pr.mrp) !== v.mrp || toPaise(pr.sale) !== v.salePrice)) await window.api.catalogue.prices(v.id, toPaise(pr.mrp), toPaise(pr.sale))
      }
      return true
    }, 'Saved')
    if (ok) await load()
    topRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) // the message is at the top; the buttons are at the bottom
  }

  return (
    <>
      <div className="head">
        <div><h1>Edit product</h1><div className="sub">{p.name}</div></div>
        <button className="btn" onClick={() => onDone()}>Back to products</button>
      </div>
      <div ref={topRef}>{node}</div>
      {!p.active && <div className="banner">This product is archived: it is hidden from the product list, billing and stock. Click Restore to bring it back.</div>}
      {confirmArchive && (
        <Modal title="Archive this product?" onClose={() => setConfirmArchive(false)}>
          <p style={{ margin: 0 }}>{p.name} will disappear from the product list, billing and stock. Its stock and old bills are kept, and you can restore it later from Products → Show archived.</p>
          <div className="mfoot">
            <button className="btn" onClick={() => setConfirmArchive(false)}>Keep</button>
            <button className="btn danger" onClick={() => void archive()}>Archive</button>
          </div>
        </Modal>
      )}
      <div className="cols">
        <div className="panel">
          <div className="row">
            <div className="f"><label htmlFor="h-name">Product name</label><input id="h-name" disabled={!canEdit} value={head.name} onChange={(e) => setHead({ ...head, name: e.target.value })} /></div>
            <div className="f"><label htmlFor="h-brand">Brand</label><input id="h-brand" disabled={!canEdit} value={head.brand} onChange={(e) => setHead({ ...head, brand: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="f"><label htmlFor="h-cat">Category</label>
              <select id="h-cat" disabled={!canEdit} value={head.categoryId} onChange={(e) => setHead({ ...head, categoryId: e.target.value })}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name} (HSN {c.hsn})</option>)}
              </select>
            </div>
          </div>
          <div className="tw">
            <table>
              <thead><tr><th>Colour</th><th>Size</th><th>Barcode</th><th>Brand barcode</th><th className="r">Stock</th><th>MRP ₹</th><th>Sale ₹</th></tr></thead>
              <tbody>
                {p.variants.map((v) => (
                  <tr key={v.id}>
                    <td>{v.colour}</td><td>{v.size}</td><td className="mono">{v.barcode}</td>
                    <td>
                      <input style={{ width: 150 }} aria-label="Brand barcode" disabled={!canEdit} value={codes[v.id] ?? ''} onChange={(e) => setCodes({ ...codes, [v.id]: e.target.value })}
                        onBlur={() => (codes[v.id] ?? '') !== (v.brandBarcode ?? '') && void run(() => window.api.catalogue.brandBarcode(v.id, codes[v.id] ?? ''), 'Brand barcode saved').then(load)} />
                    </td>
                    <td className="r num">{v.stock}</td>
                    <td><input type="number" style={{ width: 110 }} aria-label="MRP" disabled={!canEdit} value={prices[v.id]?.mrp ?? ''} onChange={(e) => setPrices({ ...prices, [v.id]: { ...prices[v.id]!, mrp: e.target.value } })} /></td>
                    <td><input type="number" style={{ width: 110 }} aria-label="Sale price" disabled={!canEdit} value={prices[v.id]?.sale ?? ''} onChange={(e) => setPrices({ ...prices, [v.id]: { ...prices[v.id]!, sale: e.target.value } })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {canEdit ? (
          <PhotosPanel rows={photoRows} editable onAdd={(c) => void addPhoto(c)} onRemove={(c) => void removePhoto(c)}>
            <button className="btn p" onClick={() => void saveChanges()}>Save changes</button>
            <button className="btn" onClick={() => onDone(undefined, p.variants.map((v) => v.id))}>Print stickers</button>
            {p.active
              ? <button className="btn danger" onClick={() => setConfirmArchive(true)}>Archive</button>
              : <button className="btn p" onClick={() => void restore()}>Restore</button>}
          </PhotosPanel>
        ) : (
          <PhotosPanel rows={photoRows} editable={false} onAdd={() => undefined} onRemove={() => undefined} />
        )}
      </div>
    </>
  )
}

