import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './AuthContext.jsx'
import App from './App.jsx'
import { captureAttribution } from './tracking.js'

// Remember utm_* / twclid from the landing URL before anything rewrites it.
captureAttribution()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
