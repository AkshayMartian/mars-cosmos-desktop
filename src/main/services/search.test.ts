import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { openDay, sellableSearch } from './billing'
import { createProduct, listCategories, listProducts } from './catalogue'
import { listCustomers } from './customers'
import { setCurrent } from './session'
import { likeAll } from './search'
import { searchVariants, stockLevels } from './stock'

beforeEach(() => {
  openDb(':memory:')
  setCurrent((getDb().prepare("SELECT id FROM staff WHERE role='owner'").get() as { id: string }).id)
})

describe('search boxes: every word must match, % and _ are plain characters', () => {
  it('likeAll builds one AND per word and escapes wildcards', () => {
    expect(likeAll('  ', ['a']).sql).toBe('1')
    const m = likeAll('blue 50%', ['a', 'b'])
    expect(m.args).toEqual(['%blue%', '%blue%', '%50\\%%', '%50\\%%'])
    expect(m.sql.match(/AND/g)).toHaveLength(1)
  })
  it('finds an item by words from different columns, in any order, and not by a stray % or _', () => {
    const cat = listCategories().find((c) => c.name === 'Shirts')!.id
    const make = (name: string, colours: string[]) =>
      createProduct({ name, brand: 'Own', categoryId: cat, mrp: 100_000, salePrice: 100_000, cost: 50_000, sizes: ['M'], colours, opening: Object.fromEntries(colours.map((c) => [`${c}|M`, 3])) })
    make('Slim Shirt', ['Blue', 'Red'])
    make('Boxy Shirt', ['Blue'])
    openDay(0)
    expect(sellableSearch('blue slim')).toHaveLength(1)
    expect(sellableSearch('slim shirt')).toHaveLength(2)
    expect(searchVariants('M blue')).toHaveLength(2)
    expect(stockLevels('shirt red')).toHaveLength(1)
    expect(listProducts('boxy shirt').map((p) => p.name)).toEqual(['Boxy Shirt'])
    expect(sellableSearch('%')).toHaveLength(0)
    expect(sellableSearch('_')).toHaveLength(0)
    expect(listProducts('%')).toHaveLength(0)
  })
  it('customers: a stray % matches nobody', () => {
    expect(listCustomers('%')).toHaveLength(0)
  })
})
