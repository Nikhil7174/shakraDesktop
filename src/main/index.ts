import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, session } from 'electron'
import * as dotenv from 'dotenv'
import { join, resolve } from 'path'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { ProcessMonitor } from './process-monitor'
import { InterviewOrchestrator } from './interview-orchestrator'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Load environment variables from .env at project root (dev and prod)
dotenv.config()
console.log('🔧 [Main] Environment check:')
console.log('🔧 [Main] ASSEMBLYAI_API_KEY:', process.env.ASSEMBLYAI_API_KEY ? `${process.env.ASSEMBLYAI_API_KEY.substring(0, 10)}...` : 'NOT SET')
console.log('🔧 [Main] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : 'NOT SET')

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let monitor: ProcessMonitor | null = null
let interviewOrchestrator: InterviewOrchestrator | null = null

// Icon path resolution (try multiple possible paths)
function getIconPath(): string | undefined {
  const possiblePaths = app.isPackaged
    ? [
        join(process.resourcesPath, 'icon.png'),
        join(process.resourcesPath, 'resources', 'icon.png')
      ]
    : [
        // Try from compiled main location (out/main/) - use absolute path
        resolve(__dirname, '../../resources/icon.png'),
        // Try from app path
        join(app.getAppPath(), 'resources/icon.png'),
        // Try from project root (if running from project root)
        resolve(process.cwd(), 'resources/icon.png'),
        // Try from crispDesktop directory
        resolve(process.cwd(), 'crispDesktop/resources/icon.png')
      ]

  console.log('🔍 [Icon] Searching for icon in paths:')
  for (const path of possiblePaths) {
    console.log(`  - ${path} ${existsSync(path) ? '✅ EXISTS' : '❌ NOT FOUND'}`)
    if (existsSync(path)) {
      const absolutePath = resolve(path) // Ensure absolute path
      console.log('✅ [Icon] Found icon at:', absolutePath)
      return absolutePath
    }
  }

  console.warn('⚠️ [Icon] Icon not found in any of these paths:', possiblePaths)
  return undefined
}

const iconPath = getIconPath()
let appIcon: Electron.NativeImage | undefined = undefined

if (iconPath) {
  try {
    appIcon = nativeImage.createFromPath(iconPath)
    if (appIcon.isEmpty()) {
      console.warn('⚠️ [Icon] Icon file exists but is empty or invalid')
      appIcon = undefined
    } else {
      const size = appIcon.getSize()
      console.log(`✅ [Icon] Icon loaded successfully: ${size.width}x${size.height} from ${iconPath}`)
    }
  } catch (error) {
    console.error('❌ [Icon] Failed to load icon:', error)
    appIcon = undefined
  }
} else {
  console.error('❌ [Icon] No icon path found - will use default')
}

function createWindow(): void {
  // Main window - full screen for interview interface
  // For Wayland compatibility, try both nativeImage and path string
  const windowIcon = appIcon && !appIcon.isEmpty() ? appIcon : (iconPath || undefined)
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    ...(windowIcon ? { icon: windowIcon } : {}),
    show: false, // Don't show until ready
    fullscreen: false, // Allow fullscreen toggle
    maximizable: true,
    resizable: true,
    // frame: false, // Hide title bar (workaround for Wayland icon issue)
    // autoHideMenuBar: true, // Hide menu bar
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

  // Set icon explicitly for Wayland/GNOME compatibility
  // Try multiple methods as Wayland can be picky
  if (iconPath) {
    // Method 1: Use path string (some Wayland compositors prefer this)
    try {
      mainWindow.setIcon(iconPath)
      console.log('✅ [Icon] Window icon set via path for Wayland:', iconPath)
    } catch (err) {
      console.warn('⚠️ [Icon] Failed to set icon via path:', err)
    }
    
    // Method 2: Use nativeImage (fallback)
    if (appIcon && !appIcon.isEmpty()) {
      try {
        mainWindow.setIcon(appIcon)
        console.log('✅ [Icon] Window icon set via nativeImage for Wayland')
      } catch (err) {
        console.warn('⚠️ [Icon] Failed to set icon via nativeImage:', err)
      }
    }
  }

  // Show and maximize window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.maximize()
    
    // Set icon again after showing (Wayland sometimes needs this)
    // Also try with a small delay as Wayland can be slow to update
    if (iconPath) {
      // Try path string first
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.setIcon(iconPath)
            console.log('✅ [Icon] Icon set after window show (delayed)')
          } catch (err) {
            console.warn('⚠️ [Icon] Failed to set icon after show:', err)
          }
        }
      }, 100)
      
      // Also try nativeImage
      if (appIcon && !appIcon.isEmpty()) {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.setIcon(appIcon)
            } catch (err) {
              // Ignore
            }
          }
        }, 200)
      }
    }
  })

  // Load the UI
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Set icon after page loads (Wayland sometimes needs this)
  mainWindow.webContents.once('did-finish-load', () => {
    if (iconPath && mainWindow && !mainWindow.isDestroyed()) {
      // Try setting icon multiple times with delays
      const setIconAttempts = [0, 100, 300, 500, 1000]
      setIconAttempts.forEach((delay) => {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              // Try path first
              mainWindow.setIcon(iconPath)
              // Also try nativeImage
              if (appIcon && !appIcon.isEmpty()) {
                mainWindow.setIcon(appIcon)
              }
              if (delay === 0) {
                console.log('✅ [Icon] Icon set after page load')
              }
            } catch (err) {
              // Ignore errors
            }
          }
        }, delay)
      })
    }
  })

  // Additional icon setting for Wayland title bar
  // Note: GNOME/Wayland window managers may ignore window icons and use desktop file icons
  // The title bar icon is often controlled by the window manager theme, not the application
  if (process.platform === 'linux' && iconPath) {
    // Try setting icon when window gains focus (sometimes triggers refresh)
    mainWindow.on('focus', () => {
      if (mainWindow && !mainWindow.isDestroyed() && iconPath) {
        setTimeout(() => {
          try {
            mainWindow?.setIcon(iconPath)
            if (appIcon && !appIcon.isEmpty()) {
              mainWindow?.setIcon(appIcon)
            }
          } catch (err) {
            // Ignore
          }
        }, 100)
      }
    })
  }

  // Handle window close - quit the app completely
  mainWindow.on('close', (event) => {
    // On Linux/Windows, quit the app when window is closed
    // This ensures the app doesn't stay running in the background
    if (process.platform !== 'darwin') {
      // Prevent default close behavior
      event.preventDefault()
      
      // Clean up before quitting
      console.log('Window closed, cleaning up and quitting...')
      
      // Stop monitoring first
      monitor?.stop()
      
      // Destroy orchestrator (stops all services)
      interviewOrchestrator?.destroy()
      
      // Unregister global shortcuts
      globalShortcut.unregisterAll()
      
      // Destroy tray if it exists (this is important - tray keeps app alive)
      if (tray) {
        tray.destroy()
        tray = null
      }
      
      // Destroy the window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy()
        mainWindow = null
      }
      
      // Quit the app
      app.quit()
    } else {
      // On macOS, hide the window instead of quitting
      // (macOS apps typically stay running)
      event.preventDefault()
      mainWindow?.hide()
    }
  })
}

