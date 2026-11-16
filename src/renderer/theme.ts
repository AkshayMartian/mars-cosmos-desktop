// Light / dark theme. "Auto" follows the PC clock: dark from 7 pm to 7 am, light in the day.
export type ThemeMode = 'auto' | 'light' | 'dark'
export const THEME_ORDER: ThemeMode[] = ['auto', 'light', 'dark']
export const THEME_LABEL: Record<ThemeMode, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' }
const KEY = 'mars-theme'
export const DARK_FROM = 19 // hour the evening starts
export const DARK_TO = 7 // hour the morning starts

export function isNight(d: Date): boolean {
  const h = d.getHours()
  return h >= DARK_FROM || h < DARK_TO
}

export function resolveTheme(mode: ThemeMode, now: Date = new Date()): 'light' | 'dark' {
  return mode === 'auto' ? (isNight(now) ? 'dark' : 'light') : mode
}

export function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch { return 'auto' }
}

export function saveMode(m: ThemeMode): void {
  try { localStorage.setItem(KEY, m) } catch { /* private mode: the choice just is not remembered */ }
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode)
}
