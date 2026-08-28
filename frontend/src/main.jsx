import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initBackend } from './api'

const root = ReactDOM.createRoot(document.getElementById('root'))
const startedAt = Date.now()

function renderStatus(text, showReassurance) {
  root.render(
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '12px',
      alignItems: 'center', justifyContent: 'center',
      height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#334155',
      textAlign: 'center', padding: '0 24px',
    }}>
      <div>{text}</div>
      {showReassurance && (
        <div style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '360px' }}>
          First launch can take a minute or two while Cartolith unpacks —
          this is normal, please keep this window open.
        </div>
      )}
    </div>
  )
}

renderStatus('Starting Cartolith…', false)

initBackend({
  onStatus: (text) => renderStatus(text, Date.now() - startedAt > 8_000),
})
  .then(() => {
    root.render(
      <React.StrictMode><App /></React.StrictMode>
    )
  })
  .catch((err) => {
    renderStatus(`Cartolith failed to start: ${err.message}`, false)
  })
