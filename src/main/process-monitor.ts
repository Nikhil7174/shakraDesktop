import processList from 'node-processlist'
import * as os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { ProcessStatus, ProcessInfo, ProcessStatsData } from '../shared/types'

const execAsync = promisify(exec)

export class ProcessMonitor {
  private interval: NodeJS.Timeout | null = null
  private lastStableDetection: Array<{ name: string; pid: number; reason: string }> = []
  private lastProcessSnapshot: Set<string> = new Set() // Track unique process identifiers
  // private _killedProcesses: Set<string> = new Set() // Track killed processes to avoid duplicate kills
  
  // Blacklist of applications that should be blocked (comprehensive list of major user applications)
  private readonly blockedApps = [
    // Browsers (all major browsers)
      'firefox', 'edge', 'opera', 'brave', 'safari', 'vivaldi', 'tor',
     'msedge', 'iexplore', 'waterfox', 'pale moon', 'chrome' , 'chromium',
    
    // AI/Chat applications and assistants
    'chatgpt', 'claude', 'copilot', 'gemini', 'bard', 'openai', 'anthropic',
    'perplexity', 'poe', 'character.ai', 'github copilot',
    'chatgpt desktop', 'claude desktop', 'chatgpt app', 'claude app',
    'bing chat', 'microsoft copilot', 'copilot chat', 'chatgpt plus',
    'you.com', 'phind', 'hugging chat', 'huggingface', 'replicate',
    'together ai', 'cohere', 'ai21', 'jasper', 'copy.ai', 'writesonic',
    'grammarly', 'grammarly desktop', 'quillbot', 'wordtune', 'rytr',
    'julius ai', 'monkeylearn', 'textio', 'crystal', 'x.ai', 'grok',
    
    // Interview cheating tools and AI assistants
    'cluely', 'finalround', 'interviewbuddy', 'interviewbit', 'interviewcake',
    'pramp', 'interviewing.io', 'gainlo', 'mockinterview', 'interviewing',
    'leetcode', 'hackerrank', 'codewars', 'codeforces', 'topcoder',
    'geeksforgeeks', 'interviewbit', 'interviewcake', 'algoexpert',
    'structy', 'neetcode', 'blind 75', 'grind 75', 'tech interview handbook',
    'system design primer', 'designgurus', 'excalidraw', 'draw.io',
    'lucidchart', 'whimsical', 'miro', 'figma', 'sketch',
    'interviewing.com', 'interviewing.io', 'interview kickstart', 'interview master',
    'interview prep', 'interview practice', 'mock interview', 'interview simulator',
    'interview genie', 'interview ace', 'interview success', 'big interview',
    'interview masterclass', 'interview prep pro', 'interview coach',
    'interview mentor', 'interview guru', 'interview pro', 'interview expert',
    'glassdoor interview', 'indeed interview', 'linkedin interview',
    'interview questions', 'interview answers', 'interview solutions',
    'coding interview', 'tech interview', 'software interview', 'faang interview',
    'system design interview', 'behavioral interview', 'interview prep app',
    
    // AI coding assistants and tools
    'tabnine', 'kite', 'codota', 'intellicode', 'github copilot',
    'amazon codeguru', 'deepcode', 'sourcery', 'codeium', 'aider',
    'continue', 'cody', 'codeium chat', 'code whisperer', 'codex',
    'replit ghostwriter', 'codeium', 'blackbox', 'ai code', 'ai assistant',
    'github copilot chat', 'copilot x', 'copilot labs', 'copilot for business',
    'amazon codewhisperer', 'aws codewhisperer', 'code whisperer',
    'sourcegraph cody', 'cody ai', 'cody by sourcegraph', 'cody assistant',
    'codeium ai', 'codeium chat', 'codeium autocomplete', 'codeium ide',
    'tabnine ai', 'tabnine chat', 'tabnine pro', 'tabnine enterprise',
    'kite ai', 'kite copilot', 'kite autocomplete', 'kite pro',
    'aider ai', 'aider coding', 'aider chat', 'aider assistant',
    'continue ai', 'continue.dev', 'continue extension', 'continue chat',
    'blackbox ai', 'blackbox code', 'blackbox chat', 'blackbox assistant',
    'replit ghostwriter', 'replit ai', 'replit copilot', 'replit chat', 
    'cursor ai', 'cursor chat', 'cursor copilot', 'cursor assistant', 'cursor',
    'ai pair programming', 'ai code completion', 'ai code review',
    'ai code generator', 'ai code assistant', 'ai programming',
    'ai coding', 'ai developer', 'ai dev tools', 'ai code tools',
    
    // AI search and research tools
    'you.com', 'phind', 'andisearch', 'komo', 'brave search',
    'ecosia', 'duckduckgo', 'startpage', 'searx', 'metager',
    
    // AI writing and content tools
    'jasper', 'copy.ai', 'writesonic', 'rytr', 'contentbot', 'copy.ai',
    'frase', 'surfer seo', 'marketmuse', 'clearscope', 'outranking',
    'inkforall', 'neuraltext', 'growthbar', 'wordai', 'article forge',
    
    // AI voice assistants
    'alexa', 'google assistant', 'siri', 'cortana', 'bixby',
    'alexa app', 'google home', 'homepod', 'echo', 'google nest',
    
    // AI image and video tools
    'midjourney', 'dall-e', 'stable diffusion', 'runway', 'synthesia',
    'descript', 'murf', 'elevenlabs', 'play.ht', 'wellsaid', 'lovo',
    'pictory', 'invideo', 'synthesys', 'deepfake', 'face swap',
    
    // Remote access tools
    'anydesk', 'teamviewer', 'chrome remote', 'vnc', 'rdp', 'remote desktop',
    'logmein', 'gotomypc', 'splashtop', 'ultraviewer', 'ammyy', 'supremo',
    'rustdesk', 'getscreen', 'parsec', 'moonlight',
    
    // Communication apps
    'telegram', 'whatsapp', 'discord', 'slack', 'skype', 'zoom', 'teams',
    'hangouts', 'messenger', 'signal', 'wechat', 'viber', 'line',
    'microsoft teams', 'webex', 'gotomeeting', 'bluejeans',
    
    // Office and productivity suites
    'word', 'excel', 'powerpoint', 'outlook', 'onenote', 'access', 'publisher',
    'libreoffice', 'openoffice', 'wps', 'pages', 'numbers', 'keynote',
    'notion', 'evernote', 'onenote',
    
    // Code editors and IDEs
    'code', 'vscode', 'visual studio', 'intellij', 'pycharm', 'webstorm',
    'android studio', 'xcode', 'sublime', 'atom', 'brackets', 'vim', 'emacs',
    'notepad++', 'notepad', 'gedit', 'kate',
    
    // Media players
    'vlc', 'media player', 'quicktime', 'itunes', 'spotify', 'winamp',
    'foobar', 'mpc', 'potplayer', 'kmplayer',
    
    // Image and video editing
    'photoshop', 'illustrator', 'premiere', 'after effects', 'lightroom',
    'gimp', 'inkscape', 'blender', 'maya', '3ds max', 'cinema 4d',
    'davinci resolve', 'final cut', 'imovie',
    
    // Screen sharing/recording tools
     'streamlabs', 'xsplit', 'bandicam', 'fraps', 'camtasia',
    'screencast', 'screen recorder', 'sharex', 'greenshot',
    
    // Virtual machines and containers
    'virtualbox', 'vmware', 'qemu', 'hyper-v', 'parallels', 'virtual machine',
    'docker', 'podman', 'kubernetes', 'kubectl',
    
    // Browser automation and testing
    'selenium', 'puppeteer', 'playwright', 'cypress', 'automation', 'bot',
    'scraper', 'webdriver', 'nightwatch',
    
    // File sharing and cloud storage
    'dropbox', 'google drive', 'onedrive', 'icloud', 'mega', 'box', 'sync',
    'sharefile', 'nextcloud', 'owncloud',
    
    // Gaming platforms
    'steam', 'epic games', 'origin', 'uplay', 'battle.net', 'gog',
    'xbox', 'playstation', 'nvidia', 'amd',
    
    // Social media and messaging
    'facebook', 'twitter', 'instagram', 'linkedin', 'reddit', 'tiktok',
    'snapchat', 'pinterest', 'tumblr',
    
    // Development tools
    'git', 'github desktop', 'gitkraken', 'sourcetree', 'tortoisegit',
    'postman', 'insomnia', 'fiddler', 'wireshark', 'burp',
    
    // System utilities that could be misused
    'taskmgr', 'process explorer', 'process hacker', 'hijackthis',
    'regedit', 'gpedit', 'cmd', 'powershell', 'terminal',
    
    // Cheating tools, memory editors, and trainers
    'cheat engine', 'artmoney', 'game guardian', 'lucky patcher',
    'game killer', 'game hacker', 'memory editor', 'cheat',
    'process hacker', 'process explorer', 'hijackthis', 'ollydbg',
    'x64dbg', 'x32dbg', 'ida pro', 'ghidra', 'radare2', 'gdb',
    'windbg', 'immunity debugger', 'wireshark', 'fiddler', 'burp suite',
    'charles proxy', 'mitmproxy', 'proxyman', 'http toolkit',
    'memory scanner', 'hex editor', 'hxd', '010 editor', 'hexplorer',
    'cheat tool', 'trainer', 'game trainer', 'memory hack', 'process inject',
    'dll inject', 'code inject', 'hook', 'api hook', 'detour', 'patch',
    
    // Screen sharing and remote assistance (potential cheating)
    'screen share', 'screen sharing', 'remote assistance', 'quick assist',
    'windows quick assist', 'remote help', 'assist', 'support',
    
    // Browser extensions that could be used for cheating (if running as separate processes)
    'browser extension', 'chrome extension', 'firefox extension', 'edge extension',
    
    // Virtual audio/video devices (could be used to hide real audio/video)
    'virtual audio', 'vb audio', 'voicemeeter', 'virtual cable', 'obs virtual',
    'manycam', 'snap camera', 'xsplit vcam', 'nvidia broadcast', 'rtx voice',
    
    // Screen mirroring and casting tools
    'airplay', 'miracast', 'chromecast', 'screen mirror', 'screen cast',
    'scrcpy', 'vysor', 'airdroid', 'mobizen', 'apowermirror',
    
    // Keyloggers and monitoring tools (obvious cheating tools)
    'keylogger', 'keystroke', 'key capture', 'key monitor', 'key spy',
    'activity monitor', 'employee monitor', 'spy software', 'monitoring',
    'screen capture', 'screen spy', 'screen monitor', 'activity tracker',
    
    // AI-powered interview preparation and practice tools
    'interviewing.io', 'pramp', 'interviewbuddy', 'interviewbit', 'interviewcake',
    'gainlo', 'mockinterview', 'interview prep', 'interview practice',
    'big interview', 'interview masterclass', 'interview success', 'interview ace',
    
    // Code sharing and collaboration during interviews
    'codeshare', 'code together', 'tmate', 'teletype', 'live share',
    'code with me', 'pair programming', 'screenhero', 'tuple', 'use together',
    
    // Note-taking and documentation tools that could store answers
    'onenote', 'evernote', 'notion', 'obsidian', 'roam research', 'logseq',
    'remnote', 'mem', 'reflect', 'craft', 'bear', 'ulysses', 'scrivener',
    
    // Translation and language tools
    'google translate', 'deepl', 'microsoft translator', 'translate',
    'lingvanex', 'reverso', 'promt', 'systran', 'babylon',
    'google translate app', 'deepl app', 'microsoft translator app',
    'translate app', 'translation', 'translator', 'language translator',
    
    // Text-to-speech and speech-to-text (could be used for communication)
    'text to speech', 'speech to text', 'voice typing', 'dictation',
    'dragon', 'nuance', 'windows speech recognition', 'speech recognition',
    'natural reader', 'read aloud', 'voice dream', 'balabolka', 'textaloud',
    'nvda', 'jaws', 'window eyes', 'system access', 'zoomtext',
    'screen reader', 'voice over', 'talkback', 'orca', 'orca screen reader',
    
    // Accessibility tools that could be misused
    'magnifier', 'screen magnifier', 'zoom', 'magnify', 'bigger text',
    'high contrast', 'color contrast', 'accessibility', 'ease of access',
    
    // Clipboard managers (could store answers)
    'clipboard', 'clipboard manager', 'clipboard history', 'clipboard plus',
    'ditto', 'clipx', 'clipboard fusion', '1clipboard', 'clipboard master',
    
    // Search engines and research tools
    'google', 'bing', 'yahoo', 'duckduckgo', 'brave search', 'ecosia',
    'startpage', 'searx', 'metager', 'qwant', 'swisscows', 'mojeek',
    
    // Knowledge bases and wikis
    'wikipedia', 'wikimedia', 'wiki', 'stack overflow', 'stackexchange',
    'reddit', 'quora', 'medium', 'dev.to', 'hashnode', 'freecodecamp',
    'w3schools', 'mdn', 'developer.mozilla', 'docs.microsoft', 'docs.google',
    
    // Documentation and reference sites (if running as apps)
    'documentation', 'api docs', 'reference', 'manual', 'guide', 'tutorial',
    
    // Other productivity tools
    'adobe', 'autocad', 'solidworks', 'matlab', 'mathematica',
    'tableau', 'power bi', 'qlik',
    
    // Note: System processes like winlogon, csrss, svchost, explorer, etc. are NOT in this list
    // so they will NOT be blocked, keeping the system functional
  ]
  // private readonly blockedApps = []
  // System processes that should NEVER be blocked (safety check)
  private readonly systemProcesses = [
    'winlogon', 'csrss', 'smss', 'lsass', 'services', 'svchost', 'dwm',
    'explorer', 'system', 'ntoskrnl', 'hal', 'wininit', 'spoolsv',
    'taskhost', 'taskhostw', 'sihost', 'runtimebroker', 'conhost',
    'audiodg', 'dwm', 'systemsettings', 'applicationframehost',
    'shellexperiencehost', 'wsmprovhost', 'wudfhost', 'wmiprvse',
    'dllhost', 'kernel', 'init', 'systemd'
  ]

