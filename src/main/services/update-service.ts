import { autoUpdater } from 'electron-updater'
import { Service } from './lifecycle'

export class UpdateService implements Service {
    name = 'UpdateService'

    async initialize(): Promise<void> {
        console.log('🚀 [UpdateService] Initializing auto-updater...')

        // Configure logging for the updater
        autoUpdater.logger = console

        // Optional: set to false if you want to control when it downloads
        autoUpdater.autoDownload = true

        // Event listeners
        autoUpdater.on('checking-for-update', () => {
            console.log('🔄 [UpdateService] Checking for update...')
        })

        autoUpdater.on('update-available', (info) => {
            console.log('📢 [UpdateService] Update available:', info.version)
        })

        autoUpdater.on('update-not-available', (info) => {
            console.log('✅ [UpdateService] Update not available:', info.version)
        })

        autoUpdater.on('error', (err) => {
            console.error('❌ [UpdateService] Error in auto-updater:', err)
        })

        autoUpdater.on('download-progress', (progressObj) => {
            let logMessage = 'Download speed: ' + progressObj.bytesPerSecond
            logMessage = logMessage + ' - Downloaded ' + progressObj.percent + '%'
            logMessage = logMessage + ' (' + progressObj.transferred + '/' + progressObj.total + ')'
            console.log('📥 [UpdateService] ' + logMessage)
        })

        autoUpdater.on('update-downloaded', (info) => {
            console.log('📦 [UpdateService] Update downloaded:', info.version)
            // You can notify the user and ask to restart
            // For now, let's just log it. In a real app, you might use IPC to show a notification in the renderer.
        })

        // Check for updates
        try {
            if (process.env.NODE_ENV === 'production') {
                await autoUpdater.checkForUpdatesAndNotify()
            } else {
                console.log('⚠️ [UpdateService] Skipping update check in development mode')
            }
        } catch (error) {
            console.error('❌ [UpdateService] Failed to check for updates:', error)
        }
    }

    async shutdown(): Promise<void> {
        console.log('🛑 [UpdateService] Shutting down...')
        // No specific cleanup needed for autoUpdater usually
    }
}
