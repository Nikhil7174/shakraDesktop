import { app, session, globalShortcut, BrowserWindow } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import * as dotenv from 'dotenv'
import { LifecycleManager } from './services/lifecycle'
import { WindowService } from './services/window-service'
import { TrayService } from './services/tray-service'
import { SecurityService } from './services/security-service'
import { InterviewService } from './services/interview-service'

// Load environment variables
dotenv.config()
console.log('🔧 [Main] Environment check:')
console.log('🔧 [Main] ASSEMBLYAI_API_KEY:', process.env.ASSEMBLYAI_API_KEY ? `${process.env.ASSEMBLYAI_API_KEY.substring(0, 10)}...` : 'NOT SET (will use server config)')
console.log('🔧 [Main] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : 'NOT SET (will use server config)')

// Lifecycle manager instance
const lifecycle = new LifecycleManager()

// Initialize services
const windowService = new WindowService()
const trayService = new TrayService(windowService)
const securityService = new SecurityService()
const interviewService = new InterviewService(windowService)

// Register services in dependency order
lifecycle.register(windowService)     // 1. Create window (hidden)
lifecycle.register(trayService)       // 2. Create tray
lifecycle.register(securityService)   // 3. Start security monitoring
lifecycle.register(interviewService)  // 4. Initialize interview system

// Cleanup function
async function cleanup() {
  await lifecycle.stop()
  globalShortcut.unregisterAll()
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.shakra.interview')

  // Configure session permissions for external API calls
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "connect-src 'self' https://crisp-server-n0r1.onrender.com https://localhost:3001 http://localhost:3001 https://cdn.jsdelivr.net https://storage.googleapis.com; " +
          "img-src 'self' data: https:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://storage.googleapis.com; " +
          "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://storage.googleapis.com; " +
          "style-src 'self' 'unsafe-inline'; " +
          "font-src 'self' data:; " +
          "worker-src 'self' blob: https://cdn.jsdelivr.net; " +
          "wasm-unsafe-eval;"
        ]
      }
    })
  })

  // Start all services
  try {
    await lifecycle.start()
    console.log('✓ All services started successfully')
  } catch (error) {
    console.error('Failed to start application:', error)
    app.quit()
  }
})

// macOS - keep app running
app.on('window-all-closed', () => {
  // On Windows/Linux, quit when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    // If window is null (destroyed), we might need to re-initialize
    // But in our current service model, WindowService creates it in initialize().
    // We might need to call windowService.show() which handles existing window, 
    // but if it's destroyed, we need to create it.
    // NOTE: For now, assuming standard macOS behavior where we hide instead of destroy.
    windowService.show()
  } else {
    windowService.show()
  }
})

// Cleanup on app quit
let isQuitting = false
app.on('before-quit', async (event) => {
  if (isQuitting) return
  
  // Prevent default quit to allow async cleanup
  event.preventDefault()
  isQuitting = true
  
  console.log('Cleaning up resources before quit...')
  await cleanup()
  app.quit()
})

// Handle app termination signals
process.on('SIGINT', async () => {
  console.log('Received SIGINT, cleaning up...')
  await cleanup()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, cleaning up...')
  await cleanup()
  process.exit(0)
})
