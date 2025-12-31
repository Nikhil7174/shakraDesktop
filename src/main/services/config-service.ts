import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import axios from 'axios'
import * as crypto from 'crypto'
import { machineIdSync } from 'node-machine-id'

export interface AppConfig {
  assemblyaiApiKey: string
  openaiApiKey: string
  serverUrl: string
  lastFetched?: number
  expiresAt?: number // When this config expires
}

const CONFIG_FILE = 'app-config.json'
const CONFIG_ENCRYPTED_FILE = 'app-config.enc'

// Simple encryption key derived from machine ID (for basic obfuscation)
// In production, this should be more secure
function getEncryptionKey(): Buffer {
  const machineId = machineIdSync()
  return crypto.createHash('sha256').update(machineId + 'crisp-app-config').digest()
}

function encrypt(data: string, key: Buffer): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(data, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

function decrypt(encryptedData: string, key: Buffer): string {
  const [ivHex, encrypted] = encryptedData.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function getConfigPath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, CONFIG_ENCRYPTED_FILE)
}

function getLegacyConfigPath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, CONFIG_FILE)
}

export class ConfigService {
  private config: AppConfig | null = null
  private serverUrl: string
  private encryptionKey: Buffer
  private authToken: string | null = null // Store auth token for auto-refetch
  private isRefreshing: boolean = false // Prevent concurrent refresh attempts
  private refreshPromise: Promise<AppConfig> | null = null

  constructor(serverUrl?: string) {
    // Use provided server URL or fallback to default
    // For testing: use localhost:3001
    // For production: use https://crisp-server-n0r1.onrender.com
    this.serverUrl = serverUrl || process.env.SERVER_URL || 'http://localhost:3001'
    this.encryptionKey = getEncryptionKey()
  }

  /**
   * Set auth token - triggers fetch if no config exists
   */
  setAuthToken(token: string | null): void {
    this.authToken = token
    
    // Clear config on logout
    if (!token) {
      this.config = null
      this.isRefreshing = false
      this.refreshPromise = null
      return
    }
    
    // If we have token but no config, fetch it (background, non-blocking)
    if (token && !this.config) {
      this.fetchFromServer(token).catch(err => {
        console.warn('⚠️ [Config] Failed to fetch config after setting token:', err)
      })
    }
  }

  /**
   * Get auth token
   */
  getAuthToken(): string | null {
    return this.authToken
  }

  /**
   * Check if config is expired
   * Config expires after 23 hours (refresh before 24h mark)
   */
  private isExpired(config: AppConfig): boolean {
    if (!config.lastFetched) {
      return true // Never fetched = expired
    }
    
    const age = Date.now() - config.lastFetched
    const expirationTime = 23 * 60 * 60 * 1000 // 23 hours
    return age > expirationTime
  }

  /**
   * Load config from local storage (encrypted file)
   */
  private loadLocalConfig(): AppConfig | null {
    try {
      const configPath = getConfigPath()
      const legacyPath = getLegacyConfigPath()

      // Try encrypted file first
      if (existsSync(configPath)) {
        const encrypted = readFileSync(configPath, 'utf8')
        const decrypted = decrypt(encrypted, this.encryptionKey)
        const config = JSON.parse(decrypted) as AppConfig
        console.log('🔧 [Config] Loaded config from encrypted storage')
        return config
      }

      // Fallback to legacy unencrypted file (migrate it)
      if (existsSync(legacyPath)) {
        const config = JSON.parse(readFileSync(legacyPath, 'utf8')) as AppConfig
        // Migrate to encrypted storage
        this.saveLocalConfig(config)
        // Remove legacy file
        try {
          unlinkSync(legacyPath)
        } catch (e) {
          // Ignore errors
        }
        console.log('🔧 [Config] Migrated config to encrypted storage')
        return config
      }

      return null
    } catch (error) {
      console.error('❌ [Config] Error loading local config:', error)
      return null
    }
  }

  /**
   * Save config to local storage (encrypted)
   */
  private saveLocalConfig(config: AppConfig): void {
    try {
      const configPath = getConfigPath()
      const userDataPath = app.getPath('userData')
      
      // Ensure userData directory exists
      if (!existsSync(userDataPath)) {
        mkdirSync(userDataPath, { recursive: true })
      }

      const encrypted = encrypt(JSON.stringify(config), this.encryptionKey)
      writeFileSync(configPath, encrypted, { mode: 0o600 }) // Restrict permissions
      console.log('🔧 [Config] Saved config to encrypted storage')
    } catch (error) {
      console.error('❌ [Config] Error saving local config:', error)
    }
  }

