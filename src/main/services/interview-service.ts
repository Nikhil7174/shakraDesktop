import { ipcMain } from 'electron'
import { Service } from './lifecycle'
import { InterviewOrchestrator } from '../interview-orchestrator'
import { WindowService } from './window-service'
import { getConfigService, ConfigService } from './config-service'

export class InterviewService implements Service {
  name = 'interview'
  private orchestrator: InterviewOrchestrator | null = null
  private windowService: WindowService
  private configService: ConfigService

  constructor(windowService: WindowService) {
    this.windowService = windowService
    this.configService = getConfigService()
  }

  async initialize(): Promise<void> {
    const config = this.configService.getConfigSync()
    console.log('🔧 [Interview] Initializing orchestrator with config from:', config.lastFetched ? 'server' : 'env/local')
    
    this.orchestrator = new InterviewOrchestrator()
    await this.initializeOrchestratorWithConfig(config)
    
    this.setupEventListeners()
    this.setupIpcHandlers()
    
    console.log('✓ Interview orchestrator initialized')
  }

  async shutdown(): Promise<void> {
    this.orchestrator?.destroy()
    this.orchestrator = null
  }

  private async initializeOrchestratorWithConfig(config: any): Promise<void> {
    if (!this.orchestrator) return

    await this.orchestrator.initialize({
      stt: {
        provider: 'assemblyai',
        apiKey: config.assemblyaiApiKey,
        sampleRate: 16000,
        language: 'en'
      },
      llm: {
        serverUrl: config.serverUrl
      },
      tts: {
        provider: 'openai',
        apiKey: config.openaiApiKey,
        voice: 'alloy',
        model: 'tts-1',
        speed: 1.2
      },
      codeAnalysis: {
        serverUrl: config.serverUrl
      }
    })
  }

  private setupEventListeners() {
    if (!this.orchestrator) return
    const orchestrator = this.orchestrator

    orchestrator.on('askQuestion', (question) => {
      this.windowService.getMainWindow()?.webContents.send('question-changed', question)
    })

    orchestrator.on('progressUpdate', (progress) => {
      this.windowService.getMainWindow()?.webContents.send('progress-update', progress)
    })

    orchestrator.on('askFollowUp', (followUpText) => {
      console.log('📝 [Main] Forwarding follow-up question to renderer:', followUpText.substring(0, 50))
      this.windowService.getMainWindow()?.webContents.send('follow-up-asked', followUpText)
    })

    orchestrator.on('presentCodingProblem', (problem) => {
      this.windowService.getMainWindow()?.webContents.send('coding-problem-changed', problem)
    })

    orchestrator.on('evaluation', (evaluation) => {
      this.windowService.getMainWindow()?.webContents.send('evaluation', evaluation)
    })

    orchestrator.on('codeAnalysisComplete', (analysis) => {
      this.windowService.getMainWindow()?.webContents.send('code-analysis', analysis)
    })

    orchestrator.on('interviewCompleted', (results) => {
      this.windowService.getMainWindow()?.webContents.send('interview-completed', results)
    })

    orchestrator.on('finalEvaluationReady', (payload) => {
      console.log('📊 [Main] Final evaluation ready - renderer will add vision warnings')
      this.windowService.getMainWindow()?.webContents.send('final-evaluation-ready', payload)
    })

    orchestrator.on('requestSkipConfirmation', () => {
      console.log('🎯 [Main] Requesting skip confirmation from renderer')
      const mainWindow = this.windowService.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skip-question-request')
      }
    })

    // Forward high-level interview state changes to renderer
    orchestrator.on('stateChanged', (stateChange: any) => {
      try {
        this.windowService.getMainWindow()?.webContents.send('interview-state-change', stateChange.to)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send interview-state-change:', err.message)
      }
    })

    // Forward STT listening state
    orchestrator.on('sttConnected', () => {
      try {
        console.log('🎤 [Main] STT connected, setting listening to true')
        this.windowService.getMainWindow()?.webContents.send('listening-state-change', true)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send listening-state-change:', err.message)
      }
    })
    
    orchestrator.on('sttDisconnected', () => {
      try {
        console.log('🎤 [Main] STT disconnected, setting listening to false')
        this.windowService.getMainWindow()?.webContents.send('listening-state-change', false)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send listening-state-change:', err.message)
      }
    })

    orchestrator.on('micPauseStateChanged', (isListening: boolean) => {
      try {
        console.log('🎤 [Main] Mic pause state changed, listening:', isListening)
        this.windowService.getMainWindow()?.webContents.send('listening-state-change', isListening)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to forward mic pause state change:', err.message)
      }
    })

