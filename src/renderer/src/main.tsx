import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Add error handler for unhandled errors
window.addEventListener('error', (event) => {
  console.error('❌ [Renderer] Unhandled error:', event.error)
  console.error('❌ [Renderer] Error details:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  })
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ [Renderer] Unhandled promise rejection:', event.reason)
})

// Verify root element exists
const rootElement = document.getElementById('root')
if (!rootElement) {
  console.error('❌ [Renderer] Root element not found!')
  document.body.innerHTML = '<div style="padding: 20px; color: red;">Error: Root element not found</div>'
} else {
  console.log('✅ [Renderer] Root element found, mounting React app...')
  try {
    const root = createRoot(rootElement)
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
    console.log('✅ [Renderer] React app mounted successfully')
  } catch (error) {
    console.error('❌ [Renderer] Failed to mount React app:', error)
    rootElement.innerHTML = `<div style="padding: 20px; color: red;">Error mounting app: ${error}</div>`
  }
}
