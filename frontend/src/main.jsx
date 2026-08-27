import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initBackend } from './api'

const root = ReactDOM.createRoot(document.getElementById('root'))

function renderStatus(text) {
  root.render(
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#334155',
    }}>
      {text}
    </div>
  )
}

renderStatus('Starting Cartolith…')

// Under Tauri, the backend runs as a separate sidecar process and needs a
// moment to come up before the app makes its first API call. In dev mode
// / the old desktop build this resolves immediately (no-op).
initBackend({ onStatus: renderStatus })
  .then(() => {
    root.render(
      <React.StrictMode><App /></React.StrictMode>
    )
  })
  .catch((err) => {
    renderStatus(`Cartolith failed to start: ${err.message}`)
  })
