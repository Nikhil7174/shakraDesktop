import processList from 'node-processlist'
import { WebSocketServer } from './websocket-server'
import * as os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface ProcessStatus {
  totalProcesses: number
  blockedAppsDetected: Array<{ name: string; pid: number; reason?: string }>
  timestamp: number
  error?: string
}

export interface ProcessInfo {
  name: string
  pid: number
  cpu: number
  memory: number
  status: string
}

export interface ProcessStatsData {
  totalProcesses: number
  blockedAppsDetected: Array<{ name: string; pid: number; reason?: string }>
  systemInfo: {
    cpuUsage: number
    memoryUsage: number
    uptime: number
  }
  recentProcesses: ProcessInfo[]
  timestamp: number
  error?: string
}

export class ProcessMonitor {
  private interval: NodeJS.Timeout | null = null
  
  // List of blocked applications - all others are considered legitimate
  private readonly blockedApps = [
    // AI/Chat applications
    'cluely', 'chatgpt', 'claude', 'copilot', 'gemini', 'bard',
    'openai', 'anthropic', 'perplexity', 'poe', 'character.ai',
    
    // Remote access tools
    'anydesk', 'teamviewer', 'chrome remote', 'vnc', 'rdp',
    'remote desktop', 'logmein', 'gotomypc', 'splashtop',
    'ultraviewer', 'ammyy', 'supremo', 'rustdesk',
    
    // Communication apps that could be used for cheating
    'telegram', 'whatsapp', 'discord', 'slack', 'skype',
    'zoom', 'teams', 'hangouts', 'messenger',
    
    // Cheating tools and trainers
    'cheat', 'hack', 'trainer', 'mod', 'injector', 'bypass',
    'cheat engine', 'artmoney', 'game guardian', 'lucky patcher',
    'game killer', 'game hacker', 'memory editor',
    
    // Screen sharing/recording tools
    'obs', 'streamlabs', 'xsplit', 'bandicam', 'fraps',
    'camtasia', 'screencast', 'screen recorder',
    
    // Virtual machines and containers
    'virtualbox', 'vmware', 'qemu', 'docker', 'hyper-v',
    'parallels', 'virtual machine',
    
    // Browser automation
    'selenium', 'puppeteer', 'playwright', 'cypress',
    'automation', 'bot', 'scraper',
    
    // File sharing and cloud storage
    'dropbox', 'google drive', 'onedrive', 'icloud',
    'mega', 'box', 'sync', 'sharefile'
  ]

  constructor(private wsServer: WebSocketServer) {}

  // Detection method that only checks against blocked apps - all others are legitimate
  private detectBlockedProcesses(processes: any[]): Array<{ name: string; pid: number; reason: string }> {
    const detected: Array<{ name: string; pid: number; reason: string }> = []

    processes.forEach(process => {
      const processName = process.name.toLowerCase()
      const pid = process.pid || 0

      // Check for blocked app matches - all others are considered legitimate
      const blockedMatch = this.blockedApps.find(app => processName.includes(app))
      if (blockedMatch) {
        detected.push({
          name: process.name,
          pid,
          reason: `Blocked application: ${blockedMatch}`
        })
      }
    })

    return detected
  }


