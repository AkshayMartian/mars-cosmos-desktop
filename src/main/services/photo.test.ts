import { existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, openDb } from '../db'
import { MIGRATIONS } from '../db/schema'
import { purgeTemp, readDataUrl, saveTemp, setPhotoDir, slug } from '../photoStore'
import {
  createProduct, getProduct, listCategories, listProductPhotos, removeColourPhoto, savePhotoBytes, setColourPhoto, variantPhoto
} from './catalogue'
import { setCurrent } from './session'

const jpeg = (marker = 0) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, marker, 0xff, 0xd9])
const as = (role: string) => setCurrent((getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id)
const input = (over: Record<string, unknown> = {}) => ({
  name: 'Polo Shirt', brand: '', categoryId: listCategories()[0]!.id, mrp: 100_000, salePrice: 0, cost: 0,
  sizes: ['M', 'L'], colours: ['Blue', 'Red'], opening: {}, ...over
})
const rows = () => getDb().prepare('SELECT colour,file_path,sort_order,created_at,updated_at FROM product_photos ORDER BY sort_order,colour').all() as { colour: string; file_path: string; sort_order: number; created_at: string; updated_at: string }[]
let dir = ''

beforeEach(() => { openDb(':memory:'); setCurrent(null); dir = mkdtempSync(join(tmpdir(), 'mars-photo-')); setPhotoDir(dir) })
afterEach(() => vi.useRealTimers())

describe('one photo per colour', () => {
  it('attaches a photo to each colour when the product is created, named <productId>-<colour>.jpg', () => {
    as('owner')
    const { id } = createProduct(input({ photos: { Blue: saveTemp(jpeg(1)), Red: saveTemp(jpeg(2)) } }))
    expect(readdirSync(dir).sort()).toEqual([`${id}-blue.jpg`, `${id}-red.jpg`])
    expect(rows()).toMatchObject([{ colour: 'Blue', file_path: `${id}-blue.jpg`, sort_order: 0 }, { colour: 'Red', file_path: `${id}-red.jpg`, sort_order: 1 }])
    expect(rows()[0]!.created_at).toBe(rows()[0]!.updated_at)
    expect(listProductPhotos(id).map((p) => [p.colour, p.file, p.dataUrl?.startsWith('data:image/jpeg;base64,')])).toEqual([
      ['Blue', `${id}-blue.jpg`, true], ['Red', `${id}-red.jpg`, true]
    ])
  })

  it('gives every size of a colour the same photo, and a colour without a photo none', () => {
    as('owner')
    const { id } = createProduct(input({ colours: ['Blue', 'Red', 'Green'], photos: { Blue: saveTemp(jpeg(1)), Red: saveTemp(jpeg(2)) } }))
    const v = getProduct(id).variants // Blue M, Blue L, Red M, Red L, Green M, Green L
    const photoOf = (colour: string, size: string) => variantPhoto(v.find((x) => x.colour === colour && x.size === size)!.id)
    expect(photoOf('Blue', 'M')).not.toBeNull()
    expect(photoOf('Blue', 'M')).toBe(photoOf('Blue', 'L')) // both sizes of Blue share Blue's photo
    expect(photoOf('Red', 'M')).toBe(photoOf('Red', 'L'))
    expect(photoOf('Blue', 'M')).not.toBe(photoOf('Red', 'M')) // different colours, different photos
    expect(photoOf('Green', 'M')).toBeNull() // no photo for Green
    expect(listProductPhotos(id).map((p) => p.colour)).toEqual(['Blue', 'Red']) // Green is simply absent
  })

  it('works with no photos at all, and the products table no longer has a photo column', () => {
    as('owner')
    const { id } = createProduct(input())
    expect(listProductPhotos(id)).toEqual([])
    expect(readdirSync(dir)).toEqual([])
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM pragma_table_info('products') WHERE name='photo'").get()).toEqual({ n: 0 })
  })

  it('checks every photo before saving anything: wrong colour, bad name, missing file', () => {
    as('owner')
    const tmp = saveTemp(jpeg())
    expect(() => createProduct(input({ photos: { Pink: tmp } }))).toThrow('not on this product')
    expect(() => createProduct(input({ photos: { Blue: '..\\..\\secret.jpg' } }))).toThrow('not valid')
    expect(() => createProduct(input({ photos: { Blue: 'C:\\Windows\\x.jpg' } }))).toThrow('not valid')
    expect(() => createProduct(input({ photos: { Blue: tmp, Red: 'tmp-does-not-exist.jpg' } }))).toThrow('not found')
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 0 }) // no half-saved product
    expect(existsSync(join(dir, tmp))).toBe(true) // the good photo was not used up
  })

  it('adds, changes and removes the photo of one colour later', () => {
    as('manager')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'))
    const { id } = createProduct(input())
    setColourPhoto(id, 'Blue', saveTemp(jpeg(1)))
    const first = readDataUrl(`${id}-blue.jpg`)
    expect(rows()).toMatchObject([{ colour: 'Blue', file_path: `${id}-blue.jpg`, updated_at: '2026-11-12T10:00:00.000Z' }])

    vi.setSystemTime(new Date('2026-11-12T11:00:00.000Z'))
    setColourPhoto(id, 'Blue', saveTemp(jpeg(9))) // Change
    expect(readDataUrl(`${id}-blue.jpg`)).not.toBe(first) // the picture really changed
    expect(readdirSync(dir)).toEqual([`${id}-blue.jpg`]) // still one file, not two
    expect(rows()[0]).toMatchObject({ created_at: '2026-11-12T10:00:00.000Z', updated_at: '2026-11-12T11:00:00.000Z' })
    expect(rows()).toHaveLength(1) // one row per colour, replaced, not added

    removeColourPhoto(id, 'Blue') // the ✕ button
    expect(rows()).toEqual([])
    expect(readdirSync(dir)).toEqual([])
    expect(() => removeColourPhoto(id, 'Blue')).toThrow('There is no photo for "Blue"')
  })

  it('refuses a photo for a colour or product that does not exist, and for non-managers', () => {
    as('owner')
    const { id } = createProduct(input())
    expect(() => setColourPhoto(id, 'Pink', saveTemp(jpeg()))).toThrow('This product has no colour "Pink"')
    expect(() => setColourPhoto('no-such-product', 'Blue', saveTemp(jpeg()))).toThrow('Product not found')
    as('cashier')
    expect(() => setColourPhoto(id, 'Blue', saveTemp(jpeg()))).toThrow('not allowed')
    expect(() => removeColourPhoto(id, 'Blue')).toThrow('not allowed')
    as('store')
    expect(listProductPhotos(id)).toEqual([]) // anyone logged in may look
  })

  it('gives colours whose names make the same file name different files', () => {
    as('owner')
    const { id } = createProduct(input({ colours: ['Dark Blue', 'dark-blue', 'DARK BLUE!'], photos: { 'Dark Blue': saveTemp(jpeg(1)), 'dark-blue': saveTemp(jpeg(2)), 'DARK BLUE!': saveTemp(jpeg(3)) } }))
    const files = rows().map((r) => r.file_path)
    expect(new Set(files).size).toBe(3)
    expect(files.every((f) => f.startsWith(`${id}-dark-blue`) && f.endsWith('.jpg'))).toBe(true)
    expect(slug('Dark Blue')).toBe('dark-blue')
    expect(slug('!!!')).toBe('colour') // never an empty name
  })

  it('has one row per colour of a product in the database', () => {
    as('owner')
    const { id } = createProduct(input({ photos: { Blue: saveTemp(jpeg()) } }))
    expect(() => getDb().prepare("INSERT INTO product_photos (id,product_id,colour,file_path,created_at,updated_at) VALUES ('x',?,'Blue','other.jpg','t','t')").run(id)).toThrow(/UNIQUE/)
  })

  it('needs a login to see a photo', () => {
    as('owner')
    const { id } = createProduct(input({ photos: { Blue: saveTemp(jpeg()) } }))
    setCurrent(null)
    expect(() => listProductPhotos(id)).toThrow('Not logged in')
    expect(() => variantPhoto('anything')).toThrow('Not logged in')
  })
})