  // Whitelist: Shakra app processes that should NEVER be blocked
  private readonly whitelistedApps = [
    // Main executable names
    'shakra-ai-interview', 'shakra', 'shakra-interview-app',
    'crisp-interview-app', 'crisp-interview',
    // Electron processes (part of the app)
    'electron', 'electron.exe',
    // Process name variations
    'shakra-ai-interview.exe', 'shakra.exe',
    // Package name
    'com.shakra.interview'
  ]

  constructor() {}

  // Cross-platform process killing method
  private async _killProcess(pid: number, processName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const platform = os.platform()
      let command: string

      if (platform === 'win32') {
        // Windows: Use taskkill
        command = `taskkill /F /PID ${pid}`
      } else {
        // Unix-like systems (Linux, macOS): Use kill
        command = `kill -9 ${pid}`
      }

      // console.log(`Attempting to kill process: ${processName} (PID: ${pid})`)
      
      const { stderr } = await execAsync(command)
      
      if (stderr && !stderr.includes('No such process') && !stderr.includes('not found')) {
        console.error(`Error killing process ${processName} (PID: ${pid}):`, stderr)
        return { success: false, error: stderr }
      }

      console.log(`✓ Successfully killed process: ${processName} (PID: ${pid})`)
      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      // Ignore "process not found" errors as the process may have already terminated
      if (errorMsg.includes('not found') || errorMsg.includes('No such process')) {
        return { success: true } // Consider it successful if process doesn't exist
      }
      // console.error(`Failed to kill process ${processName} (PID: ${pid}):`, errorMsg)
      return { success: false, error: errorMsg }
    }
  }

  // Kill all detected non-whitelisted processes
  private async _killBlockedProcesses(detected: Array<{ name: string; pid: number; reason: string }>): Promise<Array<{ name: string; pid: number; reason: string; killed: boolean; error?: string }>> {
    const killPromises = detected.map(async (process) => {
      const result = await this._killProcess(process.pid, process.name)
      return {
        ...process,
        killed: result.success,
        error: result.error
      }
    })
    
    return Promise.all(killPromises)
  }


  // Check if process name is in blacklist
  private isInBlacklist(processName: string): boolean {
    const processNameLower = processName.toLowerCase()
    return this.blockedApps.some(blockedApp => {
      const blockedAppLower = blockedApp.toLowerCase()
      return processNameLower === blockedAppLower || 
             processNameLower.includes(blockedAppLower) ||
             processNameLower.startsWith(blockedAppLower + '.') ||
             processNameLower.startsWith(blockedAppLower + ' ') ||
             processNameLower.startsWith(blockedAppLower + '-')
    })
  }

  // Check if process is whitelisted (Shakra app itself)
  private isWhitelisted(processName: string, processPath: string): boolean {
    const processNameLower = processName.toLowerCase()
    const processPathLower = (processPath || '').toLowerCase()
    
    // Check if process name matches whitelist
    const nameMatches = this.whitelistedApps.some(whitelisted => {
      const whitelistedLower = whitelisted.toLowerCase()
      return processNameLower === whitelistedLower ||
             processNameLower.includes(whitelistedLower) ||
             processNameLower.startsWith(whitelistedLower + '.') ||
             processNameLower.startsWith(whitelistedLower + ' ') ||
             processNameLower.startsWith(whitelistedLower + '-')
    })
    
    // Check if process path contains whitelisted app names
    const pathMatches = processPathLower ? this.whitelistedApps.some(whitelisted => {
      const whitelistedLower = whitelisted.toLowerCase()
      return processPathLower.includes(whitelistedLower)
    }) : false
    
    return nameMatches || pathMatches
  }

  // Detection method: Block only blacklisted applications (cross-platform)
  private detectBlockedProcesses(processes: any[]): Array<{ name: string; pid: number; reason: string }> {
    const detected: Array<{ name: string; pid: number; reason: string }> = []
    const seenProcesses = new Set<string>() // Track unique processes to avoid duplicates
    const currentPid = process.pid // Get current process PID to exclude Shakra itself

    processes.forEach(proc => {
      const processName = proc.name || ''
      const processPath = proc.path || proc.exe || '' // Try different path properties
      const pid = proc.pid || 0

      // Skip current process (Shakra itself) - primary safeguard
      if (pid === currentPid) {
        return
      }

      // Safety check: NEVER block whitelisted apps (Shakra app itself) - additional safeguard
      if (this.isWhitelisted(processName, processPath)) {
        return // Skip whitelisted apps - never block them
      }

      // Safety check: NEVER block system processes by name
      const isSystemProcessByName = this.systemProcesses.some(systemProc => {
        const systemProcLower = systemProc.toLowerCase()
        const processNameLower = processName.toLowerCase()
        return processNameLower === systemProcLower || 
               processNameLower.includes(systemProcLower) ||
               processNameLower.startsWith(systemProcLower + '.') ||
               processNameLower.startsWith(systemProcLower + ' ')
      })

      if (isSystemProcessByName) {
        return // Skip system processes - never block them
      }

      // Cross-platform: Only block processes in blacklist
      if (this.isInBlacklist(processName) && pid > 0) {
        const uniqueId = `${processName}-${pid}`
        
        if (!seenProcesses.has(uniqueId)) {
          seenProcesses.add(uniqueId)
          detected.push({
            name: processName,
            pid,
            reason: `Blacklisted application: ${processName}`
          })
        }
      }
    })

    return detected
  }


  // Enrich processes with paths (if not already present) - cross-platform
  private async enrichProcessesWithPaths(processes: any[]): Promise<any[]> {
    // If processes already have path information, return as-is
    if (processes.length > 0 && (processes[0].path || processes[0].exe || processes[0].commandLine)) {
      return processes
    }

    // Path enrichment is optional - return processes as-is if not available
    // This avoids Windows-specific wmic calls and makes the code cross-platform
    return processes
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
        // console.log('node-processlist failed in checkProcesses, trying fallback...')
        processes = await this.getProcessesFallback()
        // console.log(`Found ${processes.length} processes using fallback method`)
      }
      
      // Enrich processes with paths (if available)
      processes = await this.enrichProcessesWithPaths(processes)
      
      const detected = this.detectBlockedProcesses(processes)
      
      // Kill detected blacklisted applications
      if (detected.length > 0) {
        console.log(`🚫 Detected ${detected.length} blacklisted applications, attempting to kill them...`)
        const killResults = await this._killBlockedProcesses(detected)
        
        // Log kill results
        const killedCount = killResults.filter(r => r.killed).length
        const failedCount = killResults.filter(r => !r.killed).length
        
        console.log(`✓ Killed ${killedCount} blacklisted applications, ${failedCount} failed to kill`)
        
        // Log failed kills
        killResults.filter(r => !r.killed).forEach(result => {
          // console.log(`❌ Failed to kill ${result.name} (PID: ${result.pid}): ${result.error}`)
        })
      }
      
      // Create a snapshot of current blocked processes (unique identifiers)
      const currentSnapshot = new Set<string>()
      detected.forEach(process => {
        currentSnapshot.add(`${process.name}-${process.pid}`)
      })
      
      // Only update if the process snapshot has actually changed
      if (this.hasProcessSnapshotChanged(currentSnapshot)) {
        this.lastStableDetection = [...detected]
        this.lastProcessSnapshot = new Set(currentSnapshot)
        // console.log(`Process snapshot changed: ${detected.length} blocked applications:`, detected.map(d => d.name))
      } else {
        // console.log(`No change in process snapshot: ${this.lastStableDetection.length} blocked applications (unchanged)`)
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
      // console.error('Error checking processes:', error)
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
      // console.log('Getting process list...')
      
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
        // console.log('node-processlist failed, trying fallback method...')
        processes = await this.getProcessesFallback()
        // console.log(`Found ${processes.length} processes using fallback method`)
      }
      
      // Enrich processes with paths (if available)
      processes = await this.enrichProcessesWithPaths(processes)
      
      const detected = this.detectBlockedProcesses(processes)

      // Kill detected blacklisted applications
      if (detected.length > 0) {
        console.log(`🚫 Detected ${detected.length} blacklisted applications in stats, attempting to kill them...`)
        const killResults = await this._killBlockedProcesses(detected)
        
        // Log kill results
        const killedCount = killResults.filter(r => r.killed).length
        const failedCount = killResults.filter(r => !r.killed).length
        
        console.log(`✓ Killed ${killedCount} blacklisted applications, ${failedCount} failed to kill`)
      }

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

  // Kill all blacklisted applications on startup
  async killAllOnStartup(): Promise<void> {
    try {
      console.log('🚫 [Startup] Checking for blacklisted applications...')
      
      let processes: any[] = []
      try {
        const processPromise = processList.getProcesses()
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Process list timeout')), 10000)
        )
        processes = await Promise.race([processPromise, timeoutPromise]) as any[]
      } catch (error) {
        console.warn('Failed to get process list on startup, using fallback')
        processes = await this.getProcessesFallback()
      }
      
      // Enrich processes with paths (if available)
      processes = await this.enrichProcessesWithPaths(processes)
      
      const detected = this.detectBlockedProcesses(processes)
      
      if (detected.length > 0) {
        console.log(`🚫 [Startup] Found ${detected.length} blacklisted applications to kill`)
        const killResults = await this._killBlockedProcesses(detected)
        const killedCount = killResults.filter(r => r.killed).length
        const failedCount = killResults.filter(r => !r.killed).length
        console.log(`✓ [Startup] Killed ${killedCount} blacklisted applications on startup, ${failedCount} failed`)
      } else {
        console.log('✓ [Startup] No blacklisted applications found')
      }
    } catch (error) {
      console.error('❌ [Startup] Error killing processes on startup:', error)
    }
  }

  start(): void {
    // Kill all non-whitelisted processes immediately on startup
    this.killAllOnStartup().catch(err => {
      // console.error('Failed to kill processes on startup:', err)
    })
    
    // Check every 3 seconds (reduced frequency to prevent crashes)
    this.interval = setInterval(async () => {
      try {
        const status = await this.checkProcesses()
        
        // Process monitoring completed (no UI updates needed)
      } catch (error) {
        // console.error('Error in process monitoring interval:', error)
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