import { useCallback, useEffect, useState, type ReactNode, type RefObject } from 'react'
import { isIndianMobile, MOBILE_MSG } from '@shared/mobile'

/** Dialog over the screen (prototype .scrim/.modal). Esc closes. */
export function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** Shared bits for screens. `useMsg` shows one success/error line; `run` wraps an IPC call and reports failures. */
/**
 * A barcode scanner is just a keyboard: it types the digits and presses Enter into whatever has focus. If the scan box
 * lost focus (a click on a button or on empty space), the scan would go nowhere. So a letter or digit typed while no
 * text field or dialog has focus is sent to the scan box instead.
 */
export function useScanFocus(ref: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.key === ' ') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return // already typing somewhere
      if (document.querySelector('[role="dialog"]')) return // a dialog owns the keyboard
      ref.current?.focus() // the character that started this key press then lands in the scan box
    }
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [ref])
}

export function useMsg() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
    try {
      const r = await fn()
      setMsg(okText ? { ok: true, text: okText } : null)
      return r
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' })
      return undefined
    }
  }, [])
  /** For calls that return nothing (archive, restore...): true = it worked, false = it failed and the message is shown. */
  const attempt = useCallback(async (fn: () => Promise<unknown>, okText?: string): Promise<boolean> => {
    const r = await run(async () => { await fn(); return true }, okText)
    return r === true
  }, [run])
  const node = msg ? (
    <div className={`banner ${msg.ok ? 'good' : 'bad'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>
  ) : null
  return { msg, setMsg, run, attempt, node }
}

const MAX_PHOTO_PX = 1200

/**
 * Opens the file picker, decodes the picture with the browser engine (JPG, PNG, WebP, BMP, GIF, AVIF; camera
 * rotation respected), shrinks it to 1,200 px and hands the JPEG to the main process. null = picker cancelled.
 */
export function pickPhoto(): Promise<{ file: string; dataUrl: string; name: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.oncancel = () => resolve(null)
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      let jpeg: Uint8Array
      try {
        const bmp = await createImageBitmap(f)
        const k = Math.min(1, MAX_PHOTO_PX / Math.max(bmp.width, bmp.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bmp.width * k))
        canvas.height = Math.max(1, Math.round(bmp.height * k))
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff' // transparent PNGs become white, not black
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
        bmp.close()
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
        if (!blob) throw new Error('encode failed')
        jpeg = new Uint8Array(await blob.arrayBuffer())
      } catch {
        return reject(new Error('That file could not be read as a photo. Choose a JPG, PNG or WebP picture.'))
      }
      window.api.catalogue.savePhoto(jpeg).then((r) => resolve({ ...r, name: f.name }), reject) // name = the file the user picked, shown on the row
    }
    input.click()
  })
}

export const num = (s: string): number => (s.trim() === '' ? 0 : Number(s))
export const fmtDay = (iso: string): string => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Red hint under a mobile field once 10 digits are typed and they are not a valid Indian mobile (6, 7, 8 or 9 first). */
export function MobileHint({ value }: { value: string }) {
  return value.length === 10 && !isIndianMobile(value) ? <div className="sub" role="alert" style={{ color: 'var(--bad)', fontWeight: 600 }}>{MOBILE_MSG}</div> : null
}
