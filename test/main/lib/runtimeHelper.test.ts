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
})
