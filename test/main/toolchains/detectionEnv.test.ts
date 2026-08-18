import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { defaultDetectionPaths, mergeDetectionEnv } from '../../../src/main/toolchains/detectionEnv'

describe('detectionEnv', () => {
  it('adds Homebrew and version-manager bins on macOS', () => {
    const paths = defaultDetectionPaths('/Users/demo', 'darwin')
    expect(paths).toContain('/opt/homebrew/bin')
    expect(paths).toContain('/Users/demo/.volta/bin')
    expect(paths).toContain('/Users/demo/.fnm/current/bin')
    expect(paths).toContain('/Users/demo/.asdf/shims')
  })

  it('adds Windows Node and npm locations', () => {
    const paths = defaultDetectionPaths('C:\\Users\\demo', 'win32')
    expect(paths).toContain('C:\\Program Files\\nodejs')
    expect(paths).toContain('C:\\Users\\demo\\AppData\\Roaming\\npm')
    expect(paths).toContain('C:\\Users\\demo\\AppData\\Roaming\\nvm')
  })

  it('prepends the login PATH and then appends default bins', () => {
    const env = mergeDetectionEnv(
      { PATH: '/custom/bin:/usr/bin' },
      '/Users/demo',
      'darwin'
    )
    expect(env.PATH?.startsWith('/custom/bin:/usr/bin')).toBe(true)
    expect(env.PATH).toContain('/opt/homebrew/bin')
    expect(env.PATH).toContain('/Users/demo/.volta/bin')
  })
})