  /**
   * Fetch config from server
   * Requires authentication token
   * Stores in memory only (session storage)
   */
  async fetchFromServer(authToken: string): Promise<AppConfig> {
    try {
      console.log('🔧 [Config] Fetching config from server...')
      const response = await axios.get(`${this.serverUrl}/api/config/keys`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        timeout: 10000,
      })

      if (response.data.success && response.data.config) {
        const now = Date.now()
        const config: AppConfig = {
          assemblyaiApiKey: response.data.config.assemblyaiApiKey || '',
          openaiApiKey: response.data.config.openaiApiKey || '',
          serverUrl: response.data.config.serverUrl || this.serverUrl,
          lastFetched: now,
          expiresAt: now + (23 * 60 * 60 * 1000), // Expires in 23 hours
        }

        // Store in memory only (session storage)
        this.config = config
        this.authToken = authToken // Update stored token

        console.log('✅ [Config] Successfully fetched config from server')
        return config
      } else {
        throw new Error('Invalid response format from server')
      }
    } catch (error: any) {
      console.error('❌ [Config] Error fetching from server:', error.message)
      throw error
    }
  }

  /**
   * Get current config with auto-refresh on expiration
   * This is the main entry point - it checks expiration and auto-refetches
   */
  async getConfig(): Promise<AppConfig> {
    // If we have cached config, check if it's expired
    if (this.config) {
      if (this.isExpired(this.config)) {
        console.log('⚠️ [Config] Config expired, refreshing...')
        // Try to refresh if we have auth token
        if (this.authToken) {
          // If already refreshing, wait for that promise
          if (this.isRefreshing && this.refreshPromise) {
            return await this.refreshPromise
          }
          // Start refresh
          this.isRefreshing = true
          this.refreshPromise = this.fetchFromServer(this.authToken)
            .catch(err => {
              console.warn('⚠️ [Config] Failed to refresh expired config, using stale:', err)
              return this.config! // Return stale config if refresh fails
            })
            .finally(() => {
              this.isRefreshing = false
              this.refreshPromise = null
            })
          return await this.refreshPromise
        } else {
          console.warn('⚠️ [Config] Config expired but no auth token available')
        }
      }
      return this.config
    }

    // No config in memory - try to load from disk (fallback for first run)
    const localConfig = this.loadLocalConfig()
    if (localConfig) {
      this.config = localConfig
      // Check if expired and try to refresh
      if (this.isExpired(localConfig) && this.authToken) {
        console.log('⚠️ [Config] Loaded config from disk is expired, refreshing...')
        try {
          return await this.fetchFromServer(this.authToken)
        } catch (err) {
          console.warn('⚠️ [Config] Failed to refresh, using stale disk config:', err)
          return localConfig
        }
      }
      return localConfig
    }

    // Fallback to environment variables (for dev)
    console.log('⚠️ [Config] Using environment variables as fallback')
    const envConfig: AppConfig = {
      assemblyaiApiKey: process.env.ASSEMBLYAI_API_KEY || '',
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      serverUrl: process.env.SERVER_URL || this.serverUrl,
    }
    
    this.config = envConfig
    return envConfig
  }

  /**
   * Synchronous version (for backwards compatibility)
   * Returns cached config without checking expiration
   * Use getConfig() for auto-refresh behavior
   */
  getConfigSync(): AppConfig {
    if (this.config) {
      return this.config
    }

    // Try loading from disk
    const localConfig = this.loadLocalConfig()
    if (localConfig) {
      this.config = localConfig
      return localConfig
    }

    // Fallback to env
    const envConfig: AppConfig = {
      assemblyaiApiKey: process.env.ASSEMBLYAI_API_KEY || '',
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      serverUrl: process.env.SERVER_URL || this.serverUrl,
    }
    
    this.config = envConfig
    return envConfig
  }

  /**
   * Initialize config - tries to fetch from server if token is available
   * Falls back to local storage or env vars
   */
  async initialize(authToken?: string): Promise<AppConfig> {
    // If we have a token, try fetching from server
    if (authToken) {
      try {
        return await this.fetchFromServer(authToken)
      } catch (error) {
        console.warn('⚠️ [Config] Failed to fetch from server, using local/env fallback')
      }
    }

    // Otherwise, use local storage or env
    return this.getConfig()
  }

  /**
   * Refresh config from server
   */
  async refresh(authToken: string): Promise<AppConfig> {
    return await this.fetchFromServer(authToken)
  }

  /**
   * Clear cached config (on logout)
   */
  clearCache(): void {
    this.config = null
    this.authToken = null
    this.isRefreshing = false
    this.refreshPromise = null
  }

  /**
   * Check if config is from server (has lastFetched timestamp)
   */
  isFromServer(): boolean {
    const config = this.getConfigSync()
    return !!config.lastFetched
  }

  /**
   * Check if config needs refresh
   */
  needsRefresh(): boolean {
    if (!this.config) return true
    return this.isExpired(this.config)
  }
}

// Singleton instance
let configServiceInstance: ConfigService | null = null

export function getConfigService(serverUrl?: string): ConfigService {
  if (!configServiceInstance) {
    configServiceInstance = new ConfigService(serverUrl)
  }
  return configServiceInstance
}

