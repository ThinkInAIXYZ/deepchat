import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const path = await vi.importActual<typeof import('node:path')>('node:path')
const require = createRequire(import.meta.url)
const updaterRoot = path.dirname(require.resolve('electron-updater/package.json'))
const providerModule = await import(
  pathToFileURL(path.join(updaterRoot, 'out/providers/Provider.js')).href
)
const macUpdaterModule = await import(
  pathToFileURL(path.join(updaterRoot, 'out/MacUpdater.js')).href
)

const { findFile, Provider } = providerModule
const { MacUpdater } = macUpdaterModule

const resolvedFiles = (names: string[]) =>
  names.map((name) => ({
    url: new URL(`https://github.com/ThinkInAIXYZ/deepchat/releases/download/v1.2.3/${name}`),
    info: {
      url: name,
      sha512: Buffer.alloc(64).toString('base64')
    }
  }))

const withProcessArch = <T>(arch: 'x64' | 'arm64', callback: () => T): T => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'arch')
  if (!descriptor?.configurable) throw new Error('process.arch is not configurable in this runtime')
  Object.defineProperty(process, 'arch', { ...descriptor, value: arch })
  try {
    return callback()
  } finally {
    Object.defineProperty(process, 'arch', descriptor)
  }
}

class ExposedProvider extends Provider {
  constructor(platform: 'win32' | 'linux' | 'darwin') {
    super({
      platform,
      isUseMultipleRangeRequest: false,
      executor: {}
    })
  }

  getLatestVersion() {
    throw new Error('Not used by the compatibility contract')
  }

  resolveFiles() {
    return []
  }

  defaultChannelName() {
    return this.getDefaultChannelName()
  }
}

describe.sequential('installed electron-updater architecture compatibility', () => {
  it('selects the architecture-specific Windows NSIS executable', () => {
    const files = resolvedFiles([
      'DeepChat-1.2.3-windows-x64.exe',
      'DeepChat-1.2.3-windows-arm64.exe'
    ])

    expect(withProcessArch('x64', () => findFile(files, 'exe')?.info.url)).toBe(
      'DeepChat-1.2.3-windows-x64.exe'
    )
    expect(withProcessArch('arm64', () => findFile(files, 'exe')?.info.url)).toBe(
      'DeepChat-1.2.3-windows-arm64.exe'
    )
  })

  it('filters macOS by architecture and keeps ZIP as the updater payload', () => {
    const files = resolvedFiles([
      'DeepChat-1.2.3-mac-x64.dmg',
      'DeepChat-1.2.3-mac-x64.zip',
      'DeepChat-1.2.3-mac-arm64.dmg',
      'DeepChat-1.2.3-mac-arm64.zip'
    ])
    const filterFilesForArch = MacUpdater.filterFilesForArch.bind(MacUpdater)

    expect(findFile(filterFilesForArch(files, false), 'zip', ['pkg', 'dmg'])?.info.url).toBe(
      'DeepChat-1.2.3-mac-x64.zip'
    )
    expect(findFile(filterFilesForArch(files, true), 'zip', ['pkg', 'dmg'])?.info.url).toBe(
      'DeepChat-1.2.3-mac-arm64.zip'
    )
  })

  it('uses separate Linux channel metadata for x64 and ARM64', () => {
    const originalArch = process.env.TEST_UPDATER_ARCH
    try {
      process.env.TEST_UPDATER_ARCH = 'x64'
      expect(new ExposedProvider('linux').defaultChannelName()).toBe('latest-linux')
      process.env.TEST_UPDATER_ARCH = 'arm64'
      expect(new ExposedProvider('linux').defaultChannelName()).toBe('latest-linux-arm64')
    } finally {
      if (originalArch === undefined) delete process.env.TEST_UPDATER_ARCH
      else process.env.TEST_UPDATER_ARCH = originalArch
    }
  })
})
