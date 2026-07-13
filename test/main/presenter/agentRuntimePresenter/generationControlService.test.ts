import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GenerationControlService } from '@/presenter/agentRuntimePresenter/generationControlService'
import { RuntimeSharedState } from '@/presenter/agentRuntimePresenter/runtimeSharedState'

describe('GenerationControlService', () => {
  let runtimeSharedState: RuntimeSharedState
  let cancelProviderPermissions: ReturnType<typeof vi.fn>
  let service: GenerationControlService

  beforeEach(() => {
    runtimeSharedState = new RuntimeSharedState()
    cancelProviderPermissions = vi.fn()
    service = new GenerationControlService(runtimeSharedState, cancelProviderPermissions)
  })

  it('registers active runs with stable query and stream identifiers', () => {
    const firstController = new AbortController()
    const first = service.registerActiveGeneration('s1', 'm1', firstController)
    const second = service.registerActiveGeneration('s2', 'm2', new AbortController())

    expect(first.runId).toMatch(/^s1:[A-Za-z0-9_-]+$/)
    expect(second.runId).toMatch(/^s2:[A-Za-z0-9_-]+$/)
    expect(first.runId).not.toBe(second.runId)
    expect(service.getGenerationActivity('s1')).toBe('active')
    expect(service.getActiveGeneration('s1')).toEqual({ eventId: 'm1', runId: first.runId })
    expect(service.resolveStreamRequestId('s1', 'm1')).toBe(first.runId)
    expect(service.resolveStreamRequestId('s1', 'other')).toBe('other')
    expect(service.getAbortSignal('s1')).toBe(firstController.signal)
  })

  it('generates unique opaque ids for repeated runs in one session', () => {
    const first = service.registerActiveGeneration('s1', 'm1', new AbortController())
    const second = service.registerActiveGeneration('s1', 'm2', new AbortController())

    expect(first.runId).toMatch(/^s1:[A-Za-z0-9_-]+$/)
    expect(second.runId).toMatch(/^s1:[A-Za-z0-9_-]+$/)
    expect(second.runId).not.toBe(first.runId)
  })

  it('requests active cancellation without unregistering or settling the run', async () => {
    const activeController = new AbortController()
    const generation = service.registerActiveGeneration('s1', 'm1', activeController)
    const deferredController = service.registerDeferredToolController('s1', 'tc1')

    await service.cancelGeneration('s1')

    expect(activeController.signal.aborted).toBe(true)
    expect(deferredController.signal.aborted).toBe(true)
    expect(service.isActiveRun('s1', generation.runId)).toBe(true)
    expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(0)
    expect(cancelProviderPermissions).toHaveBeenCalledWith('s1')
  })

  it('aborts and removes a pre-stream controller during cancellation', async () => {
    const controller = service.ensureSessionAbortController('s1')
    expect(service.getGenerationActivity('s1')).toBe('preparing')

    await service.cancelGeneration('s1')

    expect(controller.signal.aborted).toBe(true)
    expect(service.getGenerationActivity('s1')).toBe('idle')
  })

  it('cancels only when the active event id matches', async () => {
    const controller = new AbortController()
    service.registerActiveGeneration('s1', 'm1', controller)

    expect(service.cancelGenerationByEventId('s1', 'other')).toBe(false)
    expect(controller.signal.aborted).toBe(false)

    expect(service.cancelGenerationByEventId('s1', 'm1')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('does not let a stale run clear a newer active generation', () => {
    const stale = service.registerActiveGeneration('s1', 'm1', new AbortController())
    const current = service.registerActiveGeneration('s1', 'm2', new AbortController())

    service.clearActiveGeneration('s1', stale.runId)

    expect(service.isActiveRun('s1', current.runId)).toBe(true)
    expect(cancelProviderPermissions).not.toHaveBeenCalled()
  })

  it('replaces an aborted lingering run with a fresh pre-stream controller', () => {
    const staleController = new AbortController()
    const stale = service.registerActiveGeneration('s1', 'm1', staleController)
    staleController.abort()

    const replacement = service.ensureSessionAbortController('s1')

    expect(replacement).not.toBe(staleController)
    expect(replacement.signal.aborted).toBe(false)
    expect(service.isActiveRun('s1', stale.runId)).toBe(false)
    expect(service.getGenerationActivity('s1')).toBe('preparing')
    expect(cancelProviderPermissions).toHaveBeenCalledWith('s1')
  })

  it('uses controller identity guards when clearing pre-stream state', () => {
    const staleController = service.ensureSessionAbortController('s1')
    const currentController = service.ensureSessionAbortController('s1')

    expect(staleController.signal.aborted).toBe(true)
    service.clearSessionAbortController('s1', staleController)
    expect(service.getAbortSignal('s1')).toBe(currentController.signal)

    service.clearSessionAbortController('s1', currentController)
    expect(service.getGenerationActivity('s1')).toBe('idle')
  })

  it('replaces deferred controllers and ignores stale cleanup', () => {
    const staleController = service.registerDeferredToolController('s1', 'tc1')
    const currentController = service.registerDeferredToolController('s1', 'tc1')

    expect(staleController.signal.aborted).toBe(true)
    service.clearDeferredToolController('s1', 'tc1', staleController)
    expect(runtimeSharedState.deferredToolAbortControllers.get('s1:tc1')).toBe(currentController)

    service.clearDeferredToolController('s1', 'tc1', currentController)
    expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(0)
  })

  it('prevents stale abort settlement from idling a replacement turn', () => {
    const stale = service.registerActiveGeneration('s1', 'm1', new AbortController())
    const current = service.registerActiveGeneration('s1', 'm2', new AbortController())

    expect(service.shouldSetIdleAfterAbort('s1', stale.runId)).toBe(false)
    expect(service.shouldSetIdleAfterAbort('s1', current.runId)).toBe(true)

    service.clearActiveGeneration('s1', current.runId)
    service.ensureSessionAbortController('s1')
    expect(service.shouldSetIdleAfterAbort('s1', stale.runId)).toBe(false)
  })

  it('does not let an unowned abort settlement idle active or preparing replacement work', () => {
    const active = service.registerActiveGeneration('s1', 'm1', new AbortController())

    expect(service.shouldSetIdleAfterAbort('s1')).toBe(false)

    service.clearActiveGeneration('s1', active.runId)
    const preparing = service.ensureSessionAbortController('s1')
    expect(service.shouldSetIdleAfterAbort('s1')).toBe(false)

    service.clearSessionAbortController('s1', preparing)
    expect(service.shouldSetIdleAfterAbort('s1')).toBe(true)
  })

  it('applies terminal status only for the owning run or preparation controller', () => {
    const staleRun = service.registerActiveGeneration('s1', 'm1', new AbortController())
    const currentRun = service.registerActiveGeneration('s1', 'm2', new AbortController())

    expect(service.shouldApplyTerminalStatus('s1', staleRun.runId)).toBe(false)
    expect(service.shouldApplyTerminalStatus('s1', currentRun.runId)).toBe(true)

    service.clearActiveGeneration('s1', currentRun.runId)
    const stalePreparation = service.ensureSessionAbortController('s1')
    const currentPreparation = service.ensureSessionAbortController('s1')

    expect(service.shouldApplyTerminalStatus('s1', undefined, stalePreparation)).toBe(false)
    expect(service.shouldApplyTerminalStatus('s1', undefined, currentPreparation)).toBe(true)
  })

  it('destroys all generation state and coordinates permission cancellation', () => {
    const activeController = new AbortController()
    service.registerActiveGeneration('s1', 'm1', activeController)
    const deferredController = service.registerDeferredToolController('s1', 'tc1')

    service.destroySession('s1')

    expect(activeController.signal.aborted).toBe(true)
    expect(deferredController.signal.aborted).toBe(true)
    expect(service.getGenerationActivity('s1')).toBe('idle')
    expect(runtimeSharedState.deferredToolAbortControllers.size).toBe(0)
    expect(cancelProviderPermissions).toHaveBeenCalledWith('s1')
  })
})
