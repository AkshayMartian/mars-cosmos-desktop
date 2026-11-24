/**
 * LOCAL TEST STAND-IN for the MARS licence server. It accepts any well-formed key and signs a licence with the
 * development private key, so the "Activation key" and "Free trial" tabs can be tried without the real server.
 * Never run it on a shop PC.
 *
 *   npm run licence-server                       (listens on http://localhost:4000)
 *   $env:MARS_LICENCE_URL = 'http://localhost:4000'; npm run dev      (PowerShell, in another window)
 *
 * Trial one-time code is always 123456 (also printed here).
 */
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { KEY_RE } from '../src/shared/licence'
import { signLicence } from '../src/main/services/licenceSign'

const keyDir = join(import.meta.dirname, '.keys')
const pemFile = [join(keyDir, 'licence.private.pem'), join(keyDir, 'licence-dev.private.pem')].find(existsSync)
if (!pemFile) throw new Error('No private key in scripts/.keys. Run `npm run licence -- keygen`.')
const pem = readFileSync(pemFile, 'utf8')
const PORT = Number(process.env['PORT'] ?? 4000)
const OTP = '123456'

const ymd = (days: number): string => {
  const d = new Date(Date.now() + days * 864e5)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const licence = (key: string, machine: string, shop: string, kind: 'full' | 'trial', days: number): string =>
  signLicence({ v: 1, key, machine, shop, plan: kind === 'trial' ? 'Trial' : 'Starter', mode: 'cloud', counters: 1, kind, expires: ymd(days), issued: new Date().toISOString() }, pem)

createServer((req, res) => {
  let raw = ''
  req.on('data', (c: Buffer) => { raw += c.toString() })
  req.on('end', () => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    let b: Record<string, string> = {}
    try { b = JSON.parse(raw || '{}') as typeof b } catch { return send(400, { error: 'Bad request.' }) }
    console.log(new Date().toLocaleTimeString(), req.method, req.url)
    if (req.method !== 'POST' || !b['machine']) return send(404, { error: 'Not found.' })
    switch (req.url) {
      case '/v1/activate':
        if (!KEY_RE.test(b['key'] ?? '')) return send(400, { error: 'This activation key is not valid.' })
        return send(200, { licence: licence(b['key']!, b['machine'], 'Dev Test Shop', 'full', 365) })
      case '/v1/trial/otp':
        console.log(`  trial code for ${b['mobile']}: ${OTP}`)
        return send(200, {})
      case '/v1/trial/verify':
        if (b['otp'] !== OTP) return send(400, { error: 'That code is not right. Check the message and try again.' })
        return send(200, { licence: licence('MARS-TRYX-0000-0000', b['machine'], b['shop'] || 'Trial Shop', 'trial', 14) })
      case '/v1/refresh':
        return send(200, { licence: licence(b['key']!, b['machine'], 'Dev Test Shop', 'full', 365) })
      default:
        return send(404, { error: 'Not found.' })
    }
  })
}).listen(PORT, () => console.log(`Dev licence server on http://localhost:${PORT} (key file ${pemFile})`))