  async checkProcesses(): Promise<ProcessStatus> {
    try {
      let processes: any[] = []
      
      try {
        // Try node-processlist first
        const processPromise = processList.getProcesses()
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Process list timeout')), 3000)
        )
        
        processes = await Promise.race([processPromise, timeoutPromise]) as any[]
      } catch (error) {
        console.log('node-processlist failed in checkProcesses, trying fallback...')
        processes = await this.getProcessesFallback()
      }
      
      const detected = this.detectBlockedProcesses(processes)

      return {
        totalProcesses: processes.length,
        blockedAppsDetected: detected.map(p => ({
          name: p.name,
          pid: p.pid,
          reason: p.reason
        })),
        timestamp: Date.now()
      }
    } catch (error) {
      console.error('Error checking processes:', error)
      return {
        totalProcesses: 0,
        blockedAppsDetected: [],
        timestamp: Date.now(),
        error: 'Failed to check processes'
      }
    }
  }

  async getDetailedProcessStats(): Promise<ProcessStatsData> {
    try {
      console.log('Getting process list...')
      
      let processes: any[] = []
      
      try {
        // Try node-processlist first
        const processPromise = processList.getProcesses()
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Process list timeout')), 5000)
        )
        
        processes = await Promise.race([processPromise, timeoutPromise]) as any[]
        console.log(`Found ${processes.length} processes using node-processlist`)
      } catch (error) {
        console.log('node-processlist failed, trying fallback method...')
        processes = await this.getProcessesFallback()
        console.log(`Found ${processes.length} processes using fallback method`)
      }
      
      const detected = this.detectBlockedProcesses(processes)

      // Get system information
      const totalMemory = os.totalmem()
      const freeMemory = os.freemem()
      const memoryUsage = totalMemory - freeMemory
      const cpuUsage = await this.getCpuUsage()
      const uptime = os.uptime()

      // Get recent processes (top 20 by memory usage)
      const recentProcesses: ProcessInfo[] = processes
        .filter(p => p.pid && p.name)
        .sort((a, b) => (b.memory || 0) - (a.memory || 0))
        .slice(0, 20)
        .map(p => ({
          name: p.name || 'Unknown',
          pid: p.pid || 0,
          cpu: p.cpu || 0,
          memory: p.memory || 0,
          status: 'Running' // Simplified status
        }))

      console.log(`Returning stats: ${processes.length} total, ${recentProcesses.length} recent`)

      return {
        totalProcesses: processes.length,
        blockedAppsDetected: detected.map(p => ({
          name: p.name,
          pid: p.pid,
          reason: p.reason
        })),
        systemInfo: {
          cpuUsage,
          memoryUsage,
          uptime
        },
        recentProcesses,
        timestamp: Date.now()
      }
    } catch (error) {
      console.error('Error getting detailed process stats:', error)
      return {
        totalProcesses: 0,
        blockedAppsDetected: [],
        systemInfo: {
          cpuUsage: 0,
          memoryUsage: 0,
          uptime: 0
        },
        recentProcesses: [],
        timestamp: Date.now(),
        error: `Failed to get process stats: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  private async getCpuUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startMeasure = process.cpuUsage()
      setTimeout(() => {
        const endMeasure = process.cpuUsage(startMeasure)
        const totalUsage = (endMeasure.user + endMeasure.system) / 1000000 // Convert to seconds
        const cpuUsage = (totalUsage / 0.1) * 100 // 0.1 second interval
        resolve(Math.min(cpuUsage, 100)) // Cap at 100%
      }, 100)
    })
  }

  private async getProcessesFallback(): Promise<any[]> {
    try {
      // Use ps command as fallback with better formatting
      const { stdout } = await execAsync('ps -eo pid,ppid,comm,%cpu,%mem --no-headers')
      const lines = stdout.trim().split('\n')
      
      return lines.map((line) => {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 5) return null
        
        const pid = parseInt(parts[0]) || 0
        const comm = parts[2] || 'Unknown'  // Command name
        const cpu = parseFloat(parts[3]) || 0
        const mem = parseFloat(parts[4]) || 0
        
        return {
          pid,
          name: comm,
          cpu,
          memory: mem * 1024 * 1024, // Convert MB to bytes
          cmd: comm
        }
      }).filter(p => p && p.pid > 0)
    } catch (error) {
      console.error('Fallback process list failed:', error)
      return []
    }
  }

  start(): void {
    // Check every 3 seconds (reduced frequency to prevent crashes)
    this.interval = setInterval(async () => {
      try {
        const status = await this.checkProcesses()
        
        this.wsServer.broadcast({
          type: 'status',
          data: status
        })
      } catch (error) {
        console.error('Error in process monitoring interval:', error)
        // Send error status
        this.wsServer.broadcast({
          type: 'status',
          data: {
            totalProcesses: 0,
            blockedAppsDetected: [],
            timestamp: Date.now(),
            error: 'Process monitoring error'
          }
        })
      }
    }, 3000) // Increased from 2000ms to 3000ms

    console.log('✓ Process monitoring started')
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      console.log('✗ Process monitoring stopped')
    }
  }
}