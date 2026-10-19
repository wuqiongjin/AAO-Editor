import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './app/styles/index.css'
import { installGlobalErrorHandlers } from './diagnostics/globalErrorHandlers'
import App from './App.tsx'

installGlobalErrorHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
