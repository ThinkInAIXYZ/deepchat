import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NATIVE_PROTOCOL_BEGIN_ROUTE,
  NATIVE_PROTOCOL_CANCEL_ROUTE,
  NATIVE_PROTOCOL_READ_ROUTE
} from '@/platform/node/nativeProtocol'

const streamId = 'a'.repeat(32)

function requestInput(id = streamId, method = 'GET') {
  return {
    streamId: id,
    url: 'workspace-preview://fixture/preview.html',
    method,
    headers: { 'X-Test': 'request-header' }
  }
}

function readerWith(results: Array<{ done: boolean; value?: Uint8Array }>) {
  const read = vi.fn()
  for (const result of results) read.mockResolvedValueOnce(result)
  return {
    read,
    cancel: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn()
  }
}

function responseWithReader(reader: ReturnType<typeof readerWith>, init?: ResponseInit) {
  const response = new Response(null, init)
  Object.defineProperty(response, 'body', { value: { getReader: () => reader } })
  return response
}

describe('native protocol streaming', () => {
  let shim: typeof import('@/platform/node/electron')
  let host: typeof import('@/platform/node/appHost')
  let protocol: typeof import('@/platform/node/nativeProtocol')
  let source: { windowId: number; documentUrl: string }

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('DEEPCHAT_NATIVE_WINDOW_ID', '1')
    shim = await import('@/platform/node/electron')
    host = await import('@/platform/node/appHost')
    protocol = await import('@/platform/node/nativeProtocol')
    const primary = new shim.BrowserWindow({})
    host.nodeAppHost.registerNativePrimaryWindow!(primary)
    source = { windowId: primary.id, documentUrl: 'mygo://localhost/' }
  })

  function invoke(route: string, input: unknown, caller = source) {
    shim.nativeIpcEvent(caller)
    return protocol.handleNativeProtocolRoute(route, input, caller)
  }

  it('registers only supported handlers and does not create a reader for an empty response', async () => {
    const handler = vi.fn(async (request: { headers: Record<string, string> }) => {
      expect(request.headers['X-Test']).toBe('request-header')
      return new Response(null, { status: 204 })
    })
    expect(shim.protocol.handle('workspace-preview', handler)).toBe(true)
    expect(shim.protocol.handle('https', handler)).toBe(false)
    await expect(shim.protocol.isProtocolHandled('workspace-preview')).resolves.toBe(true)
    await expect(shim.protocol.isProtocolHandled('https')).resolves.toBe(false)

    const metadata = (await invoke(NATIVE_PROTOCOL_BEGIN_ROUTE, requestInput())) as {
      status: number
      body: boolean
      headers: Array<[string, string]>
    }
    expect(metadata).toMatchObject({ status: 204, body: false })
    expect(handler).toHaveBeenCalledOnce()
    await expect(invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })).rejects.toThrow(
      'stream is not available'
    )

    shim.protocol.unhandle('workspace-preview')
    await expect(shim.protocol.isProtocolHandled('workspace-preview')).resolves.toBe(false)
  })

  it('preserves headers and streams large source chunks without another read', async () => {
    const reader = readerWith([
      { done: false, value: Uint8Array.from([1, 2, 3]) },
      { done: false, value: new Uint8Array(300_000).fill(4) },
      { done: true }
    ])
    shim.protocol.handle('workspace-preview', () =>
      responseWithReader(reader, {
        status: 201,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'",
          'Permissions-Policy': 'camera=()',
          Connection: 'X-Internal',
          'X-Internal': 'not-forwarded',
          'Transfer-Encoding': 'chunked'
        }
      })
    )
    const metadata = (await invoke(NATIVE_PROTOCOL_BEGIN_ROUTE, requestInput())) as {
      status: number
      body: boolean
      headers: Array<[string, string]>
    }
    expect(metadata).toMatchObject({ status: 201, body: true })
    expect(metadata.headers).toEqual(
      expect.arrayContaining([
        ['content-type', 'text/html; charset=utf-8'],
        ['content-security-policy', "default-src 'none'"],
        ['permissions-policy', 'camera=()']
      ])
    )
    expect(metadata.headers.some(([name]) => name === 'transfer-encoding')).toBe(false)
    expect(metadata.headers.some(([name]) => name === 'x-internal')).toBe(false)
    expect(reader.read).not.toHaveBeenCalled()

    const first = (await invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })) as {
      done: boolean
      data: string
    }
    expect(Buffer.from(first.data, 'base64')).toEqual(Buffer.from([1, 2, 3]))
    expect(reader.read).toHaveBeenCalledTimes(1)

    const secondary = new shim.BrowserWindow({})
    host.nodeAppHost.registerNativeWindow!(secondary, {
      windowId: 7,
      role: 'settings',
      documentUrl: 'mygo://localhost/settings/index.html',
      visible: true,
      focused: false
    })
    await expect(
      invoke(
        NATIVE_PROTOCOL_READ_ROUTE,
        { streamId },
        {
          windowId: secondary.id,
          documentUrl: 'mygo://localhost/settings/index.html'
        }
      )
    ).rejects.toThrow('stream owner does not match')
    expect(reader.read).toHaveBeenCalledTimes(1)

    const second = (await invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })) as { data: string }
    const third = (await invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })) as { data: string }
    expect(Buffer.from(second.data, 'base64')).toHaveLength(256 * 1024)
    expect(Buffer.from(third.data, 'base64')).toHaveLength(300_000 - 256 * 1024)
    expect(reader.read).toHaveBeenCalledTimes(2)
    const done = (await invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })) as {
      done: boolean
      data: string
    }
    expect(done).toEqual({ done: true, data: '' })
    expect(reader.read).toHaveBeenCalledTimes(3)
    expect(reader.releaseLock).toHaveBeenCalledOnce()
    await expect(invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })).rejects.toThrow(
      'stream is not available'
    )
  })

  it('rejects a navigated reader and allows its original owner to cancel', async () => {
    const reader = readerWith([])
    shim.protocol.handle('workspace-preview', () => responseWithReader(reader))
    await invoke(NATIVE_PROTOCOL_BEGIN_ROUTE, requestInput())
    await expect(
      invoke(
        NATIVE_PROTOCOL_READ_ROUTE,
        { streamId },
        {
          ...source,
          documentUrl: 'mygo://localhost/#/new'
        }
      )
    ).rejects.toThrow('document is no longer current')
    expect(reader.cancel).toHaveBeenCalledOnce()
    await expect(
      protocol.handleNativeProtocolRoute(NATIVE_PROTOCOL_CANCEL_ROUTE, { streamId }, source)
    ).resolves.toEqual({ done: true })
    await expect(invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })).rejects.toThrow(
      'stream is not available'
    )
  })

  it('cancels HEAD bodies without acquiring a reader', async () => {
    const body = new Response('unused').body!
    const cancel = vi.spyOn(body, 'cancel')
    shim.protocol.handle('workspace-preview', () => new Response(body, { status: 200 }))
    const metadata = (await invoke(
      NATIVE_PROTOCOL_BEGIN_ROUTE,
      requestInput(streamId, 'HEAD')
    )) as {
      status: number
      body: boolean
    }
    expect(metadata).toMatchObject({ status: 200, body: false })
    expect(cancel).toHaveBeenCalledOnce()
    await expect(invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })).rejects.toThrow(
      'stream is not available'
    )
    await expect(
      invoke(NATIVE_PROTOCOL_BEGIN_ROUTE, requestInput(streamId, 'POST'))
    ).rejects.toThrow('only supports GET and HEAD')
  })

  it('propagates HEAD body cancellation failures', async () => {
    const body = new Response('unused').body!
    vi.spyOn(body, 'cancel').mockRejectedValue(new Error('HEAD cancel failed'))
    shim.protocol.handle('workspace-preview', () => new Response(body, { status: 200 }))

    await expect(
      invoke(NATIVE_PROTOCOL_BEGIN_ROUTE, requestInput(streamId, 'HEAD'))
    ).rejects.toThrow('HEAD cancel failed')
  })

  it('cancels a pending begin and prevents a late response from creating a reader', async () => {
    let resolveResponse!: (response: Response) => void
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const handler = vi.fn(() => responsePromise)
    shim.protocol.handle('workspace-preview', handler)
    const begin = invoke(NATIVE_PROTOCOL_BEGIN_ROUTE, requestInput())
    expect(handler).toHaveBeenCalledOnce()

    await expect(invoke(NATIVE_PROTOCOL_CANCEL_ROUTE, { streamId })).resolves.toEqual({
      done: true
    })
    const response = new Response('late response')
    const cancel = vi.spyOn(response.body!, 'cancel')
    resolveResponse(response)

    await expect(begin).rejects.toThrow('native protocol stream was cancelled')
    expect(cancel).toHaveBeenCalledOnce()
    await expect(invoke(NATIVE_PROTOCOL_READ_ROUTE, { streamId })).rejects.toThrow(
      'stream is not available'
    )
  })

  it('remembers cancellation that arrives before begin', async () => {
    const id = 'b'.repeat(32)
    const handler = vi.fn(() => new Response('must not run'))
    shim.protocol.handle('workspace-preview', handler)
    await invoke(NATIVE_PROTOCOL_CANCEL_ROUTE, { streamId: id })

    await expect(invoke(NATIVE_PROTOCOL_BEGIN_ROUTE, requestInput(id))).rejects.toThrow(
      'native protocol stream was cancelled'
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('cancels a response body when metadata validation fails', async () => {
    const response = new Response('invalid metadata', {
      headers: { 'Content-Length': 'invalid' }
    })
    const cancel = vi.spyOn(response.body!, 'cancel')
    shim.protocol.handle('workspace-preview', () => response)

    await expect(invoke(NATIVE_PROTOCOL_BEGIN_ROUTE, requestInput())).rejects.toThrow(
      'native protocol content length is invalid'
    )
    expect(cancel).toHaveBeenCalledOnce()
  })
})
