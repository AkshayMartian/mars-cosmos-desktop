/**
 * Sample products for trying the import (and for demos). Only used by `npm run template -- <file> --sample`;
 * the app itself never creates these. Rows whose category the shop does not have are left out.
 */
type Row = (string | number)[]

interface Sample {
  name: string
  brand: string
  category: string
  sizes: string[]
  colours: string[]
  mrp: number
  cost: number
  /** price actually charged, if different from the MRP */
  sale?: number
}

const SAMPLES: Sample[] = [
  { name: 'Oxford Formal Shirt', brand: 'Own', category: 'Shirts', sizes: ['38', '40', '42', '44'], colours: ['White', 'Sky'], mrp: 1499, cost: 780 },
  { name: 'Linen Casual Shirt', brand: 'Own', category: 'Shirts', sizes: ['M', 'L', 'XL'], colours: ['Beige', 'Olive'], mrp: 2799, cost: 1500, sale: 2499 },
  { name: 'Classic Polo T-Shirt', brand: 'H&M', category: 'T-Shirts', sizes: ['M', 'L', 'XL'], colours: ['Black', 'Navy'], mrp: 899, cost: 420 },
  { name: 'Round Neck T-Shirt', brand: 'Own', category: 'T-Shirts', sizes: ['S', 'M', 'L', 'XL'], colours: ['White', 'Grey'], mrp: 599, cost: 260, sale: 549 },
  { name: 'Chino Trouser', brand: 'Denimo', category: 'Trousers', sizes: ['30', '32', '34', '36'], colours: ['Khaki', 'Navy'], mrp: 1799, cost: 950 },
  { name: 'Slim Fit Jeans', brand: 'Denimo', category: 'Jeans', sizes: ['30', '32', '34', '36'], colours: ['Dark Blue'], mrp: 2199, cost: 1150 },
  { name: 'Leather Belt', brand: 'Hide & Co', category: 'Belts', sizes: ['32', '34', '36', '38'], colours: ['Brown', 'Black'], mrp: 799, cost: 350 },
  { name: 'Leather Wallet', brand: 'Hide & Co', category: 'Wallets', sizes: ['Free'], colours: ['Brown', 'Black'], mrp: 699, cost: 300 },
  { name: 'Analog Watch', brand: 'Timex', category: 'Watches', sizes: ['Free'], colours: ['Silver'], mrp: 2499, cost: 1400 },
  { name: 'Aviator Sunglasses', brand: 'Vista', category: 'Goggles', sizes: ['Free'], colours: ['Black', 'Gunmetal'], mrp: 1199, cost: 520 },
  { name: 'A-Line Skirt', brand: 'Own', category: 'Skirt', sizes: ['S', 'M', 'L'], colours: ['Black', 'Floral'], mrp: 1299, cost: 600 }
]

/** One row per size and colour, in the importer's column order. Quantities vary so the stock looks real. */
export function sampleRows(categoryNames: string[]): Row[] {
  const byLower = new Map(categoryNames.map((n) => [n.toLowerCase(), n]))
  const rows: Row[] = []
  SAMPLES.forEach((p, pi) => {
    const category = byLower.get(p.category.toLowerCase())
    if (!category) return
    let n = 0
    for (const colour of p.colours)
      for (const size of p.sizes) {
        rows.push([p.name, p.brand, category, size, colour, p.mrp, p.sale ?? '', p.cost, ((pi * 3 + n * 5) % 7) + 2])
        n++
      }
  })
  return rows
}
