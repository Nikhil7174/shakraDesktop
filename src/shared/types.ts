// Centralized type definitions for the Security Agent App
// This file contains all shared interfaces to avoid duplication

// ============================================================================
// CORE SECURITY TYPES
// ============================================================================

export interface SecurityStatus {
  connected: boolean
  blockedApps: string[]
  timestamp: number
  error?: string
}

// ============================================================================
// PROCESS MONITORING TYPES
// ============================================================================

export interface ProcessInfo {
  name: string
  pid: number
  cpu: number
  memory: number
  status: string
}

export interface ProcessStatus {
  totalProcesses: number
  blockedAppsDetected: Array<{
    name: string
    pid: number
    reason: string
  }>
  timestamp: number
  error?: string
}

export interface ProcessStatsData {
  totalProcesses: number
  blockedAppsDetected: Array<{
    name: string
    pid: number
    reason?: string
  }>
  systemInfo: {
    cpuUsage: number
    memoryUsage: number
    uptime: number
  }
  recentProcesses: ProcessInfo[]
  timestamp: number
  error?: string
}


// ============================================================================
// NETWORK TRAFFIC MONITORING TYPES
// ============================================================================

export interface NetworkRequest {
  timestamp: number
  method: string
  url: string
  domain: string
  service: string
  processName: string
  pid: number
  responseCode?: number
  size?: number
}

export interface NetworkTrafficStatus {
  recentRequests: NetworkRequest[]
  totalRequests: number
  aiApiRequests: NetworkRequest[]
  timestamp: number
  error?: string
}

// ============================================================================
// BROWSER AI MONITORING TYPES
// ============================================================================

export interface BrowserAIActivity {
  timestamp: number
  browser: string
  processName: string
  pid: number
  connectionType: string
  remoteAddress: string
  service: string
  confidence: 'high' | 'medium' | 'low'
}

export interface BrowserAIStatus {
  recentActivity: BrowserAIActivity[]
  totalActivity: number
  highConfidenceActivity: BrowserAIActivity[]
  timestamp: number
  error?: string
}

// ============================================================================
// COMPONENT PROP TYPES
// ============================================================================

export interface ProcessMonitorProps {
  onStatusUpdate: (status: SecurityStatus) => void
}


export interface ProcessStatsProps {
  isVisible: boolean
  onClose: () => void
}

// ============================================================================
// SECURITY AGENT API TYPES
// ============================================================================

export interface SecurityAgentAPI {
  getStatus: () => Promise<SecurityStatus>
  onStatusUpdate: (callback: (status: SecurityStatus) => void) => void
  getProcessStats: () => Promise<ProcessStatsData>
  onProcessStatsUpdate: (callback: (stats: ProcessStatsData) => void) => void
}