function createTray(): void {
  if (!appIcon || appIcon.isEmpty()) {
    console.warn('⚠️ [Tray] Cannot create tray - no valid icon')
    return
  }
  tray = new Tray(appIcon)
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Shakra AI Interview', 
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
        console.log('Quit requested from tray menu, cleaning up...')
        monitor?.stop()
        interviewOrchestrator?.destroy()
        globalShortcut.unregisterAll()
        
        // Destroy tray
        if (tray) {
          tray.destroy()
          tray = null
        }
        
        // Destroy window
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy()
          mainWindow = null
        }
        
        app.quit()
      }
    }
  ])
  
  tray.setToolTip('Shakra AI Interview - Security Monitoring Active')
  tray.setContextMenu(contextMenu)
  
  tray.on('double-click', () => {
    mainWindow?.show()
  })
}

// Create desktop file for Wayland/GNOME compatibility in dev mode
function createDesktopFile(): void {
  if (process.platform !== 'linux' || app.isPackaged) {
    return // Only needed for dev mode on Linux
  }

  if (!iconPath || !existsSync(iconPath)) {
    console.warn('⚠️ [Desktop] Cannot create desktop file - icon not found')
    return
  }

  try {
    const desktopDir = join(homedir(), '.local', 'share', 'applications')
    mkdirSync(desktopDir, { recursive: true })
    
    const desktopFile = join(desktopDir, 'shakra-ai-interview-dev.desktop')
    const execPath = process.execPath
    const iconAbsolutePath = resolve(iconPath)
    
    const desktopContent = `[Desktop Entry]
Name=Shakra AI Interview (Dev)
Comment=AI-powered interview platform with security monitoring
Exec=${execPath}
Icon=${iconAbsolutePath}
Type=Application
Categories=Utility;Development;
StartupNotify=true
StartupWMClass=electron
NoDisplay=false
`
    
    writeFileSync(desktopFile, desktopContent, { mode: 0o755 })
    console.log(`✅ [Desktop] Created desktop file: ${desktopFile}`)
    console.log(`✅ [Desktop] Icon path in desktop file: ${iconAbsolutePath}`)
    
    // Update desktop database (Wayland/GNOME needs this)
    try {
      const { exec } = require('child_process')
      exec('update-desktop-database ~/.local/share/applications', (error: any) => {
        if (error) {
          console.warn('⚠️ [Desktop] Could not update desktop database (non-critical):', error.message)
        } else {
          console.log('✅ [Desktop] Desktop database updated')
        }
      })
    } catch (err) {
      // Ignore - update-desktop-database might not be available
    }
  } catch (error) {
    console.error('❌ [Desktop] Failed to create desktop file:', error)
  }
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.shakra.interview')
  
  // Linux/Wayland specific: Create desktop file for dev mode
  // Wayland/GNOME requires desktop files to show custom icons
  if (process.platform === 'linux' && !app.isPackaged) {
    createDesktopFile()
    
    if (iconPath && existsSync(iconPath)) {
      // Try to set app icon for Wayland
      try {
        app.dock?.setIcon?.(appIcon || iconPath) // macOS only, but harmless
        console.log('✅ [Icon] App icon configured for Linux')
      } catch (err) {
        // Ignore - dock is macOS only
      }
    }
  }

  // Configure session permissions for external API calls
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "connect-src 'self' https://crisp-server-n0r1.onrender.com https://localhost:3001 http://localhost:3001 https://cdn.jsdelivr.net https://storage.googleapis.com; " +
          "img-src 'self' data: https:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://storage.googleapis.com; " +
          "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://storage.googleapis.com; " +
          "style-src 'self' 'unsafe-inline'; " +
          "font-src 'self' data:; " +
          "worker-src 'self' blob: https://cdn.jsdelivr.net;"
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
  monitor = new ProcessMonitor()
  monitor.start()

  // Initialize interview orchestrator
  try {
    interviewOrchestrator = new InterviewOrchestrator()
    await interviewOrchestrator.initialize({
      stt: {
        provider: 'assemblyai',
        apiKey: process.env.ASSEMBLYAI_API_KEY || '',
        sampleRate: 16000,
        language: 'en'
      },
      llm: {
        serverUrl: process.env.SERVER_URL || 'https://crisp-server-n0r1.onrender.com'
      },
      tts: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        voice: 'alloy', // Cheapest voice (all voices same price)
        model: 'tts-1',  // Cheapest model ($15/1M chars vs $30 for tts-1-hd)
        speed: 1.2       // Slightly faster = shorter audio = lower cost
      },
      codeAnalysis: {
        serverUrl: process.env.SERVER_URL || 'https://crisp-server-n0r1.onrender.com'
      }
    })

    // Set up interview event listeners
    interviewOrchestrator.on('askQuestion', (question) => {
      mainWindow?.webContents.send('question-changed', question)
    })

    interviewOrchestrator.on('progressUpdate', (progress) => {
      mainWindow?.webContents.send('progress-update', progress)
    })

    interviewOrchestrator.on('askFollowUp', (followUpText) => {
      console.log('📝 [Main] Forwarding follow-up question to renderer:', followUpText.substring(0, 50))
      mainWindow?.webContents.send('follow-up-asked', followUpText)
    })

    interviewOrchestrator.on('presentCodingProblem', (problem) => {
      mainWindow?.webContents.send('coding-problem-changed', problem)
    })

    interviewOrchestrator.on('evaluation', (evaluation) => {
      mainWindow?.webContents.send('evaluation', evaluation)
    })

    interviewOrchestrator.on('codeAnalysisComplete', (analysis) => {
      mainWindow?.webContents.send('code-analysis', analysis)
    })

    interviewOrchestrator.on('interviewCompleted', (results) => {
      mainWindow?.webContents.send('interview-completed', results)
    })

    interviewOrchestrator.on('finalEvaluationReady', (payload) => {
      // Note: Vision security warnings are now handled entirely in renderer
      // Renderer will add them to the payload before sending to backend
      // No need to get them from orchestrator anymore
      console.log('📊 [Main] Final evaluation ready - renderer will add vision warnings')
      
      mainWindow?.webContents.send('final-evaluation-ready', payload)
    })

    console.log('✓ Interview orchestrator initialized')
  } catch (error) {
    console.error('Failed to initialize interview orchestrator:', error)
  }

  // Set up interview IPC handlers
  if (interviewOrchestrator) {
    // Forward high-level interview state changes to renderer
    interviewOrchestrator.on('stateChanged', (stateChange: any) => {
      try {
        mainWindow?.webContents.send('interview-state-change', stateChange.to)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send interview-state-change:', err.message)
      }
    })

    // Forward STT listening state
    interviewOrchestrator.on('sttConnected', () => {
      try {
        console.log('🎤 [Main] STT connected, setting listening to true')
        mainWindow?.webContents.send('listening-state-change', true)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send listening-state-change:', err.message)
      }
    })
    interviewOrchestrator.on('sttDisconnected', () => {
      try {
        console.log('🎤 [Main] STT disconnected, setting listening to false')
        mainWindow?.webContents.send('listening-state-change', false)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send listening-state-change:', err.message)
      }
    })

    interviewOrchestrator.on('micPauseStateChanged', (isListening: boolean) => {
      try {
        console.log('🎤 [Main] Mic pause state changed, listening:', isListening)
        mainWindow?.webContents.send('listening-state-change', isListening)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to forward mic pause state change:', err.message)
      }
    })

    // Forward interview state changes to control listening
    interviewOrchestrator.on('stateChanged', (payload: any) => {
      try {
        console.log('🎤 [Main] State changed:', payload.to)
        // Set listening to true when waiting for user input
        if (payload.to === 'waiting_for_answer' || 
            payload.to === 'monitoring_code' || 
            payload.to === 'coding_problem' ||
            payload.to === 'waiting_for_approach' ||
            payload.to === 'follow_up') {
          console.log('🎤 [Main] Setting listening to true for', payload.to, 'state')
          mainWindow?.webContents.send('listening-state-change', true)
        } else if (payload.to === 'evaluating_answer' || 
                   payload.to === 'evaluating_approach' ||
                   payload.to === 'theoretical_question') {
          console.log('🎤 [Main] Setting listening to false for', payload.to, 'state')
          mainWindow?.webContents.send('listening-state-change', false)
        }
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send state-based listening change:', err.message)
      }
    })

    // Forward TTS speaking state and manage listening state during TTS
    interviewOrchestrator.on('speakingStarted', () => {
      try {
        console.log('🎤 [Main] TTS started - setting speaking:true, listening:false')
        mainWindow?.webContents.send('speaking-state-change', true)
        // Turn off listening indicator when TTS starts (mic is paused)
        mainWindow?.webContents.send('listening-state-change', false)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send speaking-state-change:', err.message)
      }
    })
    interviewOrchestrator.on('speakingCompleted', () => {
      try {
        console.log('🎤 [Main] TTS completed - setting speaking:false')
        mainWindow?.webContents.send('speaking-state-change', false)
        // Re-enable listening indicator based on current state
        if (interviewOrchestrator) {
          const currentState = interviewOrchestrator.getCurrentState()
          // States where we should be actively listening for user input
          const shouldListen = currentState === 'waiting_for_answer' || 
                              currentState === 'monitoring_code' || 
                              currentState === 'coding_problem' ||
                              currentState === 'waiting_for_approach' ||
                              currentState === 'follow_up'
          if (shouldListen) {
            console.log('🎤 [Main] Restoring listening state after TTS for state:', currentState)
            mainWindow?.webContents.send('listening-state-change', true)
          } else {
            console.log('🎤 [Main] Not restoring listening for state:', currentState)
          }
        }
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send speaking-state-change:', err.message)
      }
    })

    // Notify renderer when audio capture is required (to start microphone streaming)
    interviewOrchestrator.on('audioCaptureRequired', () => {
      try {
        mainWindow?.webContents.send('audio-capture-required')
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send audio-capture-required:', err.message)
      }
    })
  }

  // Receive audio chunks from renderer and forward to STT
  ipcMain.on('audio-chunk', (_event, data: Uint8Array) => {
    try {
      if (interviewOrchestrator) {
        interviewOrchestrator.streamAudio(Buffer.from(data))
      }
    } catch (e: unknown) {
      const err = e as Error
      console.error('Failed to stream audio chunk:', err.message)
    }
  })

  
  // Check for unfinished interview
  ipcMain.handle('check-unfinished-interview', async () => {
    try {
      if (!interviewOrchestrator) {
        return { hasUnfinished: false }
      }
      
      const sessionInfo = interviewOrchestrator.getSessionInfo()
      return {
        hasUnfinished: !!sessionInfo,
        sessionInfo
      }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to check unfinished interview:', err)
      return { hasUnfinished: false, error: err.message }
    }
  })

  // Clear unfinished interview
  ipcMain.handle('clear-unfinished-interview', async () => {
    try {
      if (!interviewOrchestrator) {
        return { success: true }
      }
      
      interviewOrchestrator.clearSession()
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to clear unfinished interview:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('start-interview', async (_event, interviewData) => {
    try {
      if (!interviewOrchestrator) {
        throw new Error('Interview orchestrator not initialized')
      }
      
      await interviewOrchestrator.startInterview(interviewData)
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to start interview:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('analyze-code', async (_event, codeData) => {
    try {
      if (!interviewOrchestrator) {
        throw new Error('Interview orchestrator not initialized')
      }
      
      const analysis = await interviewOrchestrator.analyzeCode(codeData)
      return { success: true, analysis }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to analyze code:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('submit-solution', async (_event, code: string, isTimeout: boolean = false, timeComplexity?: string, spaceComplexity?: string) => {
    try {
      if (!interviewOrchestrator) {
        throw new Error('Interview orchestrator not initialized')
      }
      
      const result = await interviewOrchestrator.submitCodingSolution(code, isTimeout, timeComplexity, spaceComplexity)
      return result
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to submit solution:', err)
      return { success: false, error: err.message, feedback: '', hasNextProblem: false }
    }
  })

  ipcMain.handle('pause-interview', async () => {
    try {
      if (interviewOrchestrator) {
        await interviewOrchestrator.pauseInterview()
      }
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to pause interview:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('resume-interview', async () => {
    try {
      if (interviewOrchestrator) {
        await interviewOrchestrator.resumeInterview()
      }
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to resume interview:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('stop-interview', async () => {
    try {
      if (interviewOrchestrator) {
        await interviewOrchestrator.stopInterview()
      }
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to stop interview:', err)
      return { success: false, error: err.message }
    }
  })

  // Handle security warning TTS requests from renderer
  // This is lightweight - just a string message, not heavy JSON
  ipcMain.on('speak-security-warning', (_event, message: string) => {
    try {
      if (interviewOrchestrator && message && typeof message === 'string') {
        // Fire and forget - don't block IPC, TTS will handle its own queue
        interviewOrchestrator.speakSecurityWarning(message).catch(err => {
          console.error('⚠️ [Main] TTS error for security warning:', err)
        })
      }
    } catch (error) {
      console.error('⚠️ [Main] Failed to handle security warning TTS:', error)
    }
  })

  // Note: Removed continuous vision-security-warnings IPC handler
  // Logging is now handled entirely in renderer and sent to backend at interview end

  // Generate temporary token for STT authentication
  ipcMain.handle('get-stt-token', async () => {
    const maxRetries = 3
    const retryDelay = 2000 // 2 seconds
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { AssemblyAI } = await import('assemblyai')
        
        // Check if API key is set
        const apiKey = process.env.ASSEMBLYAI_API_KEY || ''
        if (!apiKey) {
          console.error('🎤 [STT] ASSEMBLYAI_API_KEY is not set')
          return { 
            success: false, 
            error: 'ASSEMBLYAI_API_KEY environment variable is not configured' 
          }
        }
        
        const client = new AssemblyAI({ apiKey })
        
        console.log(`🎤 [STT] Attempting to generate temporary token (attempt ${attempt}/${maxRetries})...`)
        
        // Generate token valid for 5 minutes (300 seconds)
        // Add timeout wrapper
        const tokenPromise = client.streaming.createTemporaryToken({ 
          expires_in_seconds: 300 
        })
        
        // Add 15 second timeout
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Token generation timeout after 15 seconds')), 15000)
        )
        
        const token = await Promise.race([tokenPromise, timeoutPromise]) as string
        
        console.log('🎤 [STT] Successfully generated temporary token')
        return { success: true, token }
      } catch (error: unknown) {
        const err = error as Error
        const isLastAttempt = attempt === maxRetries
        
        // Check if it's a network/connection error
        const isNetworkError = err.message.includes('timeout') || 
                              err.message.includes('ECONNREFUSED') ||
                              err.message.includes('ENOTFOUND') ||
                              err.message.includes('UND_ERR_CONNECT_TIMEOUT')
        
        if (isNetworkError && !isLastAttempt) {
          console.warn(`🎤 [STT] Network error on attempt ${attempt}/${maxRetries}, retrying in ${retryDelay}ms...`, err.message)
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt)) // Exponential backoff
          continue
        }
        
        // If last attempt or non-network error, return error
        console.error(`🎤 [STT] Failed to generate token (attempt ${attempt}/${maxRetries}):`, err.message)
        
        // Provide user-friendly error message
        let errorMessage = err.message
        if (isNetworkError) {
          errorMessage = 'Unable to connect to AssemblyAI service. Please check your internet connection and try again.'
        } else if (err.message.includes('API key')) {
          errorMessage = 'Invalid AssemblyAI API key. Please check your configuration.'
        }
        
        return { 
          success: false, 
          error: errorMessage,
          details: isLastAttempt ? err.message : undefined
        }
      }
    }
    
    // Should never reach here, but just in case
    return { 
      success: false, 
      error: 'Failed to generate STT token after multiple attempts' 
    }
  })

  // Update STT service with new token
  ipcMain.handle('update-stt-token', async (_event, token: string) => {
    try {
      if (!interviewOrchestrator) {
        throw new Error('Interview orchestrator not initialized')
      }
      
      await interviewOrchestrator.updateSTTToken(token)
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to update STT token:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('request-audio-permissions', async () => {
    try {
      // Request microphone permissions
      const { systemPreferences } = require('electron')
      
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('microphone')
        if (status !== 'granted') {
          await systemPreferences.askForMediaAccess('microphone')
        }
      }
      
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to request audio permissions:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('request-camera-permissions', async () => {
    try {
      // Request camera permissions
      const { systemPreferences } = require('electron')
      
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('camera')
        if (status !== 'granted') {
          await systemPreferences.askForMediaAccess('camera')
        }
      }
      
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to request camera permissions:', err)
      return { success: false, error: err.message }
    }
  })

  // Note: Removed vision-security-data IPC handler
  // Renderer no longer sends continuous security data to main process
  // This was causing IPC spam and blocking audio chunks
  // TTS is now triggered via speak-security-warning when alerts fire
  // Logging stays in renderer and is sent to backend at interview end

  // Handle marking payload as sent (allows clearing conversation data)
  ipcMain.handle('mark-payload-sent', async () => {
    try {
      if (!interviewOrchestrator) {
        return { success: false, error: 'Interview orchestrator not initialized' }
      }
      interviewOrchestrator.markPayloadSent()
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to mark payload as sent:', err)
      return { success: false, error: err.message }
    }
  })




  console.log('✓ Security Agent started')
})

// macOS - keep app running
app.on('window-all-closed', () => {
  // On Windows/Linux, quit when all windows are closed
  // This is a fallback in case the window close handler doesn't fire
  if (process.platform !== 'darwin') {
    console.log('All windows closed, cleaning up and quitting...')
    monitor?.stop()
    interviewOrchestrator?.destroy()
    globalShortcut.unregisterAll()
    
    // Destroy tray if it exists
    if (tray) {
      tray.destroy()
      tray = null
    }
    
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Cleanup on app quit
app.on('before-quit', (event) => {
  console.log('Cleaning up resources before quit...')
  
  // Stop all monitoring and services
  globalShortcut.unregisterAll()
  monitor?.stop()
  interviewOrchestrator?.destroy()
  
  // Destroy tray if it exists
  if (tray) {
    tray.destroy()
    tray = null
  }
  
  // Destroy main window if it exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = null
  }
})

// Handle app termination
process.on('SIGINT', () => {
  console.log('Received SIGINT, cleaning up...')
  globalShortcut.unregisterAll()
  monitor?.stop()
  interviewOrchestrator?.destroy()
  
  // Destroy tray if it exists
  if (tray) {
    tray.destroy()
    tray = null
  }
  
  // Destroy main window if it exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = null
  }
  
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up...')
  globalShortcut.unregisterAll()
  monitor?.stop()
  interviewOrchestrator?.destroy()
  
  // Destroy tray if it exists
  if (tray) {
    tray.destroy()
    tray = null
  }
  
  // Destroy main window if it exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = null
  }
  
  process.exit(0)
})