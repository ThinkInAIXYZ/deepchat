/**
 * SplashWindowManager - Manages splash screen display during application initialization
 */

import path from 'path'
import { BrowserWindow, nativeImage } from 'electron'
import { eventBus } from '../../eventbus'
import { LIFECYCLE_EVENTS, WINDOW_EVENTS } from '@/events'
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
import { releasePresenterCallErrorStateForWebContents } from '../presenterCallErrorHandler'

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

type WindowCreatedPayload =
  | number
  | {
      windowId?: number
      isMainWindow?: boolean
      windowType?: string
    }

const MAX_SPLASH_ACTIVITIES = 3
const SPLASH_SHOW_DELAY_MS = 200

export class SplashWindowManager implements ISplashWindowManager {
  private splashWindow: BrowserWindow | null = null
  private activities = new Map<string, SplashActivityItem>()
  private splashReadyToShow = false
  private splashShowDelayElapsed = false
  private suppressSplashShow = false
  private splashShowDelayTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onHookExecuted = (data: HookExecutedEventData) => {
    if (!this.isStartupPhase(data.phase)) {
      return
    }

    this.upsertActivity(data.phase, data.name, 'running')
  }
  private readonly onHookCompleted = (data: HookExecutedEventData) => {
    if (!this.isStartupPhase(data.phase)) {
      return
    }

    this.upsertActivity(data.phase, data.name, 'completed')
  }
  private readonly onHookFailed = (data: HookFailedEventData) => {
    if (!this.isStartupPhase(data.phase)) {
      return
    }

    this.upsertActivity(data.phase, data.name, 'failed')
  }
  private readonly onErrorOccurred = (data: ErrorOccurredEventData) => {
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
  }
  private readonly onMainWindowCreated = (payload?: WindowCreatedPayload) => {
    if (!this.shouldSuppressForWindowCreated(payload) || this.isVisible()) {
      return
    }

    this.suppressSplashShow = true
    this.clearSplashShowDelayTimer()
    eventBus.off(WINDOW_EVENTS.WINDOW_CREATED, this.onMainWindowCreated)
    this.closeHiddenSplashWindow()
  }

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

    this.splashReadyToShow = false
    this.splashShowDelayElapsed = false
    this.suppressSplashShow = false
    this.clearSplashShowDelayTimer()
    eventBus.on(WINDOW_EVENTS.WINDOW_CREATED, this.onMainWindowCreated)

    this.splashShowDelayTimer = setTimeout(() => {
      this.splashShowDelayElapsed = true
      this.maybeShowSplash()
    }, SPLASH_SHOW_DELAY_MS)

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
      const splashWebContentsId = this.splashWindow.webContents.id

      this.splashWindow.on('ready-to-show', () => {
        this.splashReadyToShow = true
        this.maybeShowSplash()
      })

      this.splashWindow.webContents.on('destroyed', () => {
        releasePresenterCallErrorStateForWebContents(splashWebContentsId)
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
        this.clearSplashShowDelayTimer()
        this.splashWindow = null
      })

      if (this.suppressSplashShow) {
        this.closeHiddenSplashWindow()
      }
    } catch (error) {
      eventBus.off(WINDOW_EVENTS.WINDOW_CREATED, this.onMainWindowCreated)
      this.clearSplashShowDelayTimer()
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
    eventBus.off(LIFECYCLE_EVENTS.HOOK_EXECUTED, this.onHookExecuted)
    eventBus.off(LIFECYCLE_EVENTS.HOOK_COMPLETED, this.onHookCompleted)
    eventBus.off(LIFECYCLE_EVENTS.HOOK_FAILED, this.onHookFailed)
    eventBus.off(LIFECYCLE_EVENTS.ERROR_OCCURRED, this.onErrorOccurred)
    eventBus.off(WINDOW_EVENTS.WINDOW_CREATED, this.onMainWindowCreated)

    this.activities.clear()
    this.emitState()
    this.clearSplashShowDelayTimer()

    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      return
    }

    try {
      if (this.splashWindow.isVisible()) {
        // Add a small delay for smooth transition when the splash is actually visible.
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

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
    eventBus.on(LIFECYCLE_EVENTS.HOOK_EXECUTED, this.onHookExecuted)
    eventBus.on(LIFECYCLE_EVENTS.HOOK_COMPLETED, this.onHookCompleted)
    eventBus.on(LIFECYCLE_EVENTS.HOOK_FAILED, this.onHookFailed)
    eventBus.on(LIFECYCLE_EVENTS.ERROR_OCCURRED, this.onErrorOccurred)
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

  private maybeShowSplash(): void {
    if (
      !this.splashWindow ||
      this.splashWindow.isDestroyed() ||
      this.suppressSplashShow ||
      !this.splashReadyToShow ||
      !this.splashShowDelayElapsed
    ) {
      return
    }

    this.splashWindow.show()
  }

  private clearSplashShowDelayTimer(): void {
    if (this.splashShowDelayTimer) {
      clearTimeout(this.splashShowDelayTimer)
      this.splashShowDelayTimer = null
    }
  }

  private shouldSuppressForWindowCreated(payload?: WindowCreatedPayload): boolean {
    if (!payload || typeof payload === 'number') {
      return false
    }

    return payload.isMainWindow === true || payload.windowType === 'main'
  }

  private closeHiddenSplashWindow(): void {
    if (!this.splashWindow || this.splashWindow.isDestroyed() || this.splashWindow.isVisible()) {
      return
    }

    try {
      this.splashWindow.close()
    } catch (error) {
      console.error('Failed to close hidden splash window:', error)
    }
  }
}
