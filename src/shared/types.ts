export type Role = 'owner' | 'manager' | 'cashier' | 'store'
export type GstScheme = 'regular' | 'composition' | 'unregistered'

/** How GST is decided for a category. 'auto' = clothing: 5% up to Rs 2,500 per piece, else 18%. */
export interface GstRule {
  mode: 'auto' | 'fixed' | 'exempt'
  rate: number
}

export interface StaffPublic {
  id: string
  name: string
  role: Role
}

export interface LoginResult {
  ok: boolean
  staff?: StaffPublic
  mustChangePin?: boolean
  error?: string
  /** seconds until the account unlocks, when locked */
  lockedFor?: number
}

export interface AppInfo {
  shopName: string
  counter: string
  idleMinutes: number
}

export type MenuId =
  | 'billing' | 'bills' | 'returns' | 'alterations'
  | 'products' | 'stickers' | 'stockin' | 'stockout' | 'stock'
  | 'customers' | 'reports' | 'dayend' | 'settings'

export const MENU: { id: MenuId; label: string; key?: string; roles: Role[]; group: number }[] = [
  { id: 'billing', label: 'Billing', key: 'F1', roles: ['owner', 'manager', 'cashier'], group: 1 },
  { id: 'bills', label: 'Bills', roles: ['owner', 'manager', 'cashier'], group: 1 },
  { id: 'returns', label: 'Return / exchange', roles: ['owner', 'manager', 'cashier'], group: 1 },
  { id: 'alterations', label: 'Alterations', roles: ['owner', 'manager', 'cashier', 'store'], group: 1 },
  { id: 'products', label: 'Products', roles: ['owner', 'manager', 'cashier', 'store'], group: 2 },
  { id: 'stickers', label: 'Print stickers', roles: ['owner', 'manager', 'store'], group: 2 },
  { id: 'stockin', label: 'Stock in', roles: ['owner', 'manager', 'store'], group: 2 },
  { id: 'stockout', label: 'Stock out', roles: ['owner', 'manager', 'store'], group: 2 },
  { id: 'stock', label: 'Stock', roles: ['owner', 'manager', 'store'], group: 2 },
  { id: 'customers', label: 'Customers', roles: ['owner', 'manager', 'cashier'], group: 3 },
  { id: 'reports', label: 'Reports', roles: ['owner', 'manager'], group: 3 },
  { id: 'dayend', label: 'Day end', roles: ['owner', 'manager', 'cashier'], group: 3 },
  { id: 'settings', label: 'Settings', roles: ['owner'], group: 3 }
]

/**
 * Menu items switched on right now. The others stay defined in MENU above but are hidden until their
 * milestone is ready: add an id here to show it (and register its screen in renderer/App.tsx).
 */
export const ENABLED: MenuId[] = ['billing', 'bills', 'returns', 'alterations', 'products', 'stickers', 'stockin', 'stockout', 'stock', 'customers', 'dayend', 'settings']

export const menuFor = (role: Role) => MENU.filter((m) => ENABLED.includes(m.id) && m.roles.includes(role))

/** First screen after login: the first menu item this person can see. */
export const homeFor = (role: Role): MenuId => menuFor(role)[0]?.id ?? 'products'
