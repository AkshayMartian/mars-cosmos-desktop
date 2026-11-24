import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { logoDataUri, logoRaster, syncLogo } from './branding'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const reply = (body: Buffer, type = 'image/png', status = 200) => (() => Promise.resolve(new Response(new Uint8Array(body), { status, headers: { 'content-type': type } }))) as unknown as typeof fetch

beforeEach(() => openDb(':memory:'))

describe('logo', () => {
  it('does nothing without an address', async () => {
    expect(await syncLogo('')).toBe('no-url')
    expect(logoDataUri()).toBeNull()
  })

  it('downloads once and keeps it as base64 in the database', async () => {
    expect(await syncLogo('https://x.test/logo.png', reply(PNG))).toBe('downloaded')
    expect(logoDataUri()).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(logoRaster()?.equals(PNG)).toBe(true)
  })

  it('does not download again while the address is the same, even offline', async () => {
    await syncLogo('https://x.test/logo.png', reply(PNG))
    const offline = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    expect(await syncLogo('https://x.test/logo.png', offline)).toBe('unchanged')
    expect(logoDataUri()).not.toBeNull()
  })

  it('downloads the new picture when an update changes the address', async () => {
    await syncLogo('https://x.test/logo-v1.png', reply(PNG))
    const jpg = Buffer.from('new-logo')
    expect(await syncLogo('https://x.test/logo-v2.jpg', reply(jpg, 'image/jpeg'))).toBe('downloaded')
    expect(logoDataUri()).toBe(`data:image/jpeg;base64,${jpg.toString('base64')}`)
  })

  it('keeps the old logo when the new download fails', async () => {
    await syncLogo('https://x.test/logo-v1.png', reply(PNG))
    const before = logoDataUri()
    expect(await syncLogo('https://x.test/logo-v2.png', (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBe('failed')
    expect(await syncLogo('https://x.test/logo-v2.png', reply(Buffer.from('<html>'), 'text/html'))).toBe('failed')
    expect(await syncLogo('http://x.test/logo-v2.png', reply(PNG))).toBe('failed')
    expect(logoDataUri()).toBe(before)
  })

  it('retries on the next start after a failed first download', async () => {
    expect(await syncLogo('https://x.test/logo.png', reply(PNG, 'image/png', 404))).toBe('failed')
    expect(logoDataUri()).toBeNull()
    expect(await syncLogo('https://x.test/logo.png', reply(PNG))).toBe('downloaded')
  })
})
