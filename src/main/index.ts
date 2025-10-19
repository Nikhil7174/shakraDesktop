import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, session } from 'electron'
import { join } from 'path'
import { WebSocketServer } from './websocket-server'
import { ProcessMonitor } from './process-monitor'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProcessStatsData } from '../shared/types'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let wsServer: WebSocketServer | null = null
let monitor: ProcessMonitor | null = null

function createWindow(): void {
  // Main window - full screen for interview interface
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false, // Don't show until ready
    fullscreen: false, // Allow fullscreen toggle
    maximizable: true,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // SECURITY BEST PRACTICES:
      nodeIntegration: false,        // ✅ Never expose Node to renderer
      contextIsolation: true,         // ✅ Isolate renderer context
      sandbox: true,                  // ✅ Sandbox renderer
      webSecurity: true,              // ✅ Enable web security
      allowRunningInsecureContent: false, // ✅ Disable insecure content
      experimentalFeatures: false     // ✅ Disable experimental features
    }
  })

  // Enable developer tools for debugging
  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  // Show and maximize window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.maximize()
  })

  // Load the UI
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  tray = new Tray(icon)
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Crisp Interview App', 
      enabled: false 
    },
    { 
      label: 'Show Interview Window', 
      click: () => mainWindow?.show() 
    },
    { type: 'separator' },
    { 
      label: 'Security Status: Active', 
      enabled: false 
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        wsServer?.stop()
        monitor?.stop()
        app.quit()
      }
    }
  ])
  
  tray.setToolTip('Crisp Interview App - Security Monitoring Active')
  tray.setContextMenu(contextMenu)
  
  tray.on('double-click', () => {
    mainWindow?.show()
  })
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.interview.security-agent')

  // Configure session permissions for external API calls
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "connect-src 'self' https://crisp-3jy7.onrender.com https://localhost:3001 http://localhost:3001 ws://localhost:8765; " +
          "img-src 'self' data: https:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "font-src 'self' data:;"
        ]
      }
    })
  })

  // Optimize window on macOS
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Add global shortcut to show window (Ctrl/Cmd + Shift + S)
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })

  createWindow()
  createTray()

  // Start security services
  wsServer = new WebSocketServer(8765)
  wsServer.start()

  monitor = new ProcessMonitor(wsServer)
  monitor.start()

  // Set up IPC handlers for process stats
  ipcMain.handle('get-process-stats', async (): Promise<ProcessStatsData> => {
    if (monitor) {
      return await monitor.getDetailedProcessStats()
    }
    throw new Error('Process monitor not available')
  })

  // Set up IPC handler for status
  ipcMain.handle('get-status', async () => {
    if (monitor) {
      const status = await monitor.checkProcesses()
      return {
        connected: true,
        blockedApps: status.blockedAppsDetected.map(app => app.name),
        timestamp: status.timestamp,
        error: status.error,
        blockedAndKilled: status.blockedAndKilled,
        message: status.message
      }
    }
    throw new Error('Process monitor not available')
  })


  // Send process stats updates to renderer (reduced frequency to prevent crashes)
  setInterval(async () => {
    if (monitor && mainWindow && !mainWindow.isDestroyed()) {
      try {
        const stats = await monitor.getDetailedProcessStats()
        mainWindow.webContents.send('process-stats-update', stats)
      } catch (error) {
        console.error('Error sending process stats update:', error)
        // Only send error if window is still valid
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process-stats-update', {
            totalProcesses: 0,
            blockedAppsDetected: [],
            systemInfo: { cpuUsage: 0, memoryUsage: 0, uptime: 0 },
            recentProcesses: [],
            timestamp: Date.now(),
            error: 'Failed to get process stats'
          })
        }
      }
    }
  }, 5000) // Update every 5 seconds (reduced from 3 seconds)


  console.log('✓ Security Agent started on port 8765')
})

// macOS - keep app running
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // On Windows/Linux, quit when windows closed
    // (But we use tray, so this won't trigger often)
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Cleanup on app quit
app.on('before-quit', () => {
  console.log('Cleaning up resources...')
  globalShortcut.unregisterAll()
  wsServer?.stop()
  monitor?.stop()
})

// Handle app termination
process.on('SIGINT', () => {
  console.log('Received SIGINT, cleaning up...')
  wsServer?.stop()
  monitor?.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up...')
  wsServer?.stop()
  monitor?.stop()
  process.exit(0)
})