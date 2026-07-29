import { describe, expect, it, vi } from 'vitest'
import { RemoteChannelSaveCoordinator } from '../../../src/renderer/settings/lib/remoteChannelSaveCoordinator'

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('RemoteChannelSaveCoordinator', () => {
  it('preserves a newer draft while serializing saves', async () => {
    let draft = { token: 'first' }
    const first = deferred<{ token: string }>()
    const second = deferred<{ token: string }>()
    const persist = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const commit = vi.fn(() => true)
    const onSucceeded = vi.fn()
    const coordinator = new RemoteChannelSaveCoordinator({
      readDraft: () => ({ ...draft }),
      persist,
      commit,
      onStarted: vi.fn(),
      onSucceeded,
      onFailed: vi.fn()
    })

    const firstRequest = coordinator.request()
    await Promise.resolve()
    draft = { token: 'second' }
    const secondRequest = coordinator.request()

    first.resolve({ token: 'normalized-first' })
    await Promise.resolve()
    await Promise.resolve()

    expect(commit).toHaveBeenNthCalledWith(
      1,
      { token: 'normalized-first' },
      { draft: { token: 'first' }, isLatest: false }
    )
    expect(persist).toHaveBeenNthCalledWith(2, { token: 'second' })
    expect(onSucceeded).not.toHaveBeenCalled()

    second.resolve({ token: 'normalized-second' })

    await expect(firstRequest).resolves.toBe(true)
    await expect(secondRequest).resolves.toBe(true)
    expect(commit).toHaveBeenNthCalledWith(
      2,
      { token: 'normalized-second' },
      { draft: { token: 'second' }, isLatest: true }
    )
    expect(onSucceeded).toHaveBeenCalledWith({ isCurrentDraftPersisted: true })
  })

  it('retries the latest revision after an older request fails', async () => {
    let draft = { enabled: false }
    const first = deferred<{ enabled: boolean }>()
    const persist = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ enabled: true })
    const onFailed = vi.fn()
    const coordinator = new RemoteChannelSaveCoordinator({
      readDraft: () => ({ ...draft }),
      persist,
      commit: vi.fn(() => true),
      onStarted: vi.fn(),
      onSucceeded: vi.fn(),
      onFailed
    })

    const request = coordinator.request()
    await Promise.resolve()
    draft = { enabled: true }
    coordinator.request()
    first.reject(new Error('offline'))

    await expect(request).resolves.toBe(true)
    expect(persist).toHaveBeenNthCalledWith(2, { enabled: true })
    expect(onFailed).not.toHaveBeenCalled()
  })

  it('keeps a failed latest draft retryable', async () => {
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ enabled: true })
    const onStarted = vi.fn()
    const onSucceeded = vi.fn()
    const onFailed = vi.fn()
    const coordinator = new RemoteChannelSaveCoordinator({
      readDraft: () => ({ enabled: true }),
      persist,
      commit: vi.fn(() => true),
      onStarted,
      onSucceeded,
      onFailed
    })

    await expect(coordinator.request()).resolves.toBe(false)
    expect(onFailed).toHaveBeenCalledTimes(1)

    await expect(coordinator.request()).resolves.toBe(true)
    expect(onStarted).toHaveBeenCalledTimes(2)
    expect(onSucceeded).toHaveBeenCalledWith({ isCurrentDraftPersisted: true })
  })

  it('reports when a successful request no longer represents the current draft', async () => {
    const onSucceeded = vi.fn()
    const coordinator = new RemoteChannelSaveCoordinator({
      readDraft: () => ({ enabled: true }),
      persist: vi.fn(async (draft) => draft),
      commit: vi.fn(() => false),
      onStarted: vi.fn(),
      onSucceeded,
      onFailed: vi.fn()
    })

    await expect(coordinator.request()).resolves.toBe(true)
    expect(onSucceeded).toHaveBeenCalledWith({ isCurrentDraftPersisted: false })
  })
})
