/**
 * Tests for LifecycleEventMonitor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LifecycleEventMonitor } from '../../../src/main/lib/lifecycle/LifecycleEventMonitor'
import { LIFECYCLE_EVENTS } from '../../../src/main/events'

// Mock eventBus
vi.mock('../../src/main/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
    sendToMain: vi.fn(),
    sendToRenderer: vi.fn(),
    emit: vi.fn()
  }
}))

describe('LifecycleEventMonitor', () => {
  let monitor: LifecycleEventMonitor
  let mockEventBus: any

  beforeEach(async () => {
    vi.clearAllMocks()
    // Get the mocked eventBus
    const { eventBus } = await import('../../../src/main/eventbus')
    mockEventBus = eventBus
    monitor = new LifecycleEventMonitor()
  })

  afterEach(() => {
    monitor.stopMonitoring()
  })

  describe('Event Monitoring', () => {
    it('should start monitoring and set up event listeners', () => {
      monitor.startMonitoring()

      // Verify that event listeners are set up
      expect(mockEventBus.on).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.PHASE_STARTED,
        expect.any(Function)
      )
      expect(mockEventBus.on).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.PHASE_COMPLETED,
        expect.any(Function)
      )
      expect(mockEventBus.on).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.HOOK_EXECUTED,
        expect.any(Function)
      )
      expect(mockEventBus.on).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.ERROR_OCCURRED,
        expect.any(Function)
      )
      expect(mockEventBus.on).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.PROGRESS_UPDATED,
        expect.any(Function)
      )
      expect(mockEventBus.on).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.SHUTDOWN_REQUESTED,
        expect.any(Function)
      )
    })

    it('should stop monitoring and remove event listeners', () => {
      monitor.startMonitoring()
      monitor.stopMonitoring()

      // Verify that event listeners are removed
      expect(mockEventBus.off).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.PHASE_STARTED,
        expect.any(Function)
      )
      expect(mockEventBus.off).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.PHASE_COMPLETED,
        expect.any(Function)
      )
      expect(mockEventBus.off).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.HOOK_EXECUTED,
        expect.any(Function)
      )
      expect(mockEventBus.off).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.ERROR_OCCURRED,
        expect.any(Function)
      )
      expect(mockEventBus.off).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.PROGRESS_UPDATED,
        expect.any(Function)
      )
      expect(mockEventBus.off).toHaveBeenCalledWith(
        LIFECYCLE_EVENTS.SHUTDOWN_REQUESTED,
        expect.any(Function)
      )
    })
  })

  describe('Statistics Tracking', () => {
    it('should initialize with empty statistics', () => {
      const stats = monitor.getStats()

      expect(stats.totalPhases).toBe(0)
      expect(stats.completedPhases).toBe(0)
      expect(stats.totalHooks).toBe(0)
      expect(stats.successfulHooks).toBe(0)
      expect(stats.failedHooks).toBe(0)
      expect(stats.totalDuration).toBe(0)
      expect(stats.phaseStats.size).toBe(0)
    })

    it('should reset statistics', () => {
      monitor.resetStats()
      const resetStats = monitor.getStats()

      expect(resetStats.totalPhases).toBe(0)
      expect(resetStats.completedPhases).toBe(0)
      expect(resetStats.totalHooks).toBe(0)
      expect(resetStats.successfulHooks).toBe(0)
      expect(resetStats.failedHooks).toBe(0)
      expect(resetStats.totalDuration).toBe(0)
      expect(resetStats.phaseStats.size).toBe(0)
    })
  })

  describe('Utility Methods', () => {
    it('should provide printStats method', () => {
      // Mock console.log to verify output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      monitor.printStats()

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Lifecycle Statistics'))

      consoleSpy.mockRestore()
    })
  })
})
