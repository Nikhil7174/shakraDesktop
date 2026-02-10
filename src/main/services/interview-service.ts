import { ipcMain } from 'electron'
import { Service } from './lifecycle'
import { WindowService } from './window-service'
import { getConfigService, ConfigService } from './config-service'

/**
 * Simplified Interview Service - Thin Client
 * 
 * The orchestrator and all interview logic now runs on the server.
 * This service just handles IPC communication between renderer and server.
 */
export class InterviewService implements Service {
  name = 'interview'
  private windowService: WindowService
  private configService: ConfigService

  constructor(windowService: WindowService) {
    this.windowService = windowService
    this.configService = getConfigService()
  }

  async initialize(): Promise<void> {
    const config = this.configService.getConfigSync()
    console.log('🔧 [Interview] Initializing interview service (thin client mode)')
    console.log('   Server URL:', config.serverUrl)
    console.log('   LiveKit URL:', config.livekitUrl)

    this.setupIpcHandlers()

    console.log('✓ Interview service initialized (all logic runs on server)')
  }

  async shutdown(): Promise<void> {
    console.log('🔌 [Interview] Shutting down interview service')
    // Nothing to clean up - server handles everything
  }

  private setupIpcHandlers(): void {
    // Request camera permissions
    ipcMain.handle('request-camera-permissions', async () => {
      try {
        // In Electron, camera permissions are handled by the system
        // We just need to acknowledge the request
        console.log('📹 [Interview] Camera permissions requested')
        return { success: true, granted: true }
      } catch (error) {
        console.error('❌ [Interview] Camera permission error:', error)
        return { success: false, granted: false, error: String(error) }
      }
    })

    // Request microphone permissions
    ipcMain.handle('request-microphone-permissions', async () => {
      try {
        console.log('🎤 [Interview] Microphone permissions requested')
        return { success: true, granted: true }
      } catch (error) {
        console.error('❌ [Interview] Microphone permission error:', error)
        return { success: false, granted: false, error: String(error) }
      }
    })

    // Request audio permissions (alias for microphone)
    ipcMain.handle('request-audio-permissions', async () => {
      try {
        console.log('🎤 [Interview] Audio permissions requested')
        return { success: true, granted: true }
      } catch (error) {
        console.error('❌ [Interview] Audio permission error:', error)
        return { success: false, granted: false, error: String(error) }
      }
    })

    // Check for unfinished interview
    ipcMain.handle('check-unfinished-interview', async () => {
      try {
        console.log('🔍 [Interview] Checking for unfinished interview')
        // Since all state is on the server now, return no unfinished interview
        // The renderer should check with the server directly if needed
        return { hasUnfinished: false }
      } catch (error) {
        console.error('❌ [Interview] Check unfinished error:', error)
        return { hasUnfinished: false }
      }
    })

    // Submit solution handler
    ipcMain.handle('submit-solution', async (_event, code, isTimeout, timeComplexity, spaceComplexity) => {
      try {
        console.log('📝 [Interview] Solution submitted:', {
          codeLength: code?.length,
          isTimeout,
          complexity: { time: timeComplexity, space: spaceComplexity }
        })
        // Return success to let renderer proceed with agent notification
        return { success: true, hasNextProblem: true }
      } catch (error) {
        console.error('❌ [Interview] Submit solution error:', error)
        return { success: false, error: String(error) }
      }
    })

    // Analyze code handler (no-op/stub)
    ipcMain.handle('analyze-code', async (_event, codeData) => {
      // Analysis happens on server side or via agent now
      return { success: true }
    })

    // Confirm skip question handler
    ipcMain.handle('confirm-skip-question', async (_event, confirmed) => {
      console.log('📝 [Interview] Skip question confirmed:', confirmed)
      return { success: true }
    })

    // Stop interview handler
    ipcMain.handle('stop-interview', async () => {
      try {
        console.log('🛑 [Interview] Stop interview requested')
        // Since all state is on the server now, just acknowledge the stop request
        // The server will handle cleanup when the LiveKit room is disconnected
        return { success: true }
      } catch (error) {
        console.error('❌ [Interview] Stop interview error:', error)
        return { success: false, error: String(error) }
      }
    })

    // Config Handlers
    ipcMain.handle('fetch-config', async (_event, authToken) => {
      try {
        return await this.configService.fetchFromServer(authToken)
      } catch (error) {
        console.error('❌ [Interview] Fetch config error:', error)
        return { success: false, error: String(error) }
      }
    })

    ipcMain.handle('get-config', async () => {
      try {
        return await this.configService.getConfig()
      } catch (error) {
        console.error('❌ [Interview] Get config error:', error)
        return null
      }
    })

    ipcMain.handle('refresh-config', async (_event, authToken) => {
      try {
        return await this.configService.refresh(authToken)
      } catch (error) {
        console.error('❌ [Interview] Refresh config error:', error)
        return null
      }
    })

    ipcMain.handle('set-auth-token', async (_event, token) => {
      try {
        this.configService.setAuthToken(token)
        return true
      } catch (error) {
        console.error('❌ [Interview] Set auth token error:', error)
        return false
      }
    })

    console.log('✓ Interview IPC handlers registered')
  }
}
