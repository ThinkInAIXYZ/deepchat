import * as fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeHelper } from '../../../src/main/lib/runtimeHelper'

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    getPath: vi.fn().mockReturnValue('/mock/home')
  }
}))

describe('RuntimeHelper', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  beforeEach(() => {
    ;(RuntimeHelper as never).instance = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    ;(RuntimeHelper as never).instance = null
  })

  it('replaces rtk.exe with the bundled runtime path on Windows', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    const helper = RuntimeHelper.getInstance()
    ;(helper as never).rtkRuntimePath = '/mock/runtime/rtk'

    vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      return String(targetPath) === '/mock/runtime/rtk/rtk.exe'
    })

    expect(helper.replaceWithRuntimeCommand('rtk.exe', true, true)).toBe(
      '/mock/runtime/rtk/rtk.exe'
    )
  })

  it('leaves runtime paths empty and PATH unchanged when bundled runtimes are missing', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    const helper = RuntimeHelper.getInstance()
    helper.initializeRuntimes(true)

    expect(helper.getNodeRuntimePath()).toBeNull()
    expect(helper.getUvRuntimePath()).toBeNull()
    expect(helper.getRtkRuntimePath()).toBeNull()
    expect(helper.getBundledRuntimeBinPaths()).toEqual([])
    expect(helper.prependBundledRuntimeToEnv({ PATH: 'C:\\Windows\\System32' })).toEqual({
      PATH: 'C:\\Windows\\System32'
    })
  })

  it('does not own bundled Node or uv even when those files exist', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)

    const helper = RuntimeHelper.getInstance()
    helper.setNodeRuntimePath('/mock/runtime/node')
    helper.setUvRuntimePath('/mock/runtime/uv')
    helper.initializeRuntimes(true)

    expect(helper.getNodeRuntimePath()).toBeNull()
    expect(helper.getUvRuntimePath()).toBeNull()
    expect(helper.replaceWithRuntimeCommand('npx', true, true)).toBe('npx')
    expect(helper.replaceWithRuntimeCommand('uvx', true, true)).toBe('uvx')
    const bins = helper.getBundledRuntimeBinPaths()
    expect(bins).toEqual([expect.stringMatching(/rtk$/)])
    expect(helper.prependBundledRuntimeToEnv({ PATH: '/usr/bin' }).PATH).toBe(`${bins[0]}:/usr/bin`)
  })
})