describe('photo files', () => {
  it('accepts JPEG bytes from the screen and refuses anything else', () => {
    as('owner')
    const ok = savePhotoBytes(new Uint8Array(jpeg()))
    expect(ok.file).toMatch(/^tmp-.*\.jpg$/)
    expect(ok.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(() => savePhotoBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow('could not be read') // a PNG, not a JPEG
    expect(() => savePhotoBytes(new Uint8Array([]))).toThrow('could not be read')
    const huge = new Uint8Array(9 * 1024 * 1024)
    huge.set([0xff, 0xd8]) // looks like a JPEG but is over the 8 MB limit
    expect(() => savePhotoBytes(huge)).toThrow('too large')
    as('cashier')
    expect(() => savePhotoBytes(new Uint8Array(jpeg()))).toThrow('not allowed')
  })

  it('cleans up old unsaved picks but never saved photos or fresh picks', () => {
    as('owner')
    const { id } = createProduct(input({ photos: { Blue: saveTemp(jpeg()) } }))
    const oldPick = saveTemp(jpeg(1)), freshPick = saveTemp(jpeg(2))
    const longAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000)
    utimesSync(join(dir, oldPick), longAgo, longAgo)
    expect(purgeTemp(24 * 3600 * 1000)).toBe(1)
    expect(existsSync(join(dir, oldPick))).toBe(false)
    expect(existsSync(join(dir, freshPick))).toBe(true)
    expect(existsSync(join(dir, `${id}-blue.jpg`))).toBe(true)
    expect(readDataUrl('../etc.jpg')).toBeNull() // file names only, never paths
  })
})

describe('upgrading a database that has one photo per product', () => {
  it('gives that photo to every colour of the product; the file is kept until nobody uses it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mars-mig-')), 'old.db')
    const old = new Database(file)
    for (const m of MIGRATIONS.filter((x) => x.version <= 3)) old.exec(m.sql)
    old.pragma('user_version = 3')
    old.prepare("INSERT INTO staff (id,name,role,pin_hash) VALUES ('s','Owner','owner','x')").run()
    old.prepare("INSERT INTO categories (id,name,hsn,gst_mode) VALUES ('c','Shirts','6205','auto')").run()
    old.prepare("INSERT INTO products (id,name,category_id,photo,created_at) VALUES ('p1','Shirt','c','p1.jpg','t'),('p2','Plain','c',NULL,'t')").run()
    const v = old.prepare("INSERT INTO variants (id,product_id,size,colour,barcode,mrp,sale_price) VALUES (?,?,?,?,?,100,100)")
    v.run('v1', 'p1', 'S', 'Blue', '2000000000015'); v.run('v2', 'p1', 'M', 'Blue', '2000000000022'); v.run('v3', 'p1', 'S', 'Red', '2000000000039'); v.run('v4', 'p2', 'S', 'Blue', '2000000000046')
    old.close()
    writeFileSync(join(dir, 'p1.jpg'), jpeg(7)) // the one photo the product had

    openDb(file)
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM pragma_table_info('products') WHERE name='photo'").get()).toEqual({ n: 0 })
    expect(getDb().prepare('SELECT product_id,colour,file_path FROM product_photos ORDER BY colour').all()).toEqual([
      { product_id: 'p1', colour: 'Blue', file_path: 'p1.jpg' }, // one row per colour, not per size
      { product_id: 'p1', colour: 'Red', file_path: 'p1.jpg' } // and none for the product that had no photo
    ])
    as('owner')
    expect(variantPhoto('v1')).toBe(variantPhoto('v3')) // still the same picture on both colours

    setColourPhoto('p1', 'Blue', saveTemp(jpeg(8))) // Blue gets its own photo
    expect(rows().map((r) => [r.colour, r.file_path])).toEqual([['Blue', 'p1-blue.jpg'], ['Red', 'p1.jpg']])
    expect(existsSync(join(dir, 'p1.jpg'))).toBe(true) // Red still uses the original file
    removeColourPhoto('p1', 'Red')
    expect(existsSync(join(dir, 'p1.jpg'))).toBe(false) // nobody uses it now
    getDb().close()
  })
})
