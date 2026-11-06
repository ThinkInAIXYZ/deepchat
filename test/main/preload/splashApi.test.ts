import { describe, expect, it, vi } from 'vitest'
import { createSplashApi } from '../../../src/preload/splashApi'
import {
  DATABASE_RECOVERY_REQUEST_CHANNEL,
  DATABASE_UNLOCK_PROGRESS_CHANNEL,
  DATABASE_UNLOCK_REQUEST_CHANNEL
} from '@shared/contracts/databaseSecurity'
import { SPLASH_DEBUG_MODE_CHANNEL } from '@shared/contracts/splash'

function createPort() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  return {
    port: {
      on(channel: string, listener: (payload: unknown) => void) {
        const channelListeners = listeners.get(channel) ?? new Set()
        listeners.set(channel, channelListeners)
        channelListeners.add(listener)
        return () => {
          channelListeners.delete(listener)
        }
      },
      send: vi.fn(),
      getLanguageState: vi.fn().mockResolvedValue({
        requestedLanguage: 'en-US',
        locale: 'en-US',
        direction: 'ltr'
      })
    },
    emit(channel: string, payload: unknown) {
      for (const listener of listeners.get(channel) ?? []) {
        listener(payload)
      }
    }
  }
}

describe('createSplashApi', () => {
  it('replays current progress and request in their original order', async () => {
    const { port, emit } = createPort()
    const api = createSplashApi(port)
    const request = {
      requestId: 'first-request',
      reason: 'manual-required' as const,
      safeStorageAvailable: true
    }
    const progress = { active: true, safeStorageAvailable: true }
    emit(DATABASE_UNLOCK_PROGRESS_CHANNEL, progress)
    emit(DATABASE_UNLOCK_REQUEST_CHANNEL, request)
    const states: string[] = []
    const requestListener = vi.fn(() => states.push('manual-request'))
    const progressListener = vi.fn(() => states.push('system-progress'))
    expect(api.onUnlockRequest(requestListener)).toBeTypeOf('function')
    api.onUnlockProgress(progressListener)
    await vi.waitFor(() => {
      expect(states).toEqual(['system-progress', 'manual-request'])
    })
    expect(requestListener).toHaveBeenCalledExactlyOnceWith(request)
    expect(progressListener).toHaveBeenCalledExactlyOnceWith(progress)

    requestListener.mockClear()
    const nextRequest = { ...request, requestId: 'invalid-request', reason: 'invalid' as const }
    emit(DATABASE_UNLOCK_REQUEST_CHANNEL, nextRequest)
    expect(requestListener).toHaveBeenCalledExactlyOnceWith(nextRequest)
  })

  it('replays recovery and debug state without replaying after unsubscribe', async () => {
    const { port, emit } = createPort()
    const api = createSplashApi(port)
    const recovery = {
      requestId: 'recovery-request',
      kind: 'true-corruption' as const,
      preservedPath: '/private/test-fixture'
    }
    emit(DATABASE_RECOVERY_REQUEST_CHANNEL, recovery)
    emit(SPLASH_DEBUG_MODE_CHANNEL, 'recovery')
    const recoveryListener = vi.fn()
    const debugListener = vi.fn()
    const unsubscribeRecovery = api.onRecoveryRequest(recoveryListener)
    const unsubscribeDebug = api.onDebugMode(debugListener)
    await vi.waitFor(() => {
      expect(recoveryListener).toHaveBeenCalledExactlyOnceWith(recovery)
      expect(debugListener).toHaveBeenCalledExactlyOnceWith('recovery')
    })

    unsubscribeRecovery()
    unsubscribeDebug()
    emit(DATABASE_RECOVERY_REQUEST_CHANNEL, recovery)
    emit(SPLASH_DEBUG_MODE_CHANNEL, 'loading')
    expect(recoveryListener).toHaveBeenCalledOnce()
    expect(debugListener).toHaveBeenCalledOnce()
  })

  it('does not invent a loading state when no event has arrived', async () => {
    const { port } = createPort()
    const api = createSplashApi(port)
    const listener = vi.fn()
    api.onUnlockRequest(listener)
    api.onRecoveryRequest(listener)
    api.onDebugMode(listener)
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
  })
})
