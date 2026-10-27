import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnCodeModeHost } from '@/app/codeModeHost'
import { RUN_CODE_PROTOCOL_VERSION, type RunCodeParentMessage } from '@shared/codeModeProtocol'

const mocks = vi.hoisted(() => ({ fork: vi.fn(), metrics: vi.fn() }))
vi.mock('electron', () => ({
  utilityProcess: { fork: mocks.fork },
  app: { getAppMetrics: mocks.metrics }
}))

describe('Code Mode native capability', () => {
  const entry = path.resolve('out/main/codeModeUtilityHost.js')
  beforeEach(() => {
    mocks.fork.mockReset()
    mocks.metrics.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())
  const nativeHost = () => {
    const host = Object.assign(new EventEmitter(), {
      pid: 123 as number | undefined,
      postMessage: vi.fn(),
      kill: vi.fn()
    })
    mocks.fork.mockReturnValue(host)
    return host
  }

  it('preserves restricted environment, heap and library policy behind a plain channel', async () => {
    vi.stubEnv('DEEPCHAT_CODE_MODE_SECRET', 'fixture-secret')
    const native = nativeHost()
    const host = await spawnCodeModeHost(entry, new AbortController().signal)
    expect(host).not.toBe(native)
    const [actualEntry, args, options] = mocks.fork.mock.calls[0]
    expect(actualEntry).toBe(entry)
    expect(args).toEqual(['--deepchat-code-mode-host'])
    expect(options.serviceName).toBe('DeepChat Code Mode Cell')
    expect(options.execArgv).toEqual(['--max-old-space-size=64'])
    expect(options.allowLoadingUnsignedLibraries).toBe(false)
    expect(options.stdio).toBe('ignore')
    const allowed = [
      'DEEPCHAT_CODE_MODE_HOST',
      'LANG',
      'LC_ALL',
      'TMPDIR',
      'TEMP',
      'TMP',
      'SystemRoot'
    ]
    expect(Object.keys(options.env).every((name) => allowed.includes(name))).toBe(true)
    expect(options.env.DEEPCHAT_CODE_MODE_HOST).toBe('1')
    expect(host.pid).toBe(123)
    const message = vi.fn(),
      exit = vi.fn(),
      error = vi.fn()
    expect(host.on('message', message)).toBeUndefined()
    host.on('exit', exit)
    host.on('error', error)
    const stop: RunCodeParentMessage = {
      type: 'STOP',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: 'cell',
      reason: 'done'
    }
    host.postMessage(stop)
    expect(native.postMessage).toHaveBeenCalledWith(stop)
    native.emit('message', { type: 'READY' })
    native.emit('exit', 0)
    native.emit('error', 'crash', 'cell')
    expect(message).toHaveBeenCalledWith({ type: 'READY' })
    expect(exit).toHaveBeenCalledWith(0)
    expect(error).toHaveBeenCalledWith('crash', 'cell')
    expect(host.off('message', message)).toBeUndefined()
    expect(native.listenerCount('message')).toBe(0)
    expect(host.kill()).toBeUndefined()
    expect(native.kill).toHaveBeenCalledOnce()
  })

  it('rejects canceled and relative launch requests before creating a process', async () => {
    await expect(spawnCodeModeHost(entry, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError'
    })
    await expect(spawnCodeModeHost('relative.js', new AbortController().signal)).rejects.toThrow(
      'must be absolute'
    )
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('compensates cancellation during native fork', async () => {
    const native = nativeHost(),
      owner = new AbortController()
    mocks.fork.mockImplementation(() => {
      owner.abort()
      return native
    })
    await expect(spawnCodeModeHost(entry, owner.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(native.kill).toHaveBeenCalledOnce()
  })

  it('returns only the owned helper RSS in bytes and respects canceled reads', async () => {
    const native = nativeHost()
    const host = await spawnCodeModeHost(entry, new AbortController().signal)
    mocks.metrics.mockReturnValue([
      { pid: 999, memory: { workingSetSize: 999999 } },
      { pid: 123, memory: { workingSetSize: 1024 } }
    ])
    await expect(host.getRssBytes(new AbortController().signal)).resolves.toBe(1024 * 1024)
    mocks.metrics.mockClear()
    await expect(host.getRssBytes(AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(mocks.metrics).not.toHaveBeenCalled()
    native.pid = undefined
    await expect(host.getRssBytes(new AbortController().signal)).resolves.toBeNull()
    expect(mocks.metrics).not.toHaveBeenCalled()
  })

  it('rejects a read canceled during native sampling without returning a stale metric', async () => {
    nativeHost()
    const host = await spawnCodeModeHost(entry, new AbortController().signal)
    const owner = new AbortController()
    mocks.metrics.mockImplementation(() => {
      owner.abort()
      return [{ pid: 123, memory: { workingSetSize: 1024 } }]
    })
    await expect(host.getRssBytes(owner.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
