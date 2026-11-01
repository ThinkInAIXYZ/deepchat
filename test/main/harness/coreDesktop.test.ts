import { expect, it, vi } from 'vitest'
import { CoreNativeDesktop } from '../../../src/harness/core/desktop'
import type { CoreKernelNative } from '../../../src/harness/core/kernel'
import { CoreDesktopNative } from '@/harness/desktop'
import { createDeepchatEventEnvelope, type DeepchatEventEnvelope } from '@shared/contracts/events'
import { CORE_NATIVE_QUEUED, CORE_PRESENTATION_QUEUED } from '@shared/harness/core'

vi.unmock('path')
vi.unmock('node:path')

it('delivers the latest projections without displacing business events', async () => {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const businessDelivered = Promise.withResolvers<void>()
  const delivered: DeepchatEventEnvelope[] = []
  const failed = vi.fn()
  const native = new CoreDesktopNative(
    {
      mcpReadinessChanged() {},
      renderer: {
        broadcast: async (event) => {
          delivered.push(event)
          if (delivered.length === 1) {
            entered.resolve()
            await released.promise
          }
          if (event.name === 'appRuntime.accessibilityChanged') businessDelivered.resolve()
        }
      }
    } as unknown as CoreKernelNative,
    async () => {},
    async () => {},
    failed
  )
  const core = new CoreNativeDesktop(
    (command) => native.invoke([command]),
    () => {},
    failed
  )
  const ports = await core.createPorts({ temporaryDirectory: '/tmp', profileDirectory: '/profile' })
  const snapshot = (run: string) =>
    createDeepchatEventEnvelope('startup.workload.changed', {
      startupRunId: run,
      target: 'settings',
      tasks: []
    })
  const delegation = (parent: string, id: string, revision: number) =>
    createDeepchatEventEnvelope('orchestration.liveDelegation.changed', {
      schemaVersion: 1,
      parentSessionId: parent,
      delegation: {
        schemaVersion: 1,
        id,
        parentSessionId: parent,
        childSessionId: null,
        slotId: 'explorer',
        targetAgentId: 'deepchat',
        title: 'Owned delegation',
        status: 'running',
        lastTurnSeq: 1,
        createdAt: 0,
        updatedAt: revision,
        revision,
        summaryPreview: null,
        errorPreview: null
      }
    })
  try {
    ports.renderer.broadcast(snapshot('first'))
    await entered.promise
    for (let i = 0; i < CORE_NATIVE_QUEUED * 2; i++) {
      ports.renderer.broadcast(snapshot(String(i)))
      ports.renderer.broadcast(delegation('parent:a', 'child', i))
      ports.renderer.broadcast(delegation('parent', 'a:child', i))
    }
    ports.renderer.broadcast(delegation('parent:a', 'child', 0))
    ports.renderer.broadcast(
      createDeepchatEventEnvelope('appRuntime.accessibilityChanged', { enabled: true })
    )
    released.resolve()
    await businessDelivered.promise
    await ports.mcpReadinessChanged(false)
    expect(delivered.filter((event) => event.name === 'startup.workload.changed')).toEqual([
      snapshot('first'),
      snapshot(String(CORE_NATIVE_QUEUED * 2 - 1))
    ])
    expect(
      delivered.filter((event) => event.name === 'appRuntime.accessibilityChanged')
    ).toHaveLength(1)
    expect(
      delivered.filter((event) => event.name === 'orchestration.liveDelegation.changed')
    ).toEqual([
      delegation('parent:a', 'child', CORE_NATIVE_QUEUED * 2 - 1),
      delegation('parent', 'a:child', CORE_NATIVE_QUEUED * 2 - 1)
    ])
    expect(failed).not.toHaveBeenCalled()
    for (let i = 0; i < CORE_PRESENTATION_QUEUED; i++)
      ports.renderer.broadcast(
        createDeepchatEventEnvelope('appRuntime.accessibilityChanged', { enabled: Boolean(i % 2) })
      )
    expect(() => ports.renderer.broadcast(snapshot('over-capacity'))).toThrow(
      'Core presentation queue exceeded'
    )
    expect(failed).toHaveBeenCalledOnce()
  } finally {
    released.resolve()
    await core.close()
  }
})

