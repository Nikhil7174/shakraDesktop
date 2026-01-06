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
      llm: {
        serverUrl: config.serverUrl
      },
      codeAnalysis: {
        serverUrl: config.serverUrl
      },
      livekit: config.livekitUrl && config.livekitApiKey && config.livekitApiSecret ? {
        url: config.livekitUrl,
        apiKey: config.livekitApiKey,
        apiSecret: config.livekitApiSecret,
        openaiApiKey: config.openaiApiKey,
        sttProvider: config.livekitSttProvider || 'openai',
        sttApiKey: config.livekitSttApiKey,
        llmModel: config.livekitLlmModel || 'gpt-4',
        ttsVoice: config.livekitTtsVoice || 'alloy',
        ttsModel: config.livekitTtsModel || 'tts-1',
      } : undefined
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
                   payload.to === 'intro' ||
                   payload.to === 'theoretical_question') {
          console.log('🎤 [Main] Setting listening to false for', payload.to, 'state')
          this.windowService.getMainWindow()?.webContents.send('listening-state-change', false)
        }
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send state-based listening change:', err.message)
      }
    })

    // Forward user speaking state
    orchestrator.on('userSpeakingStarted', () => {
      try {
        console.log('🎤 [Main] User started speaking - setting userSpeaking:true')
        this.windowService.getMainWindow()?.webContents.send('user-speaking-state-change', true)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send user-speaking-state-change:', err.message)
      }
    })

    orchestrator.on('userSpeakingEnded', () => {
      try {
        console.log('🎤 [Main] User stopped speaking - setting userSpeaking:false')
        this.windowService.getMainWindow()?.webContents.send('user-speaking-state-change', false)
      } catch (e: unknown) {
        const err = e as Error
        console.error('Failed to send user-speaking-state-change:', err.message)
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
    // Audio chunk handling removed - LiveKit handles audio directly in renderer
    // No need for manual audio forwarding
    ipcMain.on('audio-chunk', (_event, data: Uint8Array) => {
      // LiveKit handles audio streaming automatically, this is kept for backwards compatibility
      console.log('🎤 [Main] Audio chunk received (LiveKit handles this automatically)')
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
        await this.orchestrator.clearSession()
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

    ipcMain.handle('get-livekit-token', async (_event, roomName: string, participantName: string = 'candidate') => {
      try {
        const { AccessToken } = await import('livekit-server-sdk')
        const config = await this.configService.getConfig()
        
        // Extract only serializable values from config
        const apiKey = (config.livekitApiKey || '').trim()
        const apiSecret = (config.livekitApiSecret || '').trim()
        const livekitUrl = (config.livekitUrl || '').trim()
        
        if (!apiKey || !apiSecret) {
          console.error('🎤 [LiveKit] LiveKit API credentials not configured')
          console.error('🎤 [LiveKit] API Key present:', !!apiKey, 'Secret present:', !!apiSecret)
          return JSON.parse(JSON.stringify({ 
            success: false, 
            error: 'LiveKit API credentials not configured.' 
          }))
        }
        
        // Validate API key format (LiveKit API keys typically start with specific prefixes)
        if (apiKey.length < 10 || apiSecret.length < 10) {
          console.error('🎤 [LiveKit] API credentials appear to be too short')
          return JSON.parse(JSON.stringify({ 
            success: false, 
            error: 'LiveKit API credentials appear to be invalid (too short).' 
          }))
        }

        // Ensure roomName and participantName are strings
        const safeRoomName = String(roomName || `interview-${Date.now()}`)
        const safeParticipantName = String(participantName || 'candidate')

        const token = new AccessToken(apiKey, apiSecret, {
          identity: safeParticipantName,
        })

        token.addGrant({
          room: safeRoomName,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        })

        // toJwt() is async and returns a Promise
        const jwt = await token.toJwt()
        
        // Validate token format (should be a JWT string)
        if (!jwt || typeof jwt !== 'string') {
          console.error('🎤 [LiveKit] Token generation failed - jwt type:', typeof jwt, 'value:', jwt)
          throw new Error('Invalid token format generated')
        }
        
        // Check JWT structure (should have 3 parts separated by dots)
        const jwtString = String(jwt)
        const jwtParts = jwtString.split('.')
        if (jwtParts.length !== 3) {
          console.error('🎤 [LiveKit] Invalid JWT structure - parts:', jwtParts.length, 'token preview:', jwtString.substring(0, 100))
          throw new Error(`Invalid JWT structure: expected 3 parts, got ${jwtParts.length}`)
        }
        
        // Ensure URL is properly formatted with wss:// protocol
        let formattedUrl = String(livekitUrl || '')
        // If no URL provided, use default
        if (!formattedUrl) {
          formattedUrl = 'wss://shakra-ypfk18zl.livekit.cloud'
        } else {
          // Ensure URL has wss:// protocol
          if (!formattedUrl.startsWith('wss://') && !formattedUrl.startsWith('ws://')) {
            formattedUrl = `wss://${formattedUrl.replace(/^(https?):\/\//, '')}`
          } else if (formattedUrl.startsWith('https://')) {
            formattedUrl = formattedUrl.replace('https://', 'wss://')
          } else if (formattedUrl.startsWith('http://')) {
            formattedUrl = formattedUrl.replace('http://', 'ws://')
          }
        }
        
        console.log('🎤 [LiveKit] Successfully generated room token for:', safeRoomName)
        console.log('🎤 [LiveKit] Token length:', jwtString.length, 'URL:', formattedUrl)
        console.log('🎤 [LiveKit] Token preview:', jwtString.substring(0, 50) + '...')
        console.log('🎤 [LiveKit] API Key:', apiKey.substring(0, 10) + '...', 'Secret:', apiSecret.substring(0, 10) + '...')
        
        // Ensure all return values are serializable by using JSON.parse/stringify
        const result = {
          success: true,
          token: String(jwt),
          url: String(formattedUrl),
          roomName: String(safeRoomName)
        }
        
        // Double-check serializability
        return JSON.parse(JSON.stringify(result))
      } catch (error: unknown) {
        const err = error as Error
        const errorMessage = err?.message || String(error) || 'Unknown error'
        console.error('🎤 [LiveKit] Failed to generate token:', errorMessage)
        
        // Ensure error response is serializable
        return JSON.parse(JSON.stringify({ 
          success: false, 
          error: errorMessage 
        }))
      }
    })

    // Keep old handler for backwards compatibility, but it now returns LiveKit token
    ipcMain.handle('get-stt-token', async () => {
      // For backwards compatibility, generate a LiveKit token with a default room name
      const roomName = `interview-${Date.now()}`
      try {
        const { AccessToken } = await import('livekit-server-sdk')
        const config = await this.configService.getConfig()
        
        if (!config.livekitApiKey || !config.livekitApiSecret) {
          return { success: false, error: 'LiveKit API credentials not configured.' }
        }

        const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
          identity: 'candidate',
        })

        token.addGrant({
          room: roomName,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        })

        const jwt = token.toJwt()
        return { success: true, token: jwt, url: config.livekitUrl }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('update-stt-token', async (_event, token: string) => {
      // This is no longer needed with LiveKit, but keep for backwards compatibility
      console.warn('🎤 [LiveKit] update-stt-token is deprecated, tokens are generated per-room')
      return { success: true }
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

