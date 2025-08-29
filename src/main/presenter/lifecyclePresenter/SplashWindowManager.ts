/**
 * SplashWindowManager - Manages splash screen display during application initialization
 */

import path from 'path'
import { BrowserWindow, nativeImage } from 'electron'
import { eventBus } from '../../eventbus'
import { LIFECYCLE_EVENTS } from '@/events'
import { ISplashWindowManager } from '@shared/presenter'
import { is } from '@electron-toolkit/utils'
import icon from '../../../../resources/icon.png?asset' // 应用图标 (macOS/Linux)
import iconWin from '../../../../resources/icon.ico?asset' // 应用图标 (Windows)
import { LifecyclePhase } from '@shared/lifecycle'
import { ProgressUpdatedEventData } from './types'

export class SplashWindowManager implements ISplashWindowManager {
  private splashWindow: BrowserWindow | null = null

  /**
   * Create and display the splash window
   */
  async create(): Promise<void> {
    if (this.splashWindow) {
      console.warn('Splash window already exists')
      return
    }

    const iconFile = nativeImage.createFromPath(process.platform === 'win32' ? iconWin : icon)

    try {
      this.splashWindow = new BrowserWindow({
        width: 400,
        height: 300,
        icon: iconFile,
        resizable: false,
        movable: false,
        frame: false,
        alwaysOnTop: true,
        center: true,
        show: false, // 先隐藏窗口，等待 ready-to-show 以避免白屏
        autoHideMenuBar: true,
        skipTaskbar: true
      })

      // Show the window
      this.splashWindow.on('ready-to-show', () => {
        setTimeout(() => {
          this.splashWindow?.show()
        }, 800)
      })

      // Load the splash HTML template
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        this.splashWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/splash/index.html')
      } else {
        this.splashWindow.loadFile(path.join(__dirname, '../renderer/splash/index.html'))
      }

      // Handle window closed event6
      this.splashWindow.on('closed', () => {
        this.splashWindow = null
      })

      console.log('Splash window created and displayed')
    } catch (error) {
      console.error('Failed to create splash window:', error)
      throw error
    }
  }

  /**
   * Update progress based on lifecycle phase
   */
  updateProgress(phase: LifecyclePhase, progress: number): void {
    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      return
    }

    const phaseMessages = {
      [LifecyclePhase.INIT]: 'Initializing application...',
      [LifecyclePhase.BEFORE_START]: 'Preparing startup...',
      [LifecyclePhase.READY]: 'Loading components...',
      [LifecyclePhase.AFTER_START]: 'Finalizing startup...'
    }

    const message = phaseMessages[phase] || 'Loading...'
    const clamped = Math.max(0, Math.min(100, progress))

    // Emit progress event to both main and renderer processes
    eventBus.sendToMain(LIFECYCLE_EVENTS.PROGRESS_UPDATED, {
      phase,
      progress: clamped,
      message
    } as ProgressUpdatedEventData)
    this.splashWindow.webContents.send('splash-update', {
      phase,
      progress: clamped,
      message
    })
  }

  /**
   * Close the splash window
   */
  async close(): Promise<void> {
    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      return
    }

    try {
      // Add a small delay for smooth transition
      await new Promise((resolve) => setTimeout(resolve, 500))

      this.splashWindow.close()
      this.splashWindow = null

      console.log('Splash window closed')
    } catch (error) {
      console.error('Failed to close splash window:', error)
    }
  }

  /**
   * Check if splash window is currently visible
   */
  isVisible(): boolean {
    return (
      this.splashWindow !== null &&
      !this.splashWindow.isDestroyed() &&
      this.splashWindow.isVisible()
    )
  }
}