it('cancels reordered Native calls and releases completed cancellation identities', async () => {
  const failed = vi.fn()
  const read = vi.fn(async () => ({ width: 10, height: 20 }))
  const native = new CoreDesktopNative(
    { agentDesktop: { readImageSize: read } } as unknown as CoreKernelNative,
    async () => {},
    async () => {},
    failed
  )
  let held:
    | {
        position: 'admission' | 'reply'
        entered: ReturnType<typeof Promise.withResolvers<void>>
        release: ReturnType<typeof Promise.withResolvers<void>>
      }
    | undefined
  const core = new CoreNativeDesktop(
    async (command) => {
      if (command.operation !== 'call' || !held) return await native.invoke([command])
      const gate = held
      if (gate.position === 'admission') {
        gate.entered.resolve()
        await gate.release.promise
      }
      const result = await native.invoke([command])
      if (gate.position === 'reply') {
        gate.entered.resolve()
        await gate.release.promise
      }
      return result
    },
    () => {},
    failed
  )
  const ports = await core.createPorts({ temporaryDirectory: '/tmp', profileDirectory: '/profile' })
  try {
    for (let i = 0; i < 84; i++) {
      held = {
        position: i === 0 ? 'admission' : 'reply',
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>()
      }
      const signal = new AbortController()
      const canceled = new Error(`canceled ${i}`)
      const call = ports.agentDesktop.readImageSize('/image', signal.signal)
      const rejected = expect(call).rejects.toBe(canceled)
      await held.entered.promise
      signal.abort(canceled)
      await Promise.resolve()
      held.release.resolve()
      await rejected
    }
    held = undefined
    expect(read).toHaveBeenCalledTimes(83)
    expect(await ports.agentDesktop.readImageSize('/image')).toEqual({ width: 10, height: 20 })
    expect(failed).not.toHaveBeenCalled()
  } finally {
    held?.release.resolve()
    await core.close()
  }
})

it('owns renderer subscriptions until registration and waits for physical Native closure', async () => {
  const callbacks = new Map<number, () => void>()
  const disposed = vi.fn()
  const failed = vi.fn()
  const release = Promise.withResolvers<void>()
  const registration = Promise.withResolvers<void>()
  let pluginOwner: unknown = 'plugin-a'
  let remoteTarget: unknown = { windowId: 1, webContentsId: 7 }
  let presented: unknown = true
  let focused: unknown = true
  let previewResult: unknown = { updated: true, surface: 'renderer-canvas' }
  const native = new CoreDesktopNative(
    {
      pluginSettingsWindow: { getPluginIdForWebContents: async () => pluginOwner },
      remoteSessionWindow: {
        select: async () => remoteTarget,
        present: async () => presented
      },
      sessionPresentation: {
        focusBrowser: async () => focused,
        setComputerUsePreview: async () => previewResult,
        dismissComputerUsePreview: async () => true
      },
      onRendererDestroyed: (id, listener) => {
        callbacks.set(id, listener)
        return () => {
          callbacks.delete(id)
          disposed()
        }
      }
    } as unknown as CoreKernelNative,
    async (event) => core.accept(event),
    async () => await release.promise,
    failed
  )
  const core = new CoreNativeDesktop(
    async (command) => {
      if (command.operation === 'watch') await registration.promise
      return await native.invoke([command])
    },
    () => {},
    failed
  )
  const ports = await core.createPorts({ temporaryDirectory: '/tmp', profileDirectory: '/profile' })
  expect(await ports.pluginSettingsWindow.getPluginIdForWebContents(7)).toBe('plugin-a')
  pluginOwner = { id: 'invalid Native owner' }
  await expect(ports.pluginSettingsWindow.getPluginIdForWebContents(7)).rejects.toThrow()
  expect(await ports.remoteSessionWindow.select()).toEqual(remoteTarget)
  expect(await ports.remoteSessionWindow.present({ windowId: 1, webContentsId: 7 })).toBe(true)
  presented = { shown: true }
  await expect(
    ports.remoteSessionWindow.present({ windowId: 1, webContentsId: 7 })
  ).rejects.toThrow()
  remoteTarget = null
  expect(await ports.remoteSessionWindow.select()).toBeNull()
  remoteTarget = { windowId: 1, webContentsId: '7' }
  await expect(ports.remoteSessionWindow.select()).rejects.toThrow()
  const caller = { kind: 'renderer', webContentsId: 7, windowId: 1 } as const
  expect(await ports.sessionPresentation.focusBrowser('session', caller)).toBe(true)
  focused = { focused: true }
  await expect(ports.sessionPresentation.focusBrowser('session', caller)).rejects.toThrow()
  expect(
    await ports.sessionPresentation.setComputerUsePreview('session', 'eligible', caller)
  ).toEqual({ updated: true, surface: 'renderer-canvas' })
  previewResult = { updated: true, surface: 'unknown' }
  await expect(
    ports.sessionPresentation.setComputerUsePreview('session', 'eligible', caller)
  ).rejects.toThrow()
  const first = vi.fn()
  const second = vi.fn()
  const stopFirst = ports.onRendererDestroyed(7, first)
  const stopSecond = ports.onRendererDestroyed(7, second)
  stopFirst()
  registration.resolve()
  await vi.waitFor(() => expect(callbacks.has(7)).toBe(true))
  callbacks.get(7)!()
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledOnce()
  stopSecond()
  await vi.waitFor(() => expect(disposed).toHaveBeenCalledOnce())
  let closed = false
  const closing = core.close().then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  await expect(ports.getProxySnapshot()).rejects.toThrow('stopping')
  release.resolve()
  await closing
  expect(callbacks.size).toBe(0)
  expect(failed).not.toHaveBeenCalled()
})
