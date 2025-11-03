import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, session } from 'electron'
import * as dotenv from 'dotenv'
import { join } from 'path'
import { WebSocketServer } from './websocket-server'
import { ProcessMonitor } from './process-monitor'
import { InterviewOrchestrator } from './interview-orchestrator'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProcessStatsData } from '../shared/types'

// Load environment variables from .env at project root (dev and prod)
dotenv.config()
console.log('🔧 [Main] Environment check:')
console.log('🔧 [Main] ASSEMBLYAI_API_KEY:', process.env.ASSEMBLYAI_API_KEY ? `${process.env.ASSEMBLYAI_API_KEY.substring(0, 10)}...` : 'NOT SET')
console.log('🔧 [Main] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : 'NOT SET')

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let wsServer: WebSocketServer | null = null
let monitor: ProcessMonitor | null = null
let interviewOrchestrator: InterviewOrchestrator | null = null

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

app.whenReady().then(async () => {
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
        serverUrl: process.env.SERVER_URL || 'http://localhost:3001'
      },
      tts: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        voice: 'alloy', // Cheapest voice (all voices same price)
        model: 'tts-1',  // Cheapest model ($15/1M chars vs $30 for tts-1-hd)
        speed: 1.2       // Slightly faster = shorter audio = lower cost
      },
      codeAnalysis: {
        serverUrl: process.env.SERVER_URL || 'http://localhost:3001'
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

    // Forward interview state changes to control listening
    interviewOrchestrator.on('stateChanged', (payload: any) => {
      try {
        console.log('🎤 [Main] State changed:', payload.to)
        // Set listening to true when waiting for answer or monitoring code
        if (payload.to === 'waiting_for_answer' || payload.to === 'monitoring_code' || payload.to === 'coding_problem') {
          console.log('🎤 [Main] Setting listening to true for', payload.to, 'state')
          mainWindow?.webContents.send('listening-state-change', true)
        } else if (payload.to === 'evaluating_answer' || payload.to === 'theoretical_question') {
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
          const shouldListen = currentState === 'waiting_for_answer' || 
                              currentState === 'monitoring_code' || 
                              currentState === 'coding_problem'
          if (shouldListen) {
            console.log('🎤 [Main] Restoring listening state after TTS for state:', currentState)
            mainWindow?.webContents.send('listening-state-change', true)
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

  ipcMain.handle('submit-solution', async (_event, code: string) => {
    try {
      if (!interviewOrchestrator) {
        throw new Error('Interview orchestrator not initialized')
      }
      
      const result = await interviewOrchestrator.submitCodingSolution(code)
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

  // Generate temporary token for STT authentication
  ipcMain.handle('get-stt-token', async () => {
    try {
      const { AssemblyAI } = await import('assemblyai')
      const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY || '' })
      
      // Generate token valid for 5 minutes (300 seconds)
      const token = await client.streaming.createTemporaryToken({ 
        expires_in_seconds: 300 
      })
      
      console.log('🎤 [STT] Generated temporary token')
      return { success: true, token }
    } catch (error: unknown) {
      const err = error as Error
      console.error('Failed to generate STT token:', err)
      return { success: false, error: err.message }
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
  interviewOrchestrator?.destroy()
})

// Handle app termination
process.on('SIGINT', () => {
  console.log('Received SIGINT, cleaning up...')
  wsServer?.stop()
  monitor?.stop()
  interviewOrchestrator?.destroy()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up...')
  wsServer?.stop()
  monitor?.stop()
  interviewOrchestrator?.destroy()
  process.exit(0)
})