import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TourStep } from '@shared/tour'

const PAD = 6
const CARD_W = 340

interface Box { top: number; left: number; width: number; height: number }

/**
 * Guided tour: dims the screen, cuts a spotlight around the element named by the step's `target`
 * (an element with data-tour="…") and shows a card beside it. Keys: Right / Enter = next, Left = back, Esc = skip.
 */
export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const next = useRef<HTMLButtonElement>(null)
  const step = steps[i]!
  const last = i === steps.length - 1

  const measure = useCallback(() => {
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null
    if (!el) return setBox(null)
    const r = el.getBoundingClientRect()
    setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
  }, [step.target])

  useLayoutEffect(() => { measure() }, [measure])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])
  useEffect(() => { next.current?.focus() }, [i])

  const go = useCallback((d: number) => {
    const n = i + d
    if (n < 0) return
    if (n >= steps.length) return onClose()
    setI(n)
  }, [i, steps.length, onClose])

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [go, onClose])

  // card beside the highlighted element: to its right when there is room (left menu), else below it; centred when there is no target
  const vw = window.innerWidth
  const vh = window.innerHeight
  let style: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  if (box) {
    const right = box.left + box.width + 14
    if (right + CARD_W < vw) style = { top: Math.max(12, Math.min(box.top, vh - 260)), left: right }
    else style = { top: Math.min(box.top + box.height + 14, vh - 260), left: Math.max(12, Math.min(box.left + box.width - CARD_W, vw - CARD_W - 12)) }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      {box ? <div className="tour-spot" style={box} /> : <div className="tour-dim" />}
      <div className="tour-card" style={{ ...style, width: CARD_W }}>
        <div className="tour-count">Step {i + 1} of {steps.length}</div>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-dots" aria-hidden="true">{steps.map((s, k) => <i key={s.id} className={k === i ? 'on' : ''} />)}</div>
        <div className="tour-foot">
          {!last ? <button className="btn" onClick={onClose}>Skip tour</button> : <span />}
          <span style={{ display: 'flex', gap: 8 }}>
            {i > 0 && <button className="btn" onClick={() => go(-1)}>Back</button>}
            <button className="btn p" ref={next} onClick={() => go(1)}>{last ? 'Finish' : i === 0 ? 'Start tour' : 'Next'}</button>
          </span>
        </div>
      </div>
    </div>
  )
}
