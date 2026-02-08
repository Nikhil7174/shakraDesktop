import { app, session, globalShortcut, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import * as dotenv from 'dotenv'
import path from 'path'
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

// Handle Deep Links & Single Instance Lock
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('shakra-app', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('shakra-app')
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

// Function to handle deep link
function handleDeepLink(argv: string[]) {
  const url = argv.find((arg) => arg.startsWith('shakra-app://'))
  if (url) {
    // If window service is ready, send it immediately
    // If not, we store it or wait? 
    // Actually, windowService.initialize handles creation.
    // We should wait for app.whenReady() essentially.

    // For now, let's just log it and we will handle it in whenReady
    console.log('🔗 [Main] Deep link received:', url)
    return url
  }
  return null
}

// Check for deep link on startup (Windows/Linux cold start)
// On macOS, open-url is triggered.
const startupDeepLink = process.platform !== 'darwin' ? handleDeepLink(process.argv) : null

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

// Deep Link Event Handlers (must be after services init)
app.on('second-instance', (event, commandLine) => {
  // Someone tried to run a second instance, we should focus our window.
  const url = commandLine.find((arg) => arg.startsWith('shakra-app://'))
  if (url) {
    windowService.sendDeepLink(url)
  } else {
    windowService.show()
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  windowService.sendDeepLink(url)
})

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
          "connect-src 'self' http://localhost:42424 https://localhost:42424 https://crisp-server-n0r1.onrender.com https://cdn.jsdelivr.net https://storage.googleapis.com https://*.livekit.cloud wss://*.livekit.cloud ws://*.livekit.cloud https://*.clerk.accounts.dev https://clerk-telemetry.com; " +
          "img-src 'self' data: https:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://storage.googleapis.com https://*.clerk.accounts.dev; " +
          "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://storage.googleapis.com https://*.clerk.accounts.dev; " +
          "style-src 'self' 'unsafe-inline'; " +
          "frame-src 'self' https://accounts.youtube.com https://*.clerk.accounts.dev; " +
          "font-src 'self' data:; " +
          "worker-src 'self' blob: https://cdn.jsdelivr.net https://*.clerk.accounts.dev; " +
          "wasm-unsafe-eval;"
        ]
      }
    })
  })

  // Intercept Clerk requests to ensure Origin is set correctly (fix for 401 in prod)
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.clerk.accounts.dev/*', 'https://api.clerk.com/*'] },
    (details, callback) => {
      console.log('🔒 [Main] Intercepting Clerk Request:', details.url)
      console.log('🔒 [Main] Original Headers:', JSON.stringify(details.requestHeaders, null, 2))

      // Force Origin to localhost:42424 to match Clerk's allowed_origins
      details.requestHeaders['Origin'] = 'http://localhost:42424';
      // details.requestHeaders['Referer'] = 'http://localhost:3000'; // Optional, sometimes needed

      console.log('🔒 [Main] Modified Headers:', JSON.stringify(details.requestHeaders, null, 2))
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // Start all services
  try {
    await lifecycle.start()
    console.log('✓ All services started successfully')
  } catch (error) {
    console.error('Failed to start application:', error)
    app.quit()
  }

  // Handle open-external requests from renderer
  ipcMain.on('open-external', async (_, url) => {
    console.log('🔗 [Main] Opening external URL:', url)
    await shell.openExternal(url)
  })

  // If we had a startup deep link, send it now that window exists
  if (startupDeepLink) {
    console.log('🔗 [Main] Processing startup deep link:', startupDeepLink)
    // Small delay to ensure React is mounted
    setTimeout(() => {
      windowService.sendDeepLink(startupDeepLink)
    }, 2000)
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