    // Forward interview state changes to control listening
    orchestrator.on('stateChanged', (payload: any) => {
      try {
        console.log('🎤 [Main] State changed:', payload.to)
        // Set listening to true when waiting for user input
        if (payload.to === 'waiting_for_answer' || 
            payload.to === 'monitoring_code' || 
            payload.to === 'coding_problem' ||
            payload.to === 'waiting_for_approach' ||
            payload.to === 'follow_up') {
          console.log('🎤 [Main] Setting listening to true for', payload.to, 'state')
          this.windowService.getMainWindow()?.webContents.send('listening-state-change', true)
        } else if (payload.to === 'evaluating_answer' || 
                   payload.to === 'evaluating_approach' ||
                   payload.to === 'theoretical_question') {
          console.log('🎤 [Main] Setting listening to false for', payload.to, 'state')
          this.windowService.getMainWindow()?.webContents.send('listening-state-change', false)
        }
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send state-based listening change:', err.message)
      }
    })

    // Forward TTS speaking state and manage listening state during TTS
    orchestrator.on('speakingStarted', () => {
      try {
        console.log('🎤 [Main] TTS started - setting speaking:true, listening:false')
        this.windowService.getMainWindow()?.webContents.send('speaking-state-change', true)
        // Turn off listening indicator when TTS starts (mic is paused)
        this.windowService.getMainWindow()?.webContents.send('listening-state-change', false)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send speaking-state-change:', err.message)
      }
    })
    
    orchestrator.on('speakingCompleted', () => {
      try {
        console.log('🎤 [Main] TTS completed - setting speaking:false')
        this.windowService.getMainWindow()?.webContents.send('speaking-state-change', false)
        // Re-enable listening indicator based on current state
        if (this.orchestrator) {
          const currentState = this.orchestrator.getCurrentState()
          // States where we should be actively listening for user input
          const shouldListen = currentState === 'waiting_for_answer' || 
                              currentState === 'monitoring_code' || 
                              currentState === 'coding_problem' ||
                              currentState === 'waiting_for_approach' ||
                              currentState === 'follow_up'
          if (shouldListen) {
            console.log('🎤 [Main] Restoring listening state after TTS for state:', currentState)
            this.windowService.getMainWindow()?.webContents.send('listening-state-change', true)
          } else {
            console.log('🎤 [Main] Not restoring listening for state:', currentState)
          }
        }
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send speaking-state-change:', err.message)
      }
    })

