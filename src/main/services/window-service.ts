import { app, BrowserWindow, nativeImage, globalShortcut } from 'electron'
import { join, resolve } from 'path'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { is } from '@electron-toolkit/utils'
import { format } from 'url'
import { Service } from './lifecycle'
import { optimizer } from '@electron-toolkit/utils'

export class WindowService implements Service {
  name = 'window'
  public mainWindow: BrowserWindow | null = null
  private iconPath: string | undefined
  private appIcon: Electron.NativeImage | undefined

  async initialize(): Promise<void> {
    this.resolveIconPath()

    // Optimize window on macOS
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    this.createWindow()
    this.registerShortcuts()

    // Linux/Wayland desktop file
    if (process.platform === 'linux' && !app.isPackaged) {
      this.createDesktopFile()

      if (this.iconPath && existsSync(this.iconPath)) {
        try {
          app.dock?.setIcon?.(this.appIcon || this.iconPath)
          console.log('✅ [Icon] App icon configured for Linux')
        } catch (err) {
          // Ignore
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    globalShortcut.unregisterAll()
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy()
      this.mainWindow = null
    }
  }

  public getIcon(): Electron.NativeImage | undefined {
    return this.appIcon
  }

  public show(): void {
    if (this.mainWindow) {
      this.mainWindow.show()
      this.mainWindow.focus()
    }
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  public sendDeepLink(url: string): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.show()
      this.mainWindow.focus()
      this.mainWindow.webContents.send('deep-link', url)
      console.log('🔗 [Window] Deep link sent to renderer:', url)
    }
  }

  private resolveIconPath(): void {
    const possiblePaths = app.isPackaged
      ? [
        join(process.resourcesPath, 'icon.png'),
        join(process.resourcesPath, 'resources', 'icon.png')
      ]
      : [
        resolve(__dirname, '../../resources/icon.png'),
        join(app.getAppPath(), 'resources/icon.png'),
        resolve(process.cwd(), 'resources/icon.png'),
        resolve(process.cwd(), 'crispDesktop/resources/icon.png')
      ]

    console.log('🔍 [Icon] Searching for icon in paths:')
    for (const path of possiblePaths) {
      console.log(`  - ${path} ${existsSync(path) ? '✅ EXISTS' : '❌ NOT FOUND'}`)
      if (existsSync(path)) {
        this.iconPath = resolve(path)
        console.log('✅ [Icon] Found icon at:', this.iconPath)
        break
      }
    }

    if (this.iconPath) {
      try {
        this.appIcon = nativeImage.createFromPath(this.iconPath)
        if (this.appIcon.isEmpty()) {
          console.warn('⚠️ [Icon] Icon file exists but is empty or invalid')
          this.appIcon = undefined
        } else {
          const size = this.appIcon.getSize()
          console.log(`✅ [Icon] Icon loaded successfully: ${size.width}x${size.height} from ${this.iconPath}`)
        }
      } catch (error) {
        console.error('❌ [Icon] Failed to load icon:', error)
        this.appIcon = undefined
      }
    } else {
      console.warn('⚠️ [Icon] Icon not found in any of these paths:', possiblePaths)
      console.error('❌ [Icon] No icon path found - will use default')
    }
  }

  private createWindow(): void {
    const windowIcon = this.appIcon && !this.appIcon.isEmpty() ? this.appIcon : (this.iconPath || undefined)

    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      ...(windowIcon ? { icon: windowIcon } : {}),
      show: false,
      fullscreen: false,
      maximizable: true,
      resizable: true,
      // autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false
      }
    })

    if (is.dev) {
      this.mainWindow.webContents.openDevTools()
    }

    // Set icon explicitly for Wayland/GNOME compatibility
    if (this.iconPath) {
      try {
        this.mainWindow.setIcon(this.iconPath)
      } catch (err) {
        console.warn('⚠️ [Icon] Failed to set icon via path:', err)
      }

      if (this.appIcon && !this.appIcon.isEmpty()) {
        try {
          this.mainWindow.setIcon(this.appIcon)
        } catch (err) {
          // Ignore
        }
      }
    }

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show()
      this.mainWindow?.maximize()

      if (this.iconPath) {
        setTimeout(() => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            try {
              this.mainWindow.setIcon(this.iconPath!)
            } catch (err) {
              // Ignore
            }
          }
        }, 100)

        if (this.appIcon && !this.appIcon.isEmpty()) {
          setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              try {
                this.mainWindow.setIcon(this.appIcon!)
              } catch (err) {
                // Ignore
              }
            }
          }, 200)
        }
      }
    })

    // Load the UI
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      const htmlPath = join(__dirname, '../renderer/index.html')

      this.mainWindow.loadFile(htmlPath).catch((error) => {
        console.error('❌ [Main] loadFile failed, trying loadURL with file:// protocol:', error)
        const fileUrl = format({
          pathname: htmlPath.replace(/\\/g, '/'),
          protocol: 'file:',
          slashes: true
        })
        this.mainWindow?.loadURL(fileUrl).catch((fallbackError) => {
          console.error('❌ [Main] Fallback also failed:', fallbackError)
        })
      })
    }

    this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('❌ [Main] Page failed to load:', { errorCode, errorDescription, validatedURL })
    })

    this.mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.log(`[Renderer ${level === 2 ? 'WARN' : 'ERROR'}]`, message, `(${sourceId}:${line})`)
      }
    })

    this.mainWindow.webContents.once('did-finish-load', () => {
      console.log('✅ [Main] Page loaded successfully')
      if (this.iconPath && this.mainWindow && !this.mainWindow.isDestroyed()) {
        const setIconAttempts = [0, 100, 300, 500, 1000]
        setIconAttempts.forEach((delay) => {
          setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              try {
                this.mainWindow.setIcon(this.iconPath!)
                if (this.appIcon && !this.appIcon.isEmpty()) {
                  this.mainWindow.setIcon(this.appIcon)
                }
              } catch (err) {
                // Ignore
              }
            }
          }, delay)
        })
      }
    })

    if (process.platform === 'linux' && this.iconPath) {
      this.mainWindow.on('focus', () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed() && this.iconPath) {
          setTimeout(() => {
            try {
              this.mainWindow?.setIcon(this.iconPath!)
              if (this.appIcon && !this.appIcon.isEmpty()) {
                this.mainWindow?.setIcon(this.appIcon)
              }
            } catch (err) {
              // Ignore
            }
          }, 100)
        }
      })
    }

    this.mainWindow.on('close', (event) => {
      if (process.platform !== 'darwin') {
        event.preventDefault()
        console.log('Window closed, quitting...')
        app.quit()
      } else {
        event.preventDefault()
        this.mainWindow?.hide()
      }
    })
  }

  private registerShortcuts(): void {
    globalShortcut.register('CommandOrControl+Shift+S', () => {
      if (this.mainWindow) {
        if (this.mainWindow.isVisible()) {
          this.mainWindow.hide()
        } else {
          this.mainWindow.show()
          this.mainWindow.focus()
        }
      }
    })
  }

  private createDesktopFile(): void {
    if (!this.iconPath || !existsSync(this.iconPath)) {
      console.warn('⚠️ [Desktop] Cannot create desktop file - icon not found')
      return
    }

    try {
      const desktopDir = join(homedir(), '.local', 'share', 'applications')
      mkdirSync(desktopDir, { recursive: true })

      const desktopFile = join(desktopDir, 'shakra-ai-interview-dev.desktop')
      const execPath = process.execPath
      const iconAbsolutePath = resolve(this.iconPath)

      const desktopContent = `[Desktop Entry]
Name=Shakra AI Interview (Dev)
Comment=AI-powered interview platform with security monitoring
Exec=${execPath} %u
Icon=${iconAbsolutePath}
Type=Application
Categories=Utility;Development;
MimeType=x-scheme-handler/shakra-app;
StartupNotify=true
StartupWMClass=electron
NoDisplay=false
`

      writeFileSync(desktopFile, desktopContent, { mode: 0o755 })
      console.log(`✅ [Desktop] Created desktop file: ${desktopFile}`)

      try {
        const { exec } = require('child_process')
        exec('update-desktop-database ~/.local/share/applications', (error: any) => {
          if (error) {
            console.warn('⚠️ [Desktop] Could not update desktop database (non-critical):', error.message)
          } else {
            console.log('✅ [Desktop] Desktop database updated')
          }
        })
      } catch (err) {
        // Ignore
      }
    } catch (error) {
      console.error('❌ [Desktop] Failed to create desktop file:', error)
    }
  }
}

