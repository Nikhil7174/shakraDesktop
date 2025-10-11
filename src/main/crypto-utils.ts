import crypto from 'crypto'
import { machineIdSync } from 'node-machine-id'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export class CryptoUtils {
  private secretKey: string
  private agentId: string

  constructor() {
    this.agentId = machineIdSync()
    this.secretKey = this.getOrCreateSecretKey()
  }

  private getOrCreateSecretKey(): string {
    const keyPath = path.join(app.getPath('userData'), 'secret.key')
    
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8')
    }

    // Generate new key
    const newKey = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(keyPath, newKey, { mode: 0o600 }) // Restrict permissions
    
    // Register with server (async, don't wait)
    this.registerWithServer(this.agentId, newKey).catch(console.error)
    
    return newKey
  }

  private async registerWithServer(agentId: string, secretKey: string): Promise<void> {
    try {
      const response = await fetch('https://your-api.com/api/agent/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, secretKey })
      })
      
      if (!response.ok) {
        throw new Error(`Registration failed: ${response.status}`)
      }
      
      console.log('✓ Agent registered with server')
    } catch (error) {
      console.error('✗ Failed to register with server:', error)
    }
  }

  sign(data: any): string {
    const dataString = JSON.stringify(data)
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(dataString)
      .digest('hex')
  }

  verify(data: any, signature: string): boolean {
    return this.sign(data) === signature
  }

  handleChallenge(challenge: string): string {
    return crypto
      .createHash('sha256')
      .update(challenge + this.secretKey)
      .digest('hex')
  }

  getAgentId(): string {
    return this.agentId
  }

  getSecretKey(): string {
    return this.secretKey
  }
}