import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ClerkProvider } from '@clerk/clerk-react'


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
  // Hide splash on error
  const splash = document.getElementById('app-loading')
  if (splash) splash.remove()
} else {
  console.log('✅ [Renderer] Root element found, mounting React app...')
  try {
    const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

    console.log('🔑 [Renderer] Initializing Clerk with key:', PUBLISHABLE_KEY ? 'PRESENT (Masked)' : 'MISSING')

    if (!PUBLISHABLE_KEY) {
      console.error("Missing CLERK_PUBLISHABLE_KEY")
    }

    const root = createRoot(rootElement)
    root.render(
      <StrictMode>
        <ClerkProvider
          publishableKey={PUBLISHABLE_KEY}
          afterSignOutUrl="/"
          allowedRedirectOrigins={['http://localhost:42424', 'shakra-app://*']}
        >
          <App />
        </ClerkProvider>
      </StrictMode>
    )
    console.log('✅ [Renderer] React app mounted successfully')
    // Splash screen will be hidden by App component after redux-persist rehydrates
  } catch (error) {
    console.error('❌ [Renderer] Failed to mount React app:', error)
    rootElement.innerHTML = `<div style="padding: 20px; color: red;">Error mounting app: ${error}</div>`
    // Hide splash on error
    const splash = document.getElementById('app-loading')
    if (splash) splash.remove()
  }
}
