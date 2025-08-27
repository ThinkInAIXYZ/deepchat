import { LifecyclePhase } from './../../../src/shared/lifecycle'
import { SplashWindowManager } from './../../../src/main/lib/lifecycle/SplashWindowManager'
/**
 * Unit tests for SplashWindowManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserWindow } from 'electron'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadFile: vi.fn().mockResolvedValue(undefined),
    show: vi.fn(),
    close: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    isVisible: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    webContents: {
      send: vi.fn()
    }
  }))
}))

// Mock eventBus
vi.mock('../../src/main/eventbus', () => ({
  eventBus: {
    sendToMain: vi.fn(),
    sendToRenderer: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
  }
}))

describe('SplashWindowManager', () => {
  let splashManager: SplashWindowManager
  let mockBrowserWindow: any

  beforeEach(() => {
    vi.clearAllMocks()
    splashManager = new SplashWindowManager()
    mockBrowserWindow = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      show: vi.fn(),
      close: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      webContents: {
        send: vi.fn()
      }
    }
    ;(BrowserWindow as any).mockImplementation(() => mockBrowserWindow)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('create', () => {
    it('should create and display splash window', async () => {
      await splashManager.create()

      expect(BrowserWindow).toHaveBeenCalledWith({
        width: 400,
        height: 300,
        resizable: false,
        frame: false,
        alwaysOnTop: true,
        center: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        }
      })

      expect(mockBrowserWindow.loadFile).toHaveBeenCalled()
      expect(mockBrowserWindow.show).toHaveBeenCalled()
      expect(mockBrowserWindow.on).toHaveBeenCalledWith('closed', expect.any(Function))
    })

    it('should not create window if already exists', async () => {
      await splashManager.create()
      vi.clearAllMocks()

      await splashManager.create()

      expect(BrowserWindow).not.toHaveBeenCalled()
    })

    it('should handle creation errors', async () => {
      mockBrowserWindow.loadFile.mockRejectedValue(new Error('Load failed'))

      await expect(splashManager.create()).rejects.toThrow('Load failed')
    })
  })

  describe('updateProgress', () => {
    beforeEach(async () => {
      await splashManager.create()
    })

    it('should update progress for lifecycle phase', () => {
      splashManager.updateProgress(LifecyclePhase.INIT, 25)

      expect(mockBrowserWindow.webContents.send).toHaveBeenCalledWith('splash-update', {
        phase: LifecyclePhase.INIT,
        progress: 25,
        message: 'Initializing application...'
      })
    })

    it('should clamp progress values', () => {
      splashManager.updateProgress(LifecyclePhase.INIT, 150)

      expect(mockBrowserWindow.webContents.send).toHaveBeenCalledWith('splash-update', {
        phase: LifecyclePhase.INIT,
        progress: 100,
        message: 'Initializing application...'
      })

      splashManager.updateProgress(LifecyclePhase.INIT, -10)

      expect(mockBrowserWindow.webContents.send).toHaveBeenCalledWith('splash-update', {
        phase: LifecyclePhase.INIT,
        progress: 0,
        message: 'Initializing application...'
      })
    })

    it('should handle different lifecycle phases', () => {
      const phases = [
        { phase: LifecyclePhase.INIT, message: 'Initializing application...' },
        { phase: LifecyclePhase.BEFORE_START, message: 'Preparing startup...' },
        { phase: LifecyclePhase.READY, message: 'Loading components...' },
        { phase: LifecyclePhase.AFTER_START, message: 'Finalizing startup...' }
      ]

      phases.forEach(({ phase, message }) => {
        splashManager.updateProgress(phase, 50)

        expect(mockBrowserWindow.webContents.send).toHaveBeenCalledWith('splash-update', {
          phase,
          progress: 50,
          message
        })
      })
    })

    it('should not update if window is destroyed', () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(true)

      splashManager.updateProgress(LifecyclePhase.INIT, 25)

      expect(mockBrowserWindow.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('updateMessage', () => {
    beforeEach(async () => {
      await splashManager.create()
    })

    it('should update custom message', () => {
      const customMessage = 'Custom loading message'
      splashManager.updateMessage(customMessage)

      expect(mockBrowserWindow.webContents.send).toHaveBeenCalledWith('splash-message', {
        message: customMessage
      })
    })

    it('should not update if window is destroyed', () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(true)

      splashManager.updateMessage('Test message')

      expect(mockBrowserWindow.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('close', () => {
    beforeEach(async () => {
      await splashManager.create()
    })

    it('should close splash window with delay', async () => {
      vi.useFakeTimers()

      const closePromise = splashManager.close()

      // Fast-forward the delay
      vi.advanceTimersByTime(500)

      await closePromise

      expect(mockBrowserWindow.close).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should handle close errors', async () => {
      mockBrowserWindow.close.mockImplementation(() => {
        throw new Error('Close failed')
      })

      // Should not throw, just log error
      await expect(splashManager.close()).resolves.toBeUndefined()
    })

    it('should not close if window is already destroyed', async () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(true)

      await splashManager.close()

      expect(mockBrowserWindow.close).not.toHaveBeenCalled()
    })
  })

  describe('isVisible', () => {
    it('should return false when no window exists', () => {
      expect(splashManager.isVisible()).toBe(false)
    })

    it('should return true when window is visible', async () => {
      await splashManager.create()

      expect(splashManager.isVisible()).toBe(true)
    })

    it('should return false when window is destroyed', async () => {
      await splashManager.create()
      mockBrowserWindow.isDestroyed.mockReturnValue(true)

      expect(splashManager.isVisible()).toBe(false)
    })

    it('should return false when window is not visible', async () => {
      await splashManager.create()
      mockBrowserWindow.isVisible.mockReturnValue(false)

      expect(splashManager.isVisible()).toBe(false)
    })
  })
})
