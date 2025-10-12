import WebSocket from 'ws'
import { CryptoUtils } from './crypto-utils'
import { BrowserWindow } from 'electron'

export interface SignedMessage {
  type: string
  data?: any
  sequence: number
  timestamp: number
  signature: string
}

export class WebSocketServer {
  private wss: WebSocket.Server | null = null
  private crypto: CryptoUtils
  private clients: Set<WebSocket> = new Set()
  private messageSequence: number = 0

  constructor(private port: number) {
    this.crypto = new CryptoUtils()
  }

  start(): void {
    try {
      this.wss = new WebSocket.Server({ port: this.port })
      this.setupWebSocketHandlers()
      console.log(`✓ WebSocket server listening on port ${this.port}`)
    } catch (error) {
      console.error(`Failed to start WebSocket server on port ${this.port}:`, error)
      // Try alternative port
      const altPort = this.port + 1
      console.log(`Trying alternative port ${altPort}...`)
      try {
        this.wss = new WebSocket.Server({ port: altPort })
        this.setupWebSocketHandlers()
        console.log(`✓ WebSocket server listening on alternative port ${altPort}`)
      } catch (altError) {
        console.error(`Failed to start WebSocket server on alternative port ${altPort}:`, altError)
        throw new Error(`Unable to start WebSocket server on ports ${this.port} or ${altPort}`)
      }
    }
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return

    this.wss.on('connection', (ws) => {
      console.log('✓ Web app connected')
      this.clients.add(ws)

      // Send handshake
      this.sendSigned(ws, {
        type: 'handshake',
        data: {
          agentId: this.crypto.getAgentId(),
          version: '1.0.0'
        }
      })

      ws.on('message', (message) => {
        this.handleMessage(ws, message.toString())
      })

      ws.on('close', () => {
        console.log('✗ Web app disconnected')
        this.clients.delete(ws)
      })

      ws.on('error', (error) => {
        console.error('WebSocket error:', error)
        this.clients.delete(ws)
      })
    })
  }

  private handleMessage(ws: WebSocket, message: string): void {
    try {
      const data = JSON.parse(message)

      // ✅ BEST PRACTICE: Validate and whitelist IPC channels
      switch (data.type) {
        case 'challenge':
          if (!data.challenge || typeof data.challenge !== 'string') {
            throw new Error('Invalid challenge format')
          }
          this.handleChallenge(ws, data.challenge)
          break

        case 'ping':
          this.sendSigned(ws, { type: 'pong' })
          break

        default:
          console.warn('Unknown message type:', data.type)
      }
    } catch (error) {
      console.error('Error handling message:', error)
    }
  }

  private handleChallenge(ws: WebSocket, challenge: string): void {
    const answer = this.crypto.handleChallenge(challenge)
    
    this.sendSigned(ws, {
      type: 'challenge-response',
      data: {
        challenge,
        answer
      }
    })
  }

  sendSigned(ws: WebSocket, payload: { type: string; data?: any }): void {
    const message: Omit<SignedMessage, 'signature'> = {
      type: payload.type,
      data: payload.data,
      sequence: this.messageSequence++,
      timestamp: Date.now()
    }

    const signature = this.crypto.sign(message)
    const signedMessage: SignedMessage = { ...message, signature }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(signedMessage))
    }
  }

  broadcast(payload: { type: string; data?: any }): void {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        this.sendSigned(client, payload)
      }
    })

    // Also notify renderer window with correct event type
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      // Map WebSocket types to IPC event names
      let ipcEventName = 'status-update' // default
      // if (payload.type === 'ai-connections') {
      //   ipcEventName = 'ai-connection-stats-update'
      // } else if (payload.type === 'dns-status') {
      //   ipcEventName = 'dns-stats-update'
      // } else if (payload.type === 'status') {
      //   ipcEventName = 'status-update'
      // }
      
      win.webContents.send(ipcEventName, payload.data)
    })
  }

  stop(): void {
    this.clients.forEach(client => client.close())
    this.wss?.close()
  }
}