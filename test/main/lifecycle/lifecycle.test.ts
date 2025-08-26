/**
 * Tests for LifecycleManager hook execution system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LifecycleManager } from '../../../src/main/lib/lifecycle/LifecycleManager'
import { LifecyclePhase, LifecycleHook } from '../../../src/main/lib/lifecycle/types'

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    quit: vi.fn()
  },
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

describe('LifecycleManager Hook Execution System', () => {
  let lifecycleManager: LifecycleManager
  let mockBrowserWindow: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset the BrowserWindow mock for each test
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

    // Update the BrowserWindow mock implementation
    const { BrowserWindow } = await import('electron')
    vi.mocked(BrowserWindow).mockImplementation(() => mockBrowserWindow)

    lifecycleManager = new LifecycleManager()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Hook Registration and Priority Ordering', () => {
    it('should register hooks and execute them in priority order', async () => {
      const executionOrder: string[] = []

      // Register hooks with different priorities
      const hook1: LifecycleHook = {
        name: 'high-priority',
        priority: 1,
        execute: async () => {
          executionOrder.push('high-priority')
        }
      }

      const hook2: LifecycleHook = {
        name: 'low-priority',
        priority: 100,
        execute: async () => {
          executionOrder.push('low-priority')
        }
      }

      const hook3: LifecycleHook = {
        name: 'medium-priority',
        priority: 50,
        execute: async () => {
          executionOrder.push('medium-priority')
        }
      }

      // Register hooks in random order
      lifecycleManager.registerHook(LifecyclePhase.INIT, hook2)
      lifecycleManager.registerHook(LifecyclePhase.INIT, hook1)
      lifecycleManager.registerHook(LifecyclePhase.INIT, hook3)

      // Start lifecycle to trigger hook execution
      await lifecycleManager.start()

      // Verify execution order matches priority (lower numbers first)
      expect(executionOrder).toEqual(['high-priority', 'medium-priority', 'low-priority'])
    })

    it('should return hook ID when registering hooks', () => {
      const hook: LifecycleHook = {
        name: 'test-hook',
        execute: async () => {}
      }

      const hookId = lifecycleManager.registerHook(LifecyclePhase.INIT, hook)

      expect(hookId).toMatch(/^hook_\d+_\d+$/)
    })

    it('should unregister hooks by ID', () => {
      const hook: LifecycleHook = {
        name: 'test-hook',
        execute: async () => {}
      }

      const hookId = lifecycleManager.registerHook(LifecyclePhase.INIT, hook)

      // Should not throw when unregistering valid hook
      expect(() => {
        lifecycleManager.unregisterHook(LifecyclePhase.INIT, hookId)
      }).not.toThrow()
    })
  })

  describe('Timeout Mechanism', () => {
    it('should timeout hooks that exceed their timeout limit', async () => {
      const hook: LifecycleHook = {
        name: 'slow-hook',
        timeout: 100, // 100ms timeout
        execute: async () => {
          // Simulate slow operation
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }

      lifecycleManager.registerHook(LifecyclePhase.INIT, hook)

      // Should complete despite timeout (non-critical hook)
      await expect(lifecycleManager.start()).resolves.not.toThrow()
    })

    it('should execute hooks without timeout when no timeout is specified', async () => {
      let executed = false

      const hook: LifecycleHook = {
        name: 'no-timeout-hook',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          executed = true
        }
      }

      lifecycleManager.registerHook(LifecyclePhase.INIT, hook)
      await lifecycleManager.start()

      expect(executed).toBe(true)
    })
  })

  describe('Critical vs Non-Critical Hook Failure Handling', () => {
    it('should halt progression when critical hook fails', async () => {
      const hook: LifecycleHook = {
        name: 'critical-failing-hook',
        critical: true,
        execute: async () => {
          throw new Error('Critical failure')
        }
      }

      lifecycleManager.registerHook(LifecyclePhase.INIT, hook)

      await expect(lifecycleManager.start()).rejects.toThrow('Critical lifecycle hook failed')
    })

    it('should continue progression when non-critical hook fails', async () => {
      let secondHookExecuted = false

      const failingHook: LifecycleHook = {
        name: 'non-critical-failing-hook',
        critical: false,
        execute: async () => {
          throw new Error('Non-critical failure')
        }
      }

      const successHook: LifecycleHook = {
        name: 'success-hook',
        priority: 200,
        execute: async () => {
          secondHookExecuted = true
        }
      }

      lifecycleManager.registerHook(LifecyclePhase.INIT, failingHook)
      lifecycleManager.registerHook(LifecyclePhase.INIT, successHook)

      // Should complete despite non-critical failure
      await expect(lifecycleManager.start()).resolves.not.toThrow()
      expect(secondHookExecuted).toBe(true)
    })
  })

  describe('Shutdown Interception Logic', () => {
    it('should prevent shutdown when before-quit hook returns false', async () => {
      const preventShutdownHook: LifecycleHook = {
        name: 'prevent-shutdown',
        execute: async () => false // Prevent shutdown
      }

      lifecycleManager.registerHook(LifecyclePhase.BEFORE_QUIT, preventShutdownHook)

      const canShutdown = await lifecycleManager.requestShutdown()
      expect(canShutdown).toBe(false)
    })

    it('should allow shutdown when before-quit hook returns true', async () => {
      const allowShutdownHook: LifecycleHook = {
        name: 'allow-shutdown',
        execute: async () => true // Allow shutdown
      }

      lifecycleManager.registerHook(LifecyclePhase.BEFORE_QUIT, allowShutdownHook)

      const canShutdown = await lifecycleManager.requestShutdown()
      expect(canShutdown).toBe(true)
    })

    it('should allow shutdown when before-quit hook returns undefined', async () => {
      const neutralHook: LifecycleHook = {
        name: 'neutral-hook',
        execute: async () => {
          // Return undefined (no explicit return)
        }
      }

      lifecycleManager.registerHook(LifecyclePhase.BEFORE_QUIT, neutralHook)

      const canShutdown = await lifecycleManager.requestShutdown()
      expect(canShutdown).toBe(true)
    })

    it('should prevent shutdown if any before-quit hook returns false', async () => {
      const allowHook: LifecycleHook = {
        name: 'allow-hook',
        priority: 1,
        execute: async () => true
      }

      const preventHook: LifecycleHook = {
        name: 'prevent-hook',
        priority: 2,
        execute: async () => false
      }

      lifecycleManager.registerHook(LifecyclePhase.BEFORE_QUIT, allowHook)
      lifecycleManager.registerHook(LifecyclePhase.BEFORE_QUIT, preventHook)

      const canShutdown = await lifecycleManager.requestShutdown()
      expect(canShutdown).toBe(false)
    })
  })
})
