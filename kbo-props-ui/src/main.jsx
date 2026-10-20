import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import { AuthProvider } from './AuthContext.jsx'
import { AgeGateProvider } from './AgeGate.jsx'
import App from './App.jsx'
import './stadiumBackground.css'
import './mobile.css'
import { captureAttribution } from './tracking.js'
import { Analytics } from '@vercel/analytics/react'
import { scrubEvent } from './analytics.js'
import { startTableCardLabels } from './tableCardLabels.js'

// Remember utm_* / twclid from the landing URL before anything rewrites it.
captureAttribution()

// Phone only: column names on the table cards (layout, no data change).
startTableCardLabels()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AgeGateProvider>
        <App />
      </AgeGateProvider>
    </AuthProvider>
    {/* Vercel page views only. URLs are scrubbed to path + safe query keys. */}
    <Analytics beforeSend={scrubEvent} />
  </StrictMode>,
)
