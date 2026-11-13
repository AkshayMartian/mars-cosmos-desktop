import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { formatRupees } from '@shared/money'
import { homeFor, menuFor, type AppInfo, type MenuId, type StaffPublic } from '@shared/types'
import { Alterations } from './screens/Alterations'
import { Bills } from './screens/Bills'
import { Billing } from './screens/Billing'
import { Customers } from './screens/Customers'
import { DayEnd } from './screens/DayEnd'
import { Login } from './screens/Login'
import { Placeholder } from './screens/Placeholder'
import { Returns } from './screens/Returns'
import { Products } from './screens/Products'
import { Stickers } from './screens/Stickers'
import { Stock } from './screens/Stock'
import { StockIn } from './screens/StockIn'
import { StockOut } from './screens/StockOut'

/** Screens are registered here as they are built. Anything missing falls back to Placeholder. */
interface ScreenProps {
  user: StaffPublic
  /** jump to another screen; `intent` tells it what to open, e.g. go('products', 'new') */
  go: (view: MenuId, intent?: string) => void
  intent?: string
}

const SCREENS: Partial<Record<MenuId, (p: ScreenProps) => ReactElement>> = {
  billing: (p) => <Billing user={p.user} />,
  bills: (p) => <Bills user={p.user} />,
  alterations: (p) => <Alterations user={p.user} />,
  returns: () => <Returns />,
  products: (p) => <Products user={p.user} intent={p.intent} />,
  stickers: (p) => <Stickers intent={p.intent} />,
  stockin: (p) => <StockIn canAddProduct={p.user.role === 'owner' || p.user.role === 'manager'} onNewProduct={() => p.go('products', 'new')} onStickers={(id) => p.go('stickers', 'purchase:' + id)} />,
  customers: (p) => <Customers user={p.user} />,
  dayend: () => <DayEnd />,
  stockout: (p) => <StockOut user={p.user} />,
  stock: (p) => <Stock user={p.user} />
}

const roleName: Record<StaffPublic['role'], string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', store: 'Store staff' }
const clockText = (): string =>
  new Date().toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [user, setUser] = useState<StaffPublic | null>(null)
  const [view, setView] = useState<MenuId>('products')
  const [intent, setIntent] = useState<string | undefined>(undefined)
  const go = useCallback((v: MenuId, i?: string) => { setIntent(i); setView(v) }, [])
  const [clock, setClock] = useState(clockText())
  const [sales, setSales] = useState(0)
  const lastActive = useRef(Date.now())

  useEffect(() => { void window.api.app.info().then(setInfo) }, [])
  // "My sales today" chip: refreshed on login, on every screen change, with the clock and right after a bill is saved.
  const [salesTick, setSalesTick] = useState(0)
  useEffect(() => { if (user) void window.api.app.mySales().then(setSales, () => undefined) }, [user, view, clock, salesTick])
  useEffect(() => {
    const f = () => setSalesTick((t) => t + 1)
    window.addEventListener('mars:sale-saved', f)
    return () => window.removeEventListener('mars:sale-saved', f)
  }, [])

  // F1 jumps to Billing from anywhere
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'F1' && user && menuFor(user.role).some((m) => m.id === 'billing')) { e.preventDefault(); go('billing') }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [user, go])

  const lock = useCallback(() => { void window.api.auth.logout(); setUser(null) }, [])

  // Clock + idle auto-lock (prototype: 10 minutes without a click or key).
  useEffect(() => {
    const touch = () => { lastActive.current = Date.now() }
    window.addEventListener('mousedown', touch)
    window.addEventListener('keydown', touch)
    const t = setInterval(() => {
      setClock(clockText())
      if (user && info && Date.now() - lastActive.current > info.idleMinutes * 60_000) lock()
    }, 20_000)
    return () => { window.removeEventListener('mousedown', touch); window.removeEventListener('keydown', touch); clearInterval(t) }
  }, [user, info, lock])

  const items = user ? menuFor(user.role) : []
  const Screen = SCREENS[view]

  return (
    <div className="app">
      <header className="top">
        <span className="logo"><i />MARS POS</span>
        <span className="shop">{info?.shopName ?? ''} · Counter {info?.counter ?? ''}</span>
        <span className="sp" />
        <span className="shop num">{clock}</span>
        {user && (
          <>
            <span className="chip good" title="Your sales today as salesperson">My sales today {formatRupees(sales)}</span>
            <span className="who">{user.name}<small>{roleName[user.role]}</small></span>
            <button className="btn-top" onClick={lock}>Lock</button>
          </>
        )}
      </header>
      {!user ? (
        <Login info={info} onDone={(s) => { lastActive.current = Date.now(); setUser(s); go(homeFor(s.role)) }} />
      ) : (
        <div className="body">
          <nav className="menu" aria-label="Main menu">
            {items.map((m, i) => (
              <div key={m.id} style={{ display: 'contents' }}>
                {i > 0 && items[i - 1]!.group !== m.group && <div className="sep" />}
                <button aria-current={view === m.id ? 'page' : undefined} onClick={() => go(m.id)}>
                  <span>{m.label}</span>
                  {m.key && <kbd>{m.key}</kbd>}
                </button>
              </div>
            ))}
          </nav>
          <main className="work">
            {/* key = remount on switch so each screen reloads fresh data */}
            {Screen ? <Screen key={view} user={user} go={go} intent={intent} /> : <Placeholder title={items.find((m) => m.id === view)?.label ?? ''} />}
          </main>
        </div>
      )}
    </div>
  )
}
