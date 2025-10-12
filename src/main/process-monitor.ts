import processList from 'node-processlist'
import { WebSocketServer } from './websocket-server'
import * as os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { ProcessStatus, ProcessInfo, ProcessStatsData } from '../shared/types'

const execAsync = promisify(exec)

export class ProcessMonitor {
  private interval: NodeJS.Timeout | null = null
  private lastStableDetection: Array<{ name: string; pid: number; reason: string }> = []
  private lastProcessSnapshot: Set<string> = new Set() // Track unique process identifiers
  private lastBroadcastedDetection: Array<{ name: string; pid: number; reason: string }> = []
  private hasInitialBroadcast: boolean = false // Track if we've done the initial broadcast
  
  // List of blocked applications - all others are considered legitimate
  // Made more specific to avoid false positives
  private readonly blockedApps = [
    // AI/Chat applications (exact matches)
    'chatgpt', 'claude', 'copilot', 'gemini', 'bard',
    'openai', 'anthropic', 'perplexity', 'poe', 'character.ai',
    'cursor', // AI-powered code editor
    
    // Remote access tools (exact matches)
    'anydesk', 'teamviewer', 'chrome remote', 'vnc', 'rdp',
    'remote desktop', 'logmein', 'gotomypc', 'splashtop',
    'ultraviewer', 'ammyy', 'supremo', 'rustdesk', 'getscreen',
    
    // Communication apps that could be used for cheating (exact matches)
    'telegram', 'whatsapp', 'discord', 'slack', 'skype',
    'zoom', 'teams', 'hangouts', 'messenger',
    
    // Cheating tools and trainers (exact matches)
    'cheat engine', 'artmoney', 'game guardian', 'lucky patcher',
    'game killer', 'game hacker', 'memory editor',
    
    // Screen sharing/recording tools (exact matches)
    'obs', 'streamlabs', 'xsplit', 'bandicam', 'fraps',
    'camtasia', 'screencast', 'screen recorder',
    
    // Virtual machines and containers (exact matches)
    'virtualbox', 'vmware', 'qemu', 'hyper-v',
    'parallels', 'virtual machine',
    
    // Browser automation (exact matches)
    'selenium', 'puppeteer', 'playwright', 'cypress',
    'automation', 'bot', 'scraper',
    
    // File sharing and cloud storage (exact matches)
    'dropbox', 'google drive', 'onedrive', 'icloud',
    'mega', 'box', 'sync', 'sharefile'
  ]

  constructor(private wsServer: WebSocketServer) {}

  // Detection method that only checks against blocked apps - all others are considered legitimate
  private detectBlockedProcesses(processes: any[]): Array<{ name: string; pid: number; reason: string }> {
    const detected: Array<{ name: string; pid: number; reason: string }> = []
    const seenProcesses = new Set<string>() // Track unique processes to avoid duplicates

    processes.forEach(process => {
      const processName = process.name.toLowerCase()
      const pid = process.pid || 0

      // Check for blocked app matches - use exact matches to avoid false positives
      const blockedMatch = this.blockedApps.find(app => {
        // Use exact match or process name starts with the blocked app name
        return processName === app || processName.startsWith(app + ' ') || processName.startsWith(app + '.')
      })
      
      if (blockedMatch) {
        // Create unique identifier to avoid duplicate entries
        const uniqueId = `${process.name}-${pid}`
        
        if (!seenProcesses.has(uniqueId)) {
          seenProcesses.add(uniqueId)
          detected.push({
            name: process.name,
            pid,
            reason: `Blocked application: ${blockedMatch}`
          })
        }
      }
    })

    return detected
  }


  // Check if the current process snapshot has changed from the last one
  private hasProcessSnapshotChanged(currentSnapshot: Set<string>): boolean {
    if (this.lastProcessSnapshot.size !== currentSnapshot.size) {
      return true
    }
    
    // Check if all processes in current snapshot exist in last snapshot
    for (const processId of currentSnapshot) {
      if (!this.lastProcessSnapshot.has(processId)) {
        return true
      }
    }
    
    return false
  }



  async checkProcesses(): Promise<ProcessStatus> {
    try {
      let processes: any[] = []
      
      try {
        // Try node-processlist first
        const processPromise = processList.getProcesses()
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Process list timeout')), 5000) // Increased timeout
        )
        
        processes = await Promise.race([processPromise, timeoutPromise]) as any[]
        console.log(`Found ${processes.length} processes using node-processlist`)
      } catch (error) {
        console.log('node-processlist failed in checkProcesses, trying fallback...')
        processes = await this.getProcessesFallback()
        console.log(`Found ${processes.length} processes using fallback method`)
      }
      
      const detected = this.detectBlockedProcesses(processes)
      
      // Create a snapshot of current blocked processes (unique identifiers)
      const currentSnapshot = new Set<string>()
      detected.forEach(process => {
        currentSnapshot.add(`${process.name}-${process.pid}`)
      })
      
      // Only update if the process snapshot has actually changed
      if (this.hasProcessSnapshotChanged(currentSnapshot)) {
        this.lastStableDetection = [...detected]
        this.lastProcessSnapshot = new Set(currentSnapshot)
        console.log(`Process snapshot changed: ${detected.length} blocked applications:`, detected.map(d => d.name))
      } else {
        console.log(`No change in process snapshot: ${this.lastStableDetection.length} blocked applications (unchanged)`)
      }

      return {
        totalProcesses: processes.length,
        blockedAppsDetected: this.lastStableDetection.map(p => ({
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
        
        // Always broadcast if this is the first time or if the count is different
        const currentCount = status.blockedAppsDetected.length
        const lastCount = this.lastBroadcastedDetection.length
        const shouldBroadcast = !this.hasInitialBroadcast || currentCount !== lastCount
        
        console.log(`Debug - hasInitialBroadcast: ${this.hasInitialBroadcast}, current: ${currentCount}, last: ${lastCount}, shouldBroadcast: ${shouldBroadcast}`)
        
        if (shouldBroadcast) {
          this.lastBroadcastedDetection = status.blockedAppsDetected.map(app => ({
            name: app.name,
            pid: app.pid,
            reason: app.reason || 'Unknown'
          }))
          
          this.wsServer.broadcast({
            type: 'status',
            data: status
          })
          
          this.hasInitialBroadcast = true
          console.log(`Broadcasting status update: ${status.blockedAppsDetected.length} blocked applications`)
        } else {
          console.log(`No broadcast needed: ${status.blockedAppsDetected.length} blocked applications (unchanged)`)
        }
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
      this.hasInitialBroadcast = false // Reset for next start
      console.log('✗ Process monitoring stopped')
    }
  }
}