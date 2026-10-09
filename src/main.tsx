import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Ligature names such as "arrow_back" must never appear as fallback text.
// Reveal the icon spans only after the Material Symbols font is available.
if (document.fonts) {
  void document.fonts.load('24px "Material Symbols Outlined"', 'arrow_back')
    .then((faces) => {
      if (faces.length > 0) document.documentElement.classList.add('material-symbols-ready')
    })
    .catch(() => {
      // Keep icon slots empty if the external font cannot be loaded.
    })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
