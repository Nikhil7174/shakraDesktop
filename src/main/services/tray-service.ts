import { Tray, Menu, app } from 'electron'
import { Service } from './lifecycle'
import { WindowService } from './window-service'

export class TrayService implements Service {
  name = 'tray'
  private tray: Tray | null = null
  private windowService: WindowService

  constructor(windowService: WindowService) {
    this.windowService = windowService
  }

  async initialize(): Promise<void> {
    const icon = this.windowService.getIcon()
    if (!icon || icon.isEmpty()) {
      console.warn('⚠️ [Tray] Cannot create tray - no valid icon')
      return
    }

    this.tray = new Tray(icon)
    
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: 'Shakra AI Interview', 
        enabled: false 
      },
      { 
        label: 'Show Interview Window', 
        click: () => this.windowService.show() 
      },
      { type: 'separator' },
      { 
        label: 'Security Status: Active', 
        enabled: false 
      },
      { type: 'separator' },
      { 
        label: 'Quit', 
        click: () => {
          console.log('Quit requested from tray menu...')
          app.quit()
        }
      }
    ])
    
    this.tray.setToolTip('Shakra AI Interview - Security Monitoring Active')
    this.tray.setContextMenu(contextMenu)
    
    this.tray.on('double-click', () => {
      this.windowService.show()
    })
  }

  async shutdown(): Promise<void> {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}

