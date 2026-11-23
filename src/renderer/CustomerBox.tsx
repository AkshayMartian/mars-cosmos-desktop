import { useEffect, useRef, useState, type RefObject } from 'react'
import { cleanMobile, isIndianMobile } from '@shared/mobile'
import { MobileHint } from './ui'

/** A customer found by the search: enough to pick them. */
export interface PickRow { id: string; name: string; mobile: string }

/**
 * ONE box for the customer: type a 10-digit mobile (the customer loads by itself as soon as it is a valid number) or a name /
 * part of a number (a list that scrolls; pick with the mouse or Up / Down / Enter). F4 focuses it.
 */
export function CustomerBox({ search, label = 'Customer mobile or name (F4)', value, inputRef, autoFocus, onChange, onFind, onPick }: {
  /** finds customers by name or part of a mobile */
  search: (q: string) => Promise<PickRow[]>
  label?: string
  value: string; inputRef?: RefObject<HTMLInputElement | null>; autoFocus?: boolean; onChange: (text: string) => void; onFind: (number: string) => void; onPick: (c: PickRow) => void
}) {
  const [rows, setRows] = useState<PickRow[]>([])
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const [failed, setFailed] = useState(false)
  const seq = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const numeric = /^[\d\s+-]*$/.test(value) // digits (a number) or letters (a name)

  useEffect(() => {
    const text = value.trim()
    if (!text) { setRows([]); setFailed(false); return }
    const mine = ++seq.current
    const t = setTimeout(() => {
      search(text)
        .then((r) => { if (mine === seq.current) { setRows(r.slice(0, 100)); setAt(0); setFailed(false) } })
        .catch(() => { if (mine === seq.current) { setRows([]); setFailed(true) } })
    }, 150)
    return () => clearTimeout(t)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { (listRef.current?.children[at] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }) }, [at])

  const pick = (c: PickRow) => { setRows([]); setOpen(false); onPick(c) }
  const change = (raw: string) => {
    const text = /^[\d\s+-]*$/.test(raw) ? cleanMobile(raw) : raw // a number is cleaned and capped at 10 digits; a name is left as typed
    onChange(text)
    setOpen(true)
    if (isIndianMobile(text)) onFind(text) // the card (with sizes) appears as soon as the number is complete
  }
  const go = () => { // Enter or Find
    if (!value.trim()) return
    if (isIndianMobile(value)) return onFind(value)
    if (open && rows[at]) return pick(rows[at]!)
    if (numeric) onFind(value) // a short number: the screen says what is wrong
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAt((i) => Math.min(rows.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go() }
    else if (e.key === 'Escape') setOpen(false)
  }
  const showList = open && value.trim() !== '' && !isIndianMobile(value)
  return (
    <div style={{ position: 'relative' }}>
      <div className="row">
        <div className="f" style={{ flex: 1 }}>
          <label htmlFor="custMobile">{label}</label>
          <input id="custMobile" ref={inputRef} autoFocus={autoFocus} autoComplete="off" placeholder="10-digit mobile, or type a name" value={value} role="combobox" aria-expanded={showList && rows.length > 0} aria-controls="custResults"
            onChange={(e) => change(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey} />
          {numeric && <MobileHint value={value} />}
        </div>
        <button className="btn" onClick={go}>Find</button>
      </div>
      {showList && (
        <div id="custResults" ref={listRef} role="listbox" aria-label="Matching customers"
          style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20, maxHeight: 220, overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 6px 18px rgba(0,0,0,.18)' }}>
          {rows.map((c, i) => (
            <div key={c.id} role="option" aria-selected={i === at} onMouseDown={(e) => { e.preventDefault(); pick(c) }} onMouseEnter={() => setAt(i)}
              style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12, background: i === at ? 'var(--sunk)' : undefined }}>
              <b>{c.name}</b><span className="sub mono">{c.mobile}</span>
            </div>
          ))}
          {!rows.length && <div className="sub" style={{ padding: '8px 12px' }}>{failed ? 'Could not search. Try again.' : 'No customer found.'}</div>}
        </div>
      )}
    </div>
  )
}
