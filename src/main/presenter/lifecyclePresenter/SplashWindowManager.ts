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
import {
  ErrorOccurredEventData,
  HookExecutedEventData,
  HookFailedEventData,
  ProgressUpdatedEventData
} from './types'

type SplashActivityStatus = 'running' | 'completed' | 'failed'

interface SplashActivityItem {
  key: string
  name: string
  status: SplashActivityStatus
  updatedAt: number
}

interface SplashUpdatePayload {
  activities: Array<Pick<SplashActivityItem, 'key' | 'name' | 'status'>>
}

const MAX_SPLASH_ACTIVITIES = 3

export class SplashWindowManager implements ISplashWindowManager {
  private splashWindow: BrowserWindow | null = null
  private activities = new Map<string, SplashActivityItem>()

  constructor() {
    this.setupLifecycleListeners()
  }

  /**
   * Create and display the splash window
   */
  async create(): Promise<void> {
    if (this.splashWindow) {
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
        skipTaskbar: true,
        backgroundColor: '#020817',
        webPreferences: {
          preload: path.join(__dirname, '../preload/index.mjs'),
          sandbox: false,
          devTools: is.dev
        }
      })

      // Show the window
      this.splashWindow.on('ready-to-show', () => {
        setTimeout(() => {
          this.splashWindow?.show()
        }, 800)
      })

      this.splashWindow.webContents.on('did-finish-load', () => {
        this.emitState()
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

  private setupLifecycleListeners(): void {
    eventBus.on(LIFECYCLE_EVENTS.HOOK_EXECUTED, (data: HookExecutedEventData) => {
      if (!this.isStartupPhase(data.phase)) {
        return
      }

      this.upsertActivity(data.phase, data.name, 'running')
    })

    eventBus.on(LIFECYCLE_EVENTS.HOOK_COMPLETED, (data: HookExecutedEventData) => {
      if (!this.isStartupPhase(data.phase)) {
        return
      }

      this.upsertActivity(data.phase, data.name, 'completed')
    })

    eventBus.on(LIFECYCLE_EVENTS.HOOK_FAILED, (data: HookFailedEventData) => {
      if (!this.isStartupPhase(data.phase)) {
        return
      }

      this.upsertActivity(data.phase, data.name, 'failed')
    })

    eventBus.on(LIFECYCLE_EVENTS.ERROR_OCCURRED, (data: ErrorOccurredEventData) => {
      if (!this.isStartupPhase(data.phase)) {
        return
      }

      this.activities.set(`error:${data.phase}`, {
        key: `error:${data.phase}`,
        name: 'startup-error',
        status: 'failed',
        updatedAt: Date.now()
      })
      this.pruneActivities()
      this.emitState()
    })
  }

  private isStartupPhase(phase: LifecyclePhase | null): phase is LifecyclePhase {
    return phase !== null && phase !== LifecyclePhase.BEFORE_QUIT
  }

  private upsertActivity(
    phase: LifecyclePhase,
    hookName: string,
    status: SplashActivityStatus
  ): void {
    const key = `${phase}:${hookName}`

    this.activities.set(key, {
      key,
      name: hookName,
      status,
      updatedAt: Date.now()
    })

    this.pruneActivities()
    this.emitState()
  }

  private pruneActivities(): void {
    const sorted = Array.from(this.activities.values()).sort((a, b) => b.updatedAt - a.updatedAt)

    this.activities = new Map(
      sorted.slice(0, MAX_SPLASH_ACTIVITIES).map((activity) => [activity.key, activity])
    )
  }

  private emitState(): void {
    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      return
    }

    const payload: SplashUpdatePayload = {
      activities: Array.from(this.activities.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(({ key, name, status }) => ({
          key,
          name,
          status
        }))
    }

    this.splashWindow.webContents.send('splash-update', payload)
  }
}
