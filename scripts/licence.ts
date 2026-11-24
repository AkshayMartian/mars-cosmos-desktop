/**
 * MARS support tool: makes licence codes until the admin portal does it.
 *
 *   npm run licence -- keygen
 *       makes a key pair: private key to scripts/.keys/licence.private.pem (git-ignored), prints the public key to paste
 *       into src/main/services/licenceKey.ts
 *   npm run licence -- key
 *       prints a new activation key, MARS-XXXX-XXXX-XXXX
 *   npm run licence -- issue <request code> --shop "Name" --days 365 [--plan Starter] [--mode cloud|local] [--counters 1] [--trial] [--private path.pem]
 *       reads the request code from the shop and prints the response code to send back (also renews: same command again)
 */
import { generateKeyPairSync, randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRequestCode } from '../src/main/services/licence'
import { signLicence } from '../src/main/services/licenceSign'

const [cmd, ...rest] = process.argv.slice(2)
const flag = (name: string, fallback = ''): string => {
  const i = rest.indexOf('--' + name)
  return i >= 0 && rest[i + 1] && !rest[i + 1]!.startsWith('--') ? rest[i + 1]! : fallback
}
const keyDir = join(import.meta.dirname, '.keys')

if (cmd === 'keygen') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(keyDir, { recursive: true })
  const file = join(keyDir, 'licence.private.pem')
  if (existsSync(file)) throw new Error(`${file} already exists. Move it away first; a new key would invalidate every issued licence.`)
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  console.log('Private key saved to', file, '(keep it safe, never commit it)')
  console.log('Public key for src/main/services/licenceKey.ts:\n' + publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))
} else if (cmd === 'key') {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
  const part = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('')
  console.log(`MARS-${part()}-${part()}-${part()}`)
} else if (cmd === 'issue') {
  const req = parseRequestCode(rest[0] ?? '')
  const pem = flag('private') || [join(keyDir, 'licence.private.pem'), join(keyDir, 'licence-dev.private.pem')].find(existsSync)
  if (!pem) throw new Error('No private key found. Run `npm run licence -- keygen` or pass --private <file>.')
  const days = Number(flag('days', '365'))
  const exp = new Date(Date.now() + days * 864e5)
  const expires = `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`
  const code = signLicence({
    v: 1, key: req.key, machine: req.machine, shop: flag('shop'), plan: flag('plan', 'Starter'),
    mode: flag('mode', 'cloud') === 'local' ? 'local' : 'cloud', counters: Number(flag('counters', '1')),
    kind: rest.includes('--trial') ? 'trial' : 'full', expires, issued: new Date().toISOString()
  }, readFileSync(pem, 'utf8'))
  console.log(`Key ${req.key} · mobile ${req.mobile} · valid till ${expires}\n\nResponse code (send this to the owner):\n${code}`)
} else {
  console.log('Usage: npm run licence -- keygen | key | issue <request code> --shop "Name" --days 365')
}
