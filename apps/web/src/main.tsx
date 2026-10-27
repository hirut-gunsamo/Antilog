import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startPwa } from './lib/pwa'

startPwa()

// A mouse wheel over a number box being typed in would change its value
// without anyone noticing; let the wheel scroll the page instead.
document.addEventListener(
  'wheel',
  (event) => {
    const box = document.activeElement
    if (box instanceof HTMLInputElement && box.type === 'number' && box === event.target) box.blur()
  },
  { passive: true },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
