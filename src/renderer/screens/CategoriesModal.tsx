import { useEffect, useState } from 'react'
import type { CategoryDto } from '@shared/catalogue'
import { Modal, useMsg } from '../ui'

const gstText = (c: CategoryDto): string =>
  c.mode === 'auto' ? 'Clothing auto (5% / 18%)' : c.mode === 'fixed' ? `${c.rate}% fixed` : 'Exempt'

export function CategoriesModal({ onClose }: { onClose: () => void }) {
  const [cats, setCats] = useState<CategoryDto[]>([])
  const [name, setName] = useState('')
  const [hsn, setHsn] = useState('')
  const [gst, setGst] = useState('auto')
  const { run, node } = useMsg()

  const load = () => run(() => window.api.catalogue.categories()).then((c) => c && setCats(c))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    const c = await run(() => window.api.catalogue.addCategory({ name, hsn, gst: gst === 'auto' ? 'auto' : (Number(gst) as 5 | 12 | 18) }), 'Category added')
    if (c) { setName(''); setHsn(''); setGst('auto'); await load() }
  }

  return (
    <Modal title="Categories" onClose={onClose}>
      {node}
      <div className="tw">
        <table>
          <thead><tr><th>Name</th><th>HSN</th><th>GST</th></tr></thead>
          <tbody>{cats.map((c) => <tr key={c.id}><td>{c.name}</td><td className="mono">{c.hsn}</td><td>{gstText(c)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="row">
        <div className="f"><label htmlFor="ct-n">New category</label><input id="ct-n" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} /></div>
        <div className="f"><label htmlFor="ct-h">HSN</label><input id="ct-h" value={hsn} onChange={(e) => setHsn(e.target.value)} /></div>
        <div className="f"><label htmlFor="ct-g">GST</label>
          <select id="ct-g" value={gst} onChange={(e) => setGst(e.target.value)}>
            <option value="auto">Clothing auto</option><option value="5">5% fixed</option><option value="12">12% fixed</option><option value="18">18% fixed</option>
          </select>
        </div>
        <button className="btn" onClick={() => void add()}>Add</button>
      </div>
      <div className="hint">Ask your CA to confirm the HSN code and GST rate before you start selling.</div>
      <div className="mfoot"><button className="btn p" onClick={onClose}>Done</button></div>
    </Modal>
  )
}