    orchestrator.on('audioCaptureRequired', () => {
      try {
        this.windowService.getMainWindow()?.webContents.send('audio-capture-required')
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send audio-capture-required:', err.message)
      }
    })
  }

  private setupIpcHandlers() {
    ipcMain.on('audio-chunk', (_event, data: Uint8Array) => {
      try {
        this.orchestrator?.streamAudio(Buffer.from(data))
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to stream audio chunk:', err.message)
      }
    })

    ipcMain.handle('check-unfinished-interview', async () => {
      try {
        if (!this.orchestrator) return { hasUnfinished: false }
        const sessionInfo = this.orchestrator.getSessionInfo()
        return { hasUnfinished: !!sessionInfo, sessionInfo }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to check unfinished interview:', err)
        return { hasUnfinished: false, error: err.message }
      }
    })

    ipcMain.handle('clear-unfinished-interview', async () => {
      try {
        if (!this.orchestrator) return { success: true }
        this.orchestrator.clearSession()
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to clear unfinished interview:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('start-interview', async (_event, interviewData) => {
      try {
        if (!this.orchestrator) throw new Error('Interview orchestrator not initialized')
        await this.orchestrator.startInterview(interviewData)
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to start interview:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('analyze-code', async (_event, codeData) => {
      try {
        if (!this.orchestrator) throw new Error('Interview orchestrator not initialized')
        const analysis = await this.orchestrator.analyzeCode(codeData)
        return { success: true, analysis }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to analyze code:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('submit-solution', async (_event, code: string, isTimeout: boolean = false, timeComplexity?: string, spaceComplexity?: string) => {
      try {
        if (!this.orchestrator) throw new Error('Interview orchestrator not initialized')
        return await this.orchestrator.submitCodingSolution(code, isTimeout, timeComplexity, spaceComplexity)
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to submit solution:', err)
        return { success: false, error: err.message, feedback: '', hasNextProblem: false }
      }
    })

    ipcMain.handle('confirm-skip-question', async (_event, confirmed: boolean) => {
      try {
        this.orchestrator?.setSkipConfirmationResult(confirmed)
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to confirm skip question:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('pause-interview', async () => {
      try {
        await this.orchestrator?.pauseInterview()
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to pause interview:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('resume-interview', async () => {
      try {
        await this.orchestrator?.resumeInterview()
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to resume interview:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('stop-interview', async () => {
      try {
        await this.orchestrator?.stopInterview()
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to stop interview:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.on('speak-security-warning', (_event, message: string) => {
      try {
        if (this.orchestrator && message && typeof message === 'string') {
          this.orchestrator.speakSecurityWarning(message).catch(err => {
            console.error('⚠️ [Main] TTS error for security warning:', err)
          })
        }
      } catch (error) {
        console.error('⚠️ [Main] Failed to handle security warning TTS:', error)
      }
    })

    ipcMain.handle('mark-payload-sent', async () => {
      try {
        if (!this.orchestrator) return { success: false, error: 'Interview orchestrator not initialized' }
        this.orchestrator.markPayloadSent()
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to mark payload as sent:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('get-stt-token', async () => {
      // Logic from index.ts
      const maxRetries = 3
      const retryDelay = 2000 
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const { AssemblyAI } = await import('assemblyai')
          
          const config = await this.configService.getConfig()
          const apiKey = config.assemblyaiApiKey
          if (!apiKey) {
            console.error('🎤 [STT] ASSEMBLYAI_API_KEY is not set')
            return { success: false, error: 'ASSEMBLYAI_API_KEY is not configured.' }
          }
          
          const client = new AssemblyAI({ apiKey })
          console.log(`🎤 [STT] Attempting to generate temporary token (attempt ${attempt}/${maxRetries})...`)
          
          const tokenPromise = client.streaming.createTemporaryToken({ expires_in_seconds: 300 })
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Token generation timeout after 15 seconds')), 15000))
          
          const token = await Promise.race([tokenPromise, timeoutPromise]) as string
          console.log('🎤 [STT] Successfully generated temporary token')
          return { success: true, token }
        } catch (error: unknown) {
          const err = error as Error
          const isNetworkError = err.message.includes('timeout') || err.message.includes('ECONNREFUSED')
          
          if (isNetworkError && attempt < maxRetries) {
            console.warn(`🎤 [STT] Network error, retrying...`, err.message)
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt))
            continue
          }
          
          console.error(`🎤 [STT] Failed to generate token:`, err.message)
          return { success: false, error: err.message }
        }
      }
      return { success: false, error: 'Failed to generate STT token' }
    })

    ipcMain.handle('update-stt-token', async (_event, token: string) => {
      try {
        if (!this.orchestrator) throw new Error('Interview orchestrator not initialized')
        await this.orchestrator.updateSTTToken(token)
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        console.error('Failed to update STT token:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('request-audio-permissions', async () => {
      try {
        const { systemPreferences } = require('electron')
        if (process.platform === 'darwin') {
          const status = systemPreferences.getMediaAccessStatus('microphone')
          if (status !== 'granted') await systemPreferences.askForMediaAccess('microphone')
        }
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('request-camera-permissions', async () => {
      try {
        const { systemPreferences } = require('electron')
        if (process.platform === 'darwin') {
          const status = systemPreferences.getMediaAccessStatus('camera')
          if (status !== 'granted') await systemPreferences.askForMediaAccess('camera')
        }
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })

    // Config management handlers that trigger orchestrator updates
    ipcMain.handle('set-auth-token', async (_event, token: string | null) => {
      try {
        this.configService.setAuthToken(token)
        
        if (token) {
          setTimeout(async () => {
            try {
              const config = await this.configService.getConfig()
              if (config.lastFetched) {
                await this.initializeOrchestratorWithConfig(config)
                console.log('✅ [Main] Orchestrator reinitialized with fetched config')
              }
            } catch (err) {
              console.warn('⚠️ [Main] Failed to reinitialize with fetched config:', err)
            }
          }, 1000)
        }
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('fetch-config', async (_event, authToken: string) => {
      try {
        const config = await this.configService.fetchFromServer(authToken)
        await this.initializeOrchestratorWithConfig(config)
        return { success: true, config }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('get-config', async () => {
      try {
        const config = await this.configService.getConfig()
        return { success: true, config }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('refresh-config', async (_event, authToken: string) => {
      try {
        const config = await this.configService.refresh(authToken)
        await this.initializeOrchestratorWithConfig(config)
        return { success: true, config }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })
  }
}

