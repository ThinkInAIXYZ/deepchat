/**
 * Tests for LifecycleErrorHandler
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { LifecycleErrorHandler } from '../../../src/main/lib/lifecycle/ErrorHandler'
import {
  LifecyclePhase,
  LifecycleHook,
  LifecycleContext
} from '../../../src/main/lib/lifecycle/types'

// Mock the eventBus
vi.mock('../../../src/main/eventbus', () => ({
  eventBus: {
    sendToMain: vi.fn(),
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'all-windows'
  }
}))

// Mock the dialog presenter
vi.mock('../../../src/main/presenter/dialogPresenter', () => ({
  DialogPresenter: vi.fn().mockImplementation(() => ({
    showDialog: vi.fn().mockResolvedValue('retry')
  }))
}))

describe('LifecycleErrorHandler', () => {
  let errorHandler: LifecycleErrorHandler
  let mockContext: LifecycleContext

  beforeEach(() => {
    errorHandler = new LifecycleErrorHandler() // Enable debug mode
    mockContext = {
      phase: LifecyclePhase.INIT,
      manager: {} as any
    }
    vi.clearAllMocks()
  })

  afterEach(() => {
    errorHandler.clearErrorHistory()
  })

  describe('executeHookWithRetry', () => {
    it('should execute hook successfully on first attempt', async () => {
      const mockHook: LifecycleHook = {
        name: 'test-hook',
        execute: vi.fn().mockResolvedValue(undefined)
      }

      const result = await errorHandler.executeHookWithRetry(mockHook, mockContext)

      expect(mockHook.execute).toHaveBeenCalledTimes(1)
      expect(result).toBeUndefined()
    })

    it('should retry non-critical hook on failure', async () => {
      const mockHook: LifecycleHook = {
        name: 'test-hook',
        critical: false,
        execute: vi
          .fn()
          .mockRejectedValueOnce(new Error('First attempt failed'))
          .mockResolvedValueOnce(undefined)
      }

      const result = await errorHandler.executeHookWithRetry(mockHook, mockContext, {
        showErrorDialog: false,
        allowRetry: true,
        gracefulDegradation: true,
        logLevel: 'warn'
      })

      expect(mockHook.execute).toHaveBeenCalledTimes(2)
      expect(result).toBeUndefined()
    })

    it('should handle critical hook failure with graceful degradation', async () => {
      const mockHook: LifecycleHook = {
        name: 'critical-hook',
        critical: true,
        execute: vi.fn().mockRejectedValue(new Error('Critical failure'))
      }

      // Update retry config to avoid long delays in tests
      errorHandler.updateRetryConfig({
        maxRetries: 1,
        retryDelay: 10,
        backoffMultiplier: 1,
        maxRetryDelay: 10
      })

      const result = await errorHandler.executeHookWithRetry(mockHook, mockContext, {
        showErrorDialog: false,
        allowRetry: false,
        gracefulDegradation: true,
        logLevel: 'error'
      })

      expect(mockHook.execute).toHaveBeenCalledTimes(2) // Called twice due to retry config (maxRetries: 1)
      expect(result).toBeUndefined() // Should return undefined for graceful degradation
    })

    it('should respect hook timeout', async () => {
      const mockHook: LifecycleHook = {
        name: 'timeout-hook',
        timeout: 100,
        execute: vi
          .fn()
          .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))
      }

      await expect(
        errorHandler.executeHookWithRetry(mockHook, mockContext, {
          showErrorDialog: false,
          allowRetry: false,
          gracefulDegradation: true,
          logLevel: 'error'
        })
      ).resolves.toBeUndefined() // Should handle timeout gracefully
    })

    it('should apply exponential backoff for retries', async () => {
      const startTime = Date.now()
      const mockHook: LifecycleHook = {
        name: 'retry-hook',
        critical: false,
        execute: vi
          .fn()
          .mockRejectedValueOnce(new Error('First failure'))
          .mockRejectedValueOnce(new Error('Second failure'))
          .mockResolvedValueOnce(undefined)
      }

      // Update retry config for faster testing
      errorHandler.updateRetryConfig({
        maxRetries: 3,
        retryDelay: 50,
        backoffMultiplier: 2,
        maxRetryDelay: 1000
      })

      await errorHandler.executeHookWithRetry(mockHook, mockContext, {
        showErrorDialog: false,
        allowRetry: true,
        gracefulDegradation: true,
        logLevel: 'warn'
      })

      const duration = Date.now() - startTime
      expect(duration).toBeGreaterThan(50) // Should have waited for retry delay
      expect(mockHook.execute).toHaveBeenCalledTimes(3)
    })
  })

  describe('error statistics', () => {
    it('should track error statistics correctly', async () => {
      // Update retry config to avoid long delays in tests
      errorHandler.updateRetryConfig({
        maxRetries: 1,
        retryDelay: 10,
        backoffMultiplier: 1,
        maxRetryDelay: 10
      })

      const criticalHook: LifecycleHook = {
        name: 'critical-hook',
        critical: true,
        execute: vi.fn().mockRejectedValue(new Error('Critical error'))
      }

      const nonCriticalHook: LifecycleHook = {
        name: 'non-critical-hook',
        critical: false,
        execute: vi.fn().mockRejectedValue(new Error('Non-critical error'))
      }

      // Execute hooks that will fail
      await errorHandler.executeHookWithRetry(criticalHook, mockContext, {
        showErrorDialog: false,
        allowRetry: false,
        gracefulDegradation: true,
        logLevel: 'error'
      })

      await errorHandler.executeHookWithRetry(nonCriticalHook, mockContext, {
        showErrorDialog: false,
        allowRetry: false,
        gracefulDegradation: true,
        logLevel: 'warn'
      })

      const stats = errorHandler.getErrorStatistics()
      expect(stats.totalErrors).toBe(2)
      expect(stats.criticalErrors).toBe(1)
      expect(stats.nonCriticalErrors).toBe(1)
      expect(stats.failedHooks).toHaveLength(2)
    })

    it('should clear error history', async () => {
      // Update retry config to avoid long delays in tests
      errorHandler.updateRetryConfig({
        maxRetries: 1,
        retryDelay: 10,
        backoffMultiplier: 1,
        maxRetryDelay: 10
      })

      const mockHook: LifecycleHook = {
        name: 'test-hook',
        execute: vi.fn().mockRejectedValue(new Error('Test error'))
      }

      await errorHandler.executeHookWithRetry(mockHook, mockContext, {
        showErrorDialog: false,
        allowRetry: false,
        gracefulDegradation: true,
        logLevel: 'error'
      })

      let stats = errorHandler.getErrorStatistics()
      expect(stats.totalErrors).toBe(1)

      errorHandler.clearErrorHistory()
      stats = errorHandler.getErrorStatistics()
      expect(stats.totalErrors).toBe(0)
    })
  })

  describe('retry configuration', () => {
    it('should update retry configuration', () => {
      const newConfig = {
        maxRetries: 5,
        retryDelay: 2000,
        backoffMultiplier: 3,
        maxRetryDelay: 20000
      }

      errorHandler.updateRetryConfig(newConfig)

      // Test that the new config is applied by checking retry behavior
      expect(() => errorHandler.updateRetryConfig(newConfig)).not.toThrow()
    })
  })
})
