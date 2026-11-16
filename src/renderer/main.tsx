import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/500.css'
import '@fontsource/figtree/600.css'
import '@fontsource/figtree/700.css'
import '@fontsource/figtree/800.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import { App } from './App'
import { applyTheme, loadMode } from './theme'
import './styles.css'

applyTheme(loadMode()) // before the first paint, so there is no light flash at night

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
