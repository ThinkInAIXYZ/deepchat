import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { CoreNativeBrowser } from '../../../src/harness/core/browser'
import { CorePayloadStore } from '../../../src/harness/core/payload'
import { CoreBrowserNative } from '@/harness/browser'
import { CoreRuntimeConnection } from '@/harness/core'
import type { HarnessRuntime } from '@/harness/runtime'
import type { CoreStatus } from '@shared/harness/core'
import type { CoreBrowserCommand } from '@shared/harness/browser'
import type { AgentBrowserToolPort } from '@/tool/runtimePorts'
import { YoBrowserUnavailableError, buildYoBrowserUnavailablePayload } from '@/tool/browser/errors'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

it('commits normalized Browser dispatch in Core and preserves recoverable business errors', async () => {
  const order: string[] = []
  const failures = vi.fn()
  const nativeBrowser: AgentBrowserToolPort = {
    getToolDefinitions: () => [],
    callTool: async (tool, _args, session, _run, authorize, signal) => {
      signal?.throwIfAborted()
      if (tool === 'get_browser_status')
        throw new YoBrowserUnavailableError(buildYoBrowserUnavailablePayload(session!, '', null))
      await authorize?.({ method: 'Page.reload', params: { ignoreCache: true } })
      signal?.throwIfAborted()
      order.push('dispatch')
      return 'completed'
    }
  }
  const retired = vi.fn(async () => {})
  const native = new CoreBrowserNative(
    nativeBrowser,
    async (event) => await core.accept(event),
    retired,
    failures
  )
  const core = new CoreNativeBrowser(async (command) => await native.invoke([command]), failures)
  const permission = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const approved = core.callTool('cdp_send', { params: '{}' }, 'session', 'run', async (args) => {
    expect(args).toEqual({ method: 'Page.reload', params: { ignoreCache: true } })
    order.push('authorize')
    entered.resolve()
    await permission.promise
  })
  await entered.promise
  expect(order).toEqual(['authorize'])
  permission.resolve()
  expect(await approved).toBe('completed')
  expect(order).toEqual(['authorize', 'dispatch'])
  const denied = new Error('journal unavailable')
  await expect(
    core.callTool('load_url', {}, 'session', 'run', () => {
      throw denied
    })
  ).rejects.toBe(denied)
  expect(order).toEqual(['authorize', 'dispatch'])
  await expect(core.callTool('get_browser_status', {}, 'session')).rejects.toMatchObject({
    name: 'YoBrowserUnavailableError',
    payload: buildYoBrowserUnavailablePayload('session', '', null)
  })
  expect(await core.callTool('cdp_send', {}, 'session')).toBe('completed')
  expect(failures).not.toHaveBeenCalled()
  await core.close()
  expect(retired).toHaveBeenCalledOnce()
})

it('cancels late admission without dispatch and waits for actual Native retirement', async () => {
  const admission = Promise.withResolvers<void>()
  const admitted = Promise.withResolvers<void>()
  const physicalClosure = Promise.withResolvers<void>()
  const retired = vi.fn(async () => await physicalClosure.promise)
  const dispatch = vi.fn()
  const failures = vi.fn()
  const native = new CoreBrowserNative(
    {
      getToolDefinitions: () => [],
      callTool: async (_tool, _args, _session, _run, authorize, signal) => {
        await authorize?.({ url: 'https://example.com' })
        signal?.throwIfAborted()
        dispatch()
        return 'completed'
      }
    },
    async (event) => {
      if (event.type === 'browser.authorize') await admission.promise
      return await core.accept(event)
    },
    retired,
    failures
  )
  const invoke = async (command: CoreBrowserCommand) => {
    const result = await native.invoke([command])
    if (command.operation === 'open') {
      admitted.resolve()
      await admission.promise
    }
    return result
  }
  const core = new CoreNativeBrowser(invoke, failures)
  const controller = new AbortController()
  const authorize = vi.fn()
  const result = core.callTool('load_url', {}, 'session', 'run', authorize, controller.signal)
  const canceled = expect(result).rejects.toThrow('run canceled')
  await admitted.promise
  controller.abort(new Error('run canceled'))
  admission.resolve()
  await canceled
  expect(authorize).not.toHaveBeenCalled()
  expect(dispatch).not.toHaveBeenCalled()
  let closed = false
  const closing = core.close().then(() => {
    closed = true
  })
  await vi.waitFor(() => expect(retired).toHaveBeenCalledOnce())
  expect(closed).toBe(false)
  physicalClosure.resolve()
  await closing
  expect(failures).not.toHaveBeenCalled()
})

it('serializes encrypted helper and Browser events without fencing a denied authorization', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rutis-native-events-'))
  const permission = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const received: unknown[] = []
  let peer!: CorePayloadStore
  const runtime: Pick<HarnessRuntime, 'connectCore' | 'stop'> = {
    stop: async () => {},
    connectCore(config, listener) {
      peer = new CorePayloadStore(config, 'core')
      const status: CoreStatus = {
        generation: config.generation,
        pid: process.pid,
        node: process.versions.node,
        modules: process.versions.modules,
        phase: 'idle',
        businessReady: false
      }
      listener.message({ type: 'coreReady', runtime: status })
      return (request) => {
        if (request.type !== 'coreCall') throw new Error('Unexpected Core request')
        void (async () => {
          const event = await peer.decode(request.args)
          let result: unknown = status
          if (request.method === 'nativeEvents') {
            received.push(event)
            if (received.length === 1) {
              entered.resolve()
              await permission.promise
              result = { ok: false, error: { name: 'Error', message: 'dispatch denied' } }
            } else result = undefined
          }
          listener.message({
            type: 'coreReply',
            id: request.id,
            value: await peer.encode(result)
          })
        })().catch(listener.failed)
      }
    }
  }
  const connection = await CoreRuntimeConnection.connect({
    runtime,
    temporaryDirectory: directory,
    native: async () => {
      throw new Error('Unexpected Native effect')
    }
  })
  try {
    const authorization = connection.deliverBrowserEvent({
      type: 'browser.authorize',
      id: randomUUID(),
      args: { source: Buffer.alloc(32 * 1024, 3) }
    })
    await entered.promise
    const bytes = Buffer.alloc(32 * 1024, 7)
    const helper = connection.deliverNativeEvents([
      {
        id: randomUUID(),
        sequence: 1,
        pid: null,
        event: { type: 'message', message: bytes }
      }
    ])
    bytes.fill(0)
    expect(received).toHaveLength(1)
    permission.resolve()
    await expect(authorization).resolves.toMatchObject({ ok: false })
    await helper
    expect(received[1]).toMatchObject([{ event: { message: Buffer.alloc(32 * 1024, 7) } }])
    await expect(connection.status()).resolves.toMatchObject({ phase: 'idle' })
  } finally {
    permission.resolve()
    await connection.closeAfterHostExit()
    await peer.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
