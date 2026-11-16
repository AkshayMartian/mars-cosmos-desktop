import { useState } from 'react'
import type { ImportPreview } from '@shared/catalogue'
import { Modal, useMsg } from '../ui'

export function ImportModal({ onClose, onDone, onStickers }: { onClose: () => void; onDone: (text: string) => void; onStickers: (variantIds: string[]) => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ text: string; ids: string[] } | null>(null)
  const { run, node } = useMsg()

  async function choose() {
    const p = await run(() => window.api.import.choose())
    if (p) setPreview(p)
  }

  async function doImport() {
    if (!preview) return
    setBusy(true)
    const r = await run(() => window.api.import.commit(preview.token))
    setBusy(false)
    if (r) setDone({ text: `Imported ${r.items} items (${r.products} products), ${r.pieces} pieces`, ids: r.variantIds })
  }

  if (done) {
    return (
      <Modal title="Import finished" onClose={() => onDone(done.text)}>
        <p style={{ margin: 0 }}>{done.text}.</p>
        <div className="mfoot">
          <button className="btn" onClick={() => onDone(done.text)}>Close</button>
          <button className="btn p" onClick={() => onStickers(done.ids)}>Print stickers</button>
        </div>
      </Modal>
    )
  }

  const skipped = preview ? preview.rows.length - preview.goodRows : 0

  return (
    <Modal title="Import opening stock" wide onClose={onClose}>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        <li>Download the Excel template.</li>
        <li>Fill one row per size and colour.</li>
        <li>Choose the file. Rows with mistakes are shown and skipped.</li>
      </ol>
      {node}
      <div className="row">
        <button className="btn" onClick={() => void run(() => window.api.import.template(), 'Template saved')}>Download template</button>
        <button className="btn" onClick={() => void choose()}>Choose file</button>
      </div>
      {preview && (
        <>
          <div className="hint">{preview.fileName} · {preview.rows.length} rows · {preview.goodRows} good{skipped ? ` · ${skipped} will be skipped` : ''}</div>
          <div className="tw" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Row</th><th>Product</th><th>Size</th><th>Colour</th><th className="r">Qty</th><th>Status</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td><td>{r.product}</td><td>{r.size}</td><td>{r.colour}</td><td className="r num">{r.qty}</td>
                    <td>{r.error ? <span className="chip bad">{r.error}</span> : <span className="chip good">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="mfoot">
        <button className="btn" onClick={onClose}>{preview ? 'Cancel' : 'Close'}</button>
        {preview && <button className="btn p" disabled={busy || !preview.goodRows} onClick={() => void doImport()}>Import {preview.goodRows} good row{preview.goodRows === 1 ? '' : 's'}</button>}
      </div>
    </Modal>
  )
}
