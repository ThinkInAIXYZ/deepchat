import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private data: Record<string, unknown>

    constructor(options?: { defaults?: Record<string, unknown> }) {
      this.data = JSON.parse(JSON.stringify(options?.defaults ?? {}))
    }

    get(key: string) {
      return this.data[key]
    }

    set(key: string, value: unknown) {
      this.data[key] = value
    }
  }
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    default: actual
  }
})

const tempRoots: string[] = []
const originalCwd = process.cwd()

type CreatePluginPresenterOptions = {
  appPath?: string
  isPackaged?: boolean
  resourcesPath?: string
  mcpEnabled?: boolean
  arch?: NodeJS.Architecture
}

const createPluginPresenter = async (
  platform: NodeJS.Platform,
  optionsOrAppPath: CreatePluginPresenterOptions | string = process.cwd()
) => {
  const options =
    typeof optionsOrAppPath === 'string' ? { appPath: optionsOrAppPath } : optionsOrAppPath
  const { PluginPresenter } = await import('@/presenter/pluginPresenter')
  const mcpServers: Record<string, unknown> = {}
  const configPresenter = {
    getMcpServers: vi.fn().mockImplementation(async () => mcpServers),
    addMcpServer: vi.fn().mockImplementation(async (serverName: string, config: unknown) => {
      mcpServers[serverName] = config
    }),
    updateMcpServer: vi.fn().mockImplementation(async (serverName: string, config: unknown) => {
      mcpServers[serverName] = config
    }),
    removeMcpServer: vi.fn().mockImplementation(async (serverName: string) => {
      delete mcpServers[serverName]
    }),
    getMcpEnabled: vi.fn().mockResolvedValue(options.mcpEnabled ?? true)
  }
  const mcpPresenter = {
    isReady: vi.fn(() => true),
    isServerRunning: vi.fn().mockResolvedValue(false),
    startServer: vi.fn().mockResolvedValue(undefined),
    stopServer: vi.fn().mockResolvedValue(undefined)
  }
  const skillPresenter = {
    unregisterPluginSkillsByOwner: vi.fn().mockResolvedValue(undefined)
  }
  const presenter = new PluginPresenter({
    platform,
    arch: options.arch,
    appPath: options.appPath ?? process.cwd(),
    isPackaged: options.isPackaged,
    resourcesPath: options.resourcesPath,
    configPresenter,
    mcpPresenter,
    skillPresenter
  } as any)
  return Object.assign(presenter, {
    __mocks: {
      configPresenter,
      mcpPresenter,
      skillPresenter
    }
  })
}

const createBundledFixture = async (
  options: {
    appPath?: string
    packageRoot?: string
    pluginId?: string
    name?: string
    includeSettings?: boolean
  } = {}
) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-test-'))
  tempRoots.push(root)
  const appPath = options.appPath ?? path.join(root, 'app')
  const userDataPath = path.join(root, 'userData')
  const packageRoot = options.packageRoot ?? path.join(appPath, 'plugins')
  const packagePath = path.join(packageRoot, 'deepchat-plugin-fixture-0.2.3-darwin-x64.dcplugin')
  const runtimeFileName = process.platform === 'win32' ? 'fixture-runtime.cmd' : 'fixture-runtime'
  const runtimeRelativePath = `runtime/darwin/${process.arch}/${runtimeFileName}`
  const pluginId = options.pluginId ?? 'com.deepchat.plugins.fixture'
  const includeSettings = options.includeSettings ?? false
  const manifest = {
    id: pluginId,
    name: options.name ?? 'Fixture Runtime',
    version: '0.2.3',
    publisher: 'DeepChat',
    engines: {
      deepchat: '>=0.2.3',
      platforms: ['darwin']
    },
    activationEvents: ['onEnable'],
    capabilities: includeSettings
      ? ['runtime.manage', 'mcp.register', 'settings.contribute']
      : ['runtime.manage', 'mcp.register'],
    source: {
      type: 'deepchat-official',
      url: 'https://github.com/ThinkInAIXYZ/deepchat/releases/download/v0.2.3/deepchat-plugin-fixture-0.2.3-darwin-x64.dcplugin',
      publisher: 'DeepChat'
    },
    runtime: {
      id: 'fixture-runtime',
      type: 'external-helper',
      displayName: 'Fixture Runtime',
      detect: [`PATH:${process.execPath}`],
      install: {
        mode: 'user-confirmed',
        provider: 'fixture',
        strategy: 'bundled-plugin-helper',
        guideUrl: 'https://example.com/runtime-guide'
      }
    },
    mcpServers: [
      {
        id: 'fixture-runtime',
        displayName: 'Fixture Runtime',
        transport: 'stdio',
        command: '${runtime.fixture-runtime.command}',
        args: ['mcp'],
        autoApprove: []
      }
    ],
    ...(includeSettings
      ? {
          settingsContributions: [
            {
              id: 'fixture-settings',
              title: 'Fixture Settings',
              placement: 'plugins',
              entry: 'settings/index.html',
              preloadTypes: 'types/settings-preload.d.ts'
            }
          ]
        }
      : {})
  }
  const files: Record<string, Uint8Array> = {
    'plugin.json': new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    [runtimeRelativePath]: new TextEncoder().encode(
      process.platform === 'win32'
        ? '@echo off\r\necho fixture-runtime 1.0.0\r\n'
        : '#!/bin/sh\necho fixture-runtime 1.0.0\n'
    )
  }
  if (includeSettings) {
    files['settings/index.html'] = new TextEncoder().encode(
      '<!doctype html><title>Fixture Settings</title>\n'
    )
    files['types/settings-preload.d.ts'] = new TextEncoder().encode(
      'interface Window { deepchatPlugin?: unknown }\n'
    )
  }
  const checksums = Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      createHash('sha256').update(Buffer.from(content)).digest('hex')
    ])
  )
  files['checksums.json'] = new TextEncoder().encode(`${JSON.stringify(checksums, null, 2)}\n`)

  await mkdir(packageRoot, { recursive: true })
  await mkdir(userDataPath, { recursive: true })
  await writeFile(packagePath, Buffer.from(zipSync(files, { level: 6 })))
  vi.mocked(app.getPath).mockImplementation((name: string) => {
    if (name === 'userData') {
      return userDataPath
    }
    if (name === 'temp' || name === 'home') {
      return root
    }
    return '/mock/path'
  })

  return {
    appPath,
    userDataPath,
    pluginId: manifest.id,
    packagePath
  }
}

const createOfficialPackage = async (options: {
  packageRoot: string
  packagePath: string
  pluginId: string
  name: string
  targets: string[]
}) => {
  const manifest = {
    id: options.pluginId,
    name: options.name,
    version: '0.2.3',
    publisher: 'DeepChat',
    engines: {
      deepchat: '>=0.2.3',
      platforms: ['win32'],
      targets: options.targets
    },
    activationEvents: ['onEnable'],
    capabilities: [],
    source: {
      type: 'deepchat-official',
      url: `https://github.com/ThinkInAIXYZ/deepchat/releases/download/v0.2.3/${path.basename(options.packagePath)}`,
      publisher: 'DeepChat'
    }
  }
  const files: Record<string, Uint8Array> = {
    'plugin.json': new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  }
  const checksums = Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      createHash('sha256').update(Buffer.from(content)).digest('hex')
    ])
  )
  files['checksums.json'] = new TextEncoder().encode(`${JSON.stringify(checksums, null, 2)}\n`)

  await mkdir(options.packageRoot, { recursive: true })
  await writeFile(options.packagePath, Buffer.from(zipSync(files, { level: 6 })))
}

const createDirectoryFixture = async (
  options: {
    appPath?: string
    pluginId?: string
    name?: string
  } = {}
) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-dir-test-'))
  tempRoots.push(root)
  const appPath = options.appPath ?? path.join(root, 'app')
  const userDataPath = path.join(root, 'userData')
  const pluginId = options.pluginId ?? 'com.deepchat.plugins.fixture'
  const pluginRoot = path.join(appPath, 'plugins', pluginId)
  const installedRoot = path.join(userDataPath, 'plugins', pluginId)
  const currentManifest = {
    id: pluginId,
    name: options.name ?? 'Fixture Settings Plugin',
    version: '0.2.3',
    publisher: 'DeepChat',
    engines: {
      deepchat: '>=0.2.3',
      platforms: ['darwin']
    },
    activationEvents: ['onEnable'],
    capabilities: ['mcp.register', 'settings.contribute'],
    source: {
      type: 'deepchat-official',
      url: 'https://github.com/ThinkInAIXYZ/deepchat/releases/download/v0.2.3/deepchat-plugin-fixture-0.2.3-darwin-x64.dcplugin',
      publisher: 'DeepChat'
    },
    mcpServers: [
      {
        id: 'fixture-tools',
        displayName: 'Fixture Tools',
        transport: 'stdio',
        command: 'node',
        args: ['${plugin.root}/mcp/serve.mjs'],
        env: {},
        autoApprove: ['all']
      }
    ],
    settingsContributions: [
      {
        id: 'fixture-settings',
        title: 'Fixture Settings',
        placement: 'plugins',
        entry: 'settings/index.html',
        preloadTypes: 'types/settings-preload.d.ts'
      }
    ]
  }
  const staleInstalledManifest = {
    ...currentManifest,
    capabilities: ['mcp.register'],
    mcpServers: [
      {
        id: 'fixture-tools',
        displayName: 'Fixture Tools',
        transport: 'stdio',
        command: 'node',
        args: ['${plugin.root}/mcp/legacy.mjs'],
        env: {
          FIXTURE_APP_ID: ''
        },
        autoApprove: ['all']
      }
    ]
  }
  delete (staleInstalledManifest as { settingsContributions?: unknown }).settingsContributions

  await mkdir(path.join(pluginRoot, 'mcp'), { recursive: true })
  await mkdir(path.join(pluginRoot, 'settings'), { recursive: true })
  await mkdir(path.join(pluginRoot, 'types'), { recursive: true })
  await mkdir(path.join(installedRoot, 'mcp'), { recursive: true })
  await mkdir(installedRoot, { recursive: true })
  await writeFile(
    path.join(pluginRoot, 'plugin.json'),
    `${JSON.stringify(currentManifest, null, 2)}\n`
  )
  await writeFile(path.join(pluginRoot, 'mcp', 'serve.mjs'), 'console.log("serve")\n')
  await writeFile(
    path.join(pluginRoot, 'settings', 'index.html'),
    '<!doctype html><title>Fixture Settings</title>\n'
  )
  await writeFile(
    path.join(pluginRoot, 'types', 'settings-preload.d.ts'),
    'interface Window { deepchatPlugin?: unknown }\n'
  )
  await writeFile(
    path.join(installedRoot, 'plugin.json'),
    `${JSON.stringify(staleInstalledManifest, null, 2)}\n`
  )
  await writeFile(path.join(installedRoot, 'mcp', 'legacy.mjs'), 'console.log("legacy")\n')
  vi.mocked(app.getPath).mockImplementation((name: string) => {
    if (name === 'userData') {
      return userDataPath
    }
    if (name === 'temp' || name === 'home') {
      return root
    }
    return '/mock/path'
  })

  return {
    appPath,
    pluginId,
    pluginRoot,
    installedRoot,
    userDataPath
  }
}

describe('PluginPresenter', () => {
  afterEach(async () => {
    process.chdir(originalCwd)
    vi.mocked(app.getPath).mockImplementation(() => '/mock/path')
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('uses CUA target metadata to show only supported platform and arch pairs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-platform-test-'))
    tempRoots.push(root)
    const userDataPath = path.join(root, 'userData')
    await mkdir(userDataPath, { recursive: true })
    vi.mocked(app.getPath).mockImplementation((name: string) =>
      name === 'userData' ? userDataPath : path.join(root, name)
    )

    const winX64Presenter = await createPluginPresenter('win32', { arch: 'x64' })
    const winArmPresenter = await createPluginPresenter('win32', { arch: 'arm64' })
    const linuxX64Presenter = await createPluginPresenter('linux', { arch: 'x64' })
    const linuxArmPresenter = await createPluginPresenter('linux', { arch: 'arm64' })
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))

    expect(manifest.engines.platforms).toEqual(['darwin', 'win32', 'linux'])
    expect(manifest.engines.targets).toEqual([
      'darwin/arm64',
      'darwin/x64',
      'win32/x64',
      'win32/arm64',
      'linux/x64'
    ])
    expect((await winX64Presenter.listPlugins()).map((plugin) => plugin.id)).toContain(
      'com.deepchat.plugins.cua'
    )
    expect((await linuxX64Presenter.listPlugins()).map((plugin) => plugin.id)).toContain(
      'com.deepchat.plugins.cua'
    )
    expect((await winArmPresenter.listPlugins()).map((plugin) => plugin.id)).toContain(
      'com.deepchat.plugins.cua'
    )
    expect((await linuxArmPresenter.listPlugins()).map((plugin) => plugin.id)).not.toContain(
      'com.deepchat.plugins.cua'
    )
  })

  it('selects the matching CUA package when target artifacts are side by side', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-package-target-test-'))
    tempRoots.push(root)
    const appPath = path.join(root, 'app')
    const userDataPath = path.join(root, 'userData')
    const packageRoot = path.join(root, 'build', 'bundled-plugins')
    const pluginId = 'com.deepchat.plugins.cua'
    const winX64Package = path.join(packageRoot, 'deepchat-plugin-cua-0.2.3-win32-x64.dcplugin')
    const winArmPackage = path.join(packageRoot, 'deepchat-plugin-cua-0.2.3-win32-arm64.dcplugin')
    await mkdir(userDataPath, { recursive: true })
    await createOfficialPackage({
      packageRoot,
      packagePath: winArmPackage,
      pluginId,
      name: 'CUA Windows ARM64',
      targets: ['win32/arm64']
    })
    await createOfficialPackage({
      packageRoot,
      packagePath: winX64Package,
      pluginId,
      name: 'CUA Windows X64',
      targets: ['win32/x64']
    })
    vi.mocked(app.getPath).mockImplementation((name: string) =>
      name === 'userData' ? userDataPath : path.join(root, name)
    )
    process.chdir(root)

    const presenter = await createPluginPresenter('win32', { appPath, arch: 'x64' })
    await presenter.__mocks.configPresenter.addMcpServer('cua-driver', {
      ownerPluginId: pluginId,
      source: 'plugin',
      sourceId: pluginId
    })
    presenter.__mocks.mcpPresenter.isServerRunning.mockResolvedValue(true)

    await (presenter as any).loadOfficialPlugins()

    const resolvedPlugin = (presenter as any).officialPlugins.get(pluginId)
    expect(resolvedPlugin.manifest.name).toBe('CUA Windows X64')
    expect(fs.realpathSync(resolvedPlugin.sourcePath)).toBe(fs.realpathSync(winX64Package))
    expect(presenter.__mocks.mcpPresenter.stopServer).not.toHaveBeenCalled()
    expect(presenter.__mocks.configPresenter.removeMcpServer).not.toHaveBeenCalled()
  })

  it('lists bundled official plugins as installed and enables them by materializing the package', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginPresenter('darwin', fixture.appPath)

    const plugins = await presenter.listPlugins()
    const plugin = plugins.find((item) => item.id === fixture.pluginId)
    expect(plugin).toMatchObject({
      id: fixture.pluginId,
      installed: true,
      enabled: false,
      trusted: true,
      trustState: 'trusted'
    })

    const result = await presenter.enablePlugin(fixture.pluginId)
    expect(result.ok).toBe(true)
    expect(result.status).toMatchObject({
      id: fixture.pluginId,
      installed: true,
      enabled: true,
      runtime: {
        state: 'installed',
        version: process.version
      }
    })
    expect(
      fs.existsSync(path.join(fixture.userDataPath, 'plugins', fixture.pluginId, 'plugin.json'))
    ).toBe(true)

    const disabled = await presenter.disablePlugin(fixture.pluginId)
    expect(disabled.ok).toBe(true)
    expect(disabled.status).toMatchObject({
      id: fixture.pluginId,
      installed: true,
      enabled: false
    })
  })

  it('restores plugin settings from the installed manifest when stored resources are missing', async () => {
    const fixture = await createBundledFixture({ includeSettings: true })
    const presenter = await createPluginPresenter('darwin', fixture.appPath)
    vi.clearAllMocks()

    const enabled = await presenter.enablePlugin(fixture.pluginId)

    expect(enabled.ok).toBe(true)
    expect(enabled.status).toMatchObject({
      id: fixture.pluginId,
      enabled: true,
      settings: {
        id: 'fixture-settings',
        ownerPluginId: fixture.pluginId,
        title: 'Fixture Settings'
      }
    })

    ;(presenter as any).store.set('resources', [])

    const plugin = await presenter.getPlugin(fixture.pluginId)

    expect(plugin).toMatchObject({
      id: fixture.pluginId,
      enabled: true,
      settings: {
        id: 'fixture-settings',
        ownerPluginId: fixture.pluginId,
        title: 'Fixture Settings'
      }
    })

    const action = await presenter.invokeAction(fixture.pluginId, 'settings.open')

    expect(action).toMatchObject({ ok: true })
    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(BrowserWindow).mock.results[0]?.value.loadFile).toHaveBeenCalledWith(
      path.join(fixture.userDataPath, 'plugins', fixture.pluginId, 'settings', 'index.html'),
      {
        query: {
          pluginId: fixture.pluginId
        }
      }
    )
  })

  it('opens settings for a disabled packaged plugin that declares a settings contribution', async () => {
    const fixture = await createBundledFixture({ includeSettings: true })
    const presenter = await createPluginPresenter('darwin', fixture.appPath)
    vi.clearAllMocks()

    const plugin = (await presenter.listPlugins()).find((item) => item.id === fixture.pluginId)

    expect(plugin).toMatchObject({
      id: fixture.pluginId,
      enabled: false,
      settings: {
        id: 'fixture-settings',
        ownerPluginId: fixture.pluginId,
        title: 'Fixture Settings'
      }
    })

    const action = await presenter.invokeAction(fixture.pluginId, 'settings.open')

    expect(action).toMatchObject({ ok: true })
    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(BrowserWindow).mock.results[0]?.value.loadFile).toHaveBeenCalledWith(
      path.join(fixture.userDataPath, 'plugins', fixture.pluginId, 'settings', 'index.html'),
      {
        query: {
          pluginId: fixture.pluginId
        }
      }
    )
  })

  it('uses the current official manifest when an installed copy lacks settings metadata', async () => {
    const fixture = await createBundledFixture({ includeSettings: true })
    const presenter = await createPluginPresenter('darwin', fixture.appPath)

    const enabled = await presenter.enablePlugin(fixture.pluginId)
    expect(enabled.ok).toBe(true)

    const disabled = await presenter.disablePlugin(fixture.pluginId)
    expect(disabled.ok).toBe(true)

    const installedManifestPath = path.join(
      fixture.userDataPath,
      'plugins',
      fixture.pluginId,
      'plugin.json'
    )
    const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'))
    delete installedManifest.settingsContributions
    await writeFile(installedManifestPath, `${JSON.stringify(installedManifest, null, 2)}\n`)
    vi.clearAllMocks()

    const plugin = await presenter.getPlugin(fixture.pluginId)

    expect(plugin).toMatchObject({
      id: fixture.pluginId,
      enabled: false,
      settings: {
        id: 'fixture-settings',
        ownerPluginId: fixture.pluginId,
        title: 'Fixture Settings'
      }
    })

    const action = await presenter.invokeAction(fixture.pluginId, 'settings.open')

    expect(action).toMatchObject({ ok: true })
    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(BrowserWindow).mock.results[0]?.value.loadFile).toHaveBeenCalledWith(
      path.join(fixture.userDataPath, 'plugins', fixture.pluginId, 'settings', 'index.html'),
      {
        query: {
          pluginId: fixture.pluginId
        }
      }
    )
  })

  it('prefers workspace plugin metadata over a stale installed directory copy in development', async () => {
    const fixture = await createDirectoryFixture()
    const presenter = await createPluginPresenter('darwin', fixture.appPath)
    vi.clearAllMocks()

    const plugin = await presenter.getPlugin(fixture.pluginId)

    expect(plugin).toMatchObject({
      id: fixture.pluginId,
      enabled: false,
      settings: {
        id: 'fixture-settings',
        ownerPluginId: fixture.pluginId,
        title: 'Fixture Settings'
      }
    })

    const action = await presenter.invokeAction(fixture.pluginId, 'settings.open')

    expect(action).toMatchObject({ ok: true })
    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(BrowserWindow).mock.results[0]?.value.loadFile).toHaveBeenCalledWith(
      path.join(fixture.installedRoot, 'settings', 'index.html'),
      {
        query: {
          pluginId: fixture.pluginId
        }
      }
    )
  })

  it('refreshes stale same-version installs before startup activation and preserves config', async () => {
    const fixture = await createDirectoryFixture()
    const presenter = await createPluginPresenter('darwin', fixture.appPath)
    const config = {
      appId: 'cli_fixture_app_id',
      appSecret: 'fixture-secret',
      brand: 'feishu',
      preset: 'preset.default'
    }
    await writeFile(path.join(fixture.installedRoot, 'config.json'), `${JSON.stringify(config)}\n`)
    ;(presenter as any).store.set('installations', [
      {
        pluginId: fixture.pluginId,
        version: '0.2.3',
        path: fixture.installedRoot,
        enabled: true,
        trusted: true,
        source: 'deepchat-official',
        installedAt: Date.now(),
        updatedAt: Date.now()
      }
    ])

    await presenter.initialize()

    const installedManifest = JSON.parse(
      await readFile(path.join(fixture.installedRoot, 'plugin.json'), 'utf8')
    )
    const configAfterRefresh = JSON.parse(
      await readFile(path.join(fixture.installedRoot, 'config.json'), 'utf8')
    )
    const servers = await presenter.__mocks.configPresenter.getMcpServers()

    expect(installedManifest.settingsContributions).toEqual([
      {
        id: 'fixture-settings',
        title: 'Fixture Settings',
        placement: 'plugins',
        entry: 'settings/index.html',
        preloadTypes: 'types/settings-preload.d.ts'
      }
    ])
    expect(installedManifest.mcpServers[0].args).toEqual(['${plugin.root}/mcp/serve.mjs'])
    expect(fs.existsSync(path.join(fixture.installedRoot, 'mcp', 'serve.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(fixture.installedRoot, 'mcp', 'legacy.mjs'))).toBe(false)
    expect(configAfterRefresh).toMatchObject(config)
    expect(servers['fixture-tools']).toMatchObject({
      source: 'plugin',
      sourceId: fixture.pluginId,
      enabled: true
    })
    expect(servers['fixture-tools'].args.map((arg: string) => path.normalize(arg))).toEqual([
      path.join(fixture.installedRoot, 'mcp', 'serve.mjs')
    ])
    expect(presenter.__mocks.mcpPresenter.startServer).toHaveBeenCalledWith('fixture-tools')
  })

  it('syncs dev directory installs even when only the plugin files changed', async () => {
    const fixture = await createDirectoryFixture()
    const presenter = await createPluginPresenter('darwin', fixture.appPath)
    const currentManifest = await readFile(path.join(fixture.pluginRoot, 'plugin.json'), 'utf8')
    const config = {
      appId: 'cli_fixture_app_id',
      appSecret: 'fixture-secret',
      brand: 'feishu',
      preset: 'preset.default'
    }

    await writeFile(path.join(fixture.installedRoot, 'plugin.json'), currentManifest)
    await writeFile(path.join(fixture.installedRoot, 'mcp', 'serve.mjs'), 'console.log("stale")\n')
    await writeFile(path.join(fixture.installedRoot, 'config.json'), `${JSON.stringify(config)}\n`)
    ;(presenter as any).store.set('installations', [
      {
        pluginId: fixture.pluginId,
        version: '0.2.3',
        path: fixture.installedRoot,
        enabled: true,
        trusted: true,
        source: 'deepchat-official',
        installedAt: Date.now(),
        updatedAt: Date.now()
      }
    ])

    await presenter.initialize()

    const serveScript = await readFile(path.join(fixture.installedRoot, 'mcp', 'serve.mjs'), 'utf8')
    const configAfterRefresh = JSON.parse(
      await readFile(path.join(fixture.installedRoot, 'config.json'), 'utf8')
    )

    expect(serveScript).toBe('console.log("serve")\n')
    expect(configAfterRefresh).toMatchObject(config)
    expect(presenter.__mocks.mcpPresenter.startServer).toHaveBeenCalledWith('fixture-tools')
  })

  it('removes persisted plugin state when discovery rejects an installed official plugin', async () => {
    const fixture = await createDirectoryFixture()
    const workspaceManifestPath = path.join(fixture.pluginRoot, 'plugin.json')
    const manifest = JSON.parse(await readFile(workspaceManifestPath, 'utf8'))
    manifest.toolPolicies = [
      {
        serverId: 'fixture-tools',
        tools: {
          fixture_tool: 'ask'
        }
      }
    ]
    await writeFile(workspaceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const presenter = await createPluginPresenter('darwin', fixture.appPath)
    const { getPluginToolPolicy } = await import('@/presenter/pluginPresenter/toolPolicyStore')

    const enabled = await presenter.enablePlugin(fixture.pluginId)
    expect(enabled.ok).toBe(true)
    expect(getPluginToolPolicy('fixture-tools', 'fixture_tool')).toBe('ask')

    const rejectedManifest = {
      ...manifest,
      engines: {
        ...manifest.engines,
        platforms: ['linux']
      }
    }
    await writeFile(workspaceManifestPath, `${JSON.stringify(rejectedManifest, null, 2)}\n`)
    await writeFile(
      path.join(fixture.installedRoot, 'plugin.json'),
      `${JSON.stringify(rejectedManifest, null, 2)}\n`
    )

    await presenter.initialize()

    const servers = await presenter.__mocks.configPresenter.getMcpServers()

    expect((presenter as any).store.get('installations')).toEqual([])
    expect((presenter as any).store.get('resources')).toEqual([])
    expect((presenter as any).store.get('runtimes')).toEqual([])
    expect(servers['fixture-tools']).toBeUndefined()
    expect(getPluginToolPolicy('fixture-tools', 'fixture_tool')).toBeNull()
  })

  it('loads official packages only from resources roots in packaged mode', async () => {
    const cwdRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-cwd-'))
    tempRoots.push(cwdRoot)
    const resourcesPath = path.join(cwdRoot, 'resources')
    const pluginId = 'com.deepchat.plugins.fixture'
    await createBundledFixture({
      packageRoot: path.join(cwdRoot, 'build', 'bundled-plugins'),
      pluginId,
      name: 'Forged Runtime'
    })
    await createBundledFixture({
      packageRoot: path.join(resourcesPath, 'plugins'),
      pluginId,
      name: 'Resource Runtime'
    })
    process.chdir(cwdRoot)
    const presenter = await createPluginPresenter('darwin', {
      appPath: path.join(cwdRoot, 'app'),
      isPackaged: true,
      resourcesPath
    })

    const plugins = await presenter.listPlugins()

    const plugin = plugins.find((item) => item.id === pluginId)
    expect(plugin).toMatchObject({
      id: pluginId,
      name: 'Resource Runtime',
      trusted: true,
      trustState: 'trusted'
    })
  })

  it('loads the electron-vite plugin settings preload output', async () => {
    const presenterSource = await readFile('src/main/presenter/pluginPresenter/index.ts', 'utf8')
    const viteConfigSource = await readFile('electron.vite.config.ts', 'utf8')

    expect(viteConfigSource).toContain('pluginSettings: resolve')
    expect(presenterSource).toContain('../preload/pluginSettings.mjs')
    expect(presenterSource).not.toContain('../preload/plugin-settings-preload.mjs')
  })

  it('uses upstream-compatible CUA permission tool args for runtime checks', async () => {
    const presenterSource = await readFile('src/main/presenter/pluginPresenter/index.ts', 'utf8')
    const presenter = await createPluginPresenter('darwin')

    expect((presenter as any).runtimePermissionToolArgs()).toEqual([
      'check_permissions',
      '{"prompt":false}'
    ])
    expect(presenterSource).not.toContain('deepchat-permission-probe')
    expect(presenterSource).not.toContain('Runtime permission probe failed')
  })

  it('opens the detected macOS helper app for runtime permission guidance', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginPresenter('darwin', fixture.appPath)
    const helperAppPath = path.join(
      fixture.userDataPath,
      'plugins',
      fixture.pluginId,
      'runtime',
      'darwin',
      process.arch,
      'DeepChat Computer Use.app'
    )
    const helperCommand = path.join(helperAppPath, 'Contents', 'MacOS', 'deepchat-cua-driver')
    vi.mocked(shell.openPath).mockResolvedValue('')
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
    await presenter.enablePlugin(fixture.pluginId)
    ;(presenter as any).refreshRuntime = vi.fn().mockResolvedValue({
      runtimeId: 'fixture-runtime',
      displayName: 'Fixture Runtime',
      state: 'installed',
      command: helperCommand,
      helperAppPath
    })

    const action = await presenter.invokeAction(fixture.pluginId, 'runtime.openPermissionGuide')

    expect(action).toMatchObject({ ok: true })
    expect(shell.openPath).toHaveBeenCalledWith(helperAppPath)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('falls back to the declared runtime guide when no macOS helper path is available', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginPresenter('darwin', fixture.appPath)
    vi.mocked(shell.openPath).mockResolvedValue('')
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
    await presenter.enablePlugin(fixture.pluginId)
    vi.mocked(shell.openPath).mockClear()
    vi.mocked(shell.openExternal).mockClear()
    ;(presenter as any).refreshRuntime = vi.fn().mockResolvedValue({
      runtimeId: 'fixture-runtime',
      displayName: 'Fixture Runtime',
      state: 'missing'
    })

    const action = await presenter.invokeAction(fixture.pluginId, 'runtime.openPermissionGuide')

    expect(action).toMatchObject({ ok: true })
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/runtime-guide')
  })

  it('parses Windows CUA permission JSON diagnostics', async () => {
    const presenter = await createPluginPresenter('win32')

    const result = (presenter as any).parseRuntimePermissionToolResult(
      'cua-driver.exe',
      JSON.stringify({
        elevated: false,
        integrity_level: 'Medium',
        integrity_level_rid: 8192,
        post_message: true,
        uia: true
      }),
      ''
    )

    expect(result).toMatchObject({
      platform: 'win32',
      accessibility: 'unknown',
      screenRecording: 'unknown',
      postMessage: 'granted',
      uia: 'granted',
      diagnostics: {
        elevated: false,
        integrity_level: 'Medium',
        integrity_level_rid: 8192,
        post_message: true,
        uia: true
      }
    })
    expect(result.error).toBeUndefined()
  })

  it('parses CUA permission text and removes misleading shell hints', async () => {
    const presenter = await createPluginPresenter('darwin')

    const result = (presenter as any).parseRuntimePermissionToolResult(
      '/mock/deepchat-cua-driver',
      '❌ Accessibility: NOT granted.\n✅ Screen Recording: granted.\n',
      ''
    )
    const message = (presenter as any).sanitizePermissionError(
      'Command failed. hint: PowerShell 5.1 strips quotes around JSON field names. Fallback: Command failed.'
    )

    expect(result).toMatchObject({
      accessibility: 'missing',
      screenRecording: 'granted'
    })
    expect(message).not.toContain('PowerShell')
    expect(message).toContain('Fallback: Command failed.')
  })

  it('resolves CUA helper paths, MCP env, and runtime auto-start hooks', async () => {
    const presenterSource = await readFile('src/main/presenter/pluginPresenter/index.ts', 'utf8')

    expect(presenterSource).toContain('helperAppPath')
    expect(presenterSource).toContain('resolveHelperAppPath')
    expect(presenterSource).toContain('resolveAppHelperRelativePath')
    expect(presenterSource).toContain('resolvePluginTemplateRecord')
    expect(presenterSource).toContain('startPluginMcpServersIfReady')
    expect(presenterSource).toContain('this.mcpPresenter.startServer(serverName)')
    expect(presenterSource).not.toContain('if (!(await this.configPresenter.getMcpEnabled()))')
  })

  it('resolves packaged macOS CUA helpers from the managed app bundle', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-managed-helper-'))
    tempRoots.push(root)
    const resourcesPath = path.join(root, 'DeepChat.app', 'Contents', 'Resources')
    const presenter = await createPluginPresenter('darwin', {
      appPath: path.join(root, 'DeepChat.app'),
      isPackaged: true,
      resourcesPath
    })

    const command = (presenter as any).resolveRuntimeCandidate(
      'app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
      path.join(root, 'plugin')
    )

    expect(command).toBe(
      path.join(
        root,
        'DeepChat.app',
        'Contents',
        'Helpers',
        'DeepChat Computer Use.app',
        'Contents',
        'MacOS',
        'deepchat-cua-driver'
      )
    )
  })

  it('skips managed app helpers outside packaged macOS', async () => {
    const presenter = await createPluginPresenter('win32', {
      isPackaged: true,
      resourcesPath: path.join('C:', 'DeepChat', 'resources')
    })

    const command = (presenter as any).resolveRuntimeCandidate(
      'app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
      path.join('C:', 'plugin')
    )

    expect(command).toBeNull()
  })

  it('starts plugin MCP servers even when the global MCP switch is off', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginPresenter('darwin', {
      appPath: fixture.appPath,
      mcpEnabled: false
    })

    const result = await presenter.enablePlugin(fixture.pluginId)

    expect(result.ok).toBe(true)
    expect(presenter.__mocks.mcpPresenter.startServer).toHaveBeenCalledWith('fixture-runtime')
  })

  it('shuts down running plugin-owned MCP servers without removing saved config', async () => {
    const presenter = await createPluginPresenter('darwin')
    await presenter.__mocks.configPresenter.addMcpServer('regular-server', {
      source: 'manual'
    })
    await presenter.__mocks.configPresenter.addMcpServer('plugin-running', {
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.fixture',
      ownerPluginId: 'com.deepchat.plugins.fixture'
    })
    await presenter.__mocks.configPresenter.addMcpServer('plugin-stopped', {
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.other',
      ownerPluginId: 'com.deepchat.plugins.other'
    })
    presenter.__mocks.mcpPresenter.isServerRunning.mockImplementation(
      async (serverName: string) => serverName !== 'plugin-stopped'
    )

    await presenter.shutdown()

    expect(presenter.__mocks.mcpPresenter.stopServer).toHaveBeenCalledTimes(1)
    expect(presenter.__mocks.mcpPresenter.stopServer).toHaveBeenCalledWith('plugin-running')
    expect(presenter.__mocks.configPresenter.removeMcpServer).not.toHaveBeenCalled()
    expect(await presenter.__mocks.configPresenter.getMcpServers()).toMatchObject({
      'regular-server': {
        source: 'manual'
      },
      'plugin-running': {
        source: 'plugin',
        ownerPluginId: 'com.deepchat.plugins.fixture'
      },
      'plugin-stopped': {
        source: 'plugin',
        ownerPluginId: 'com.deepchat.plugins.other'
      }
    })
  })

  it('continues plugin shutdown when one plugin-owned MCP server fails to stop', async () => {
    const presenter = await createPluginPresenter('darwin')
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await presenter.__mocks.configPresenter.addMcpServer('plugin-first', {
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.first'
    })
    await presenter.__mocks.configPresenter.addMcpServer('plugin-second', {
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.second'
    })
    presenter.__mocks.mcpPresenter.isServerRunning.mockResolvedValue(true)
    presenter.__mocks.mcpPresenter.stopServer
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(undefined)

    await presenter.shutdown()

    expect(presenter.__mocks.mcpPresenter.stopServer).toHaveBeenCalledTimes(2)
    expect(presenter.__mocks.mcpPresenter.stopServer).toHaveBeenCalledWith('plugin-first')
    expect(presenter.__mocks.mcpPresenter.stopServer).toHaveBeenCalledWith('plugin-second')
    expect(presenter.__mocks.configPresenter.removeMcpServer).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[PluginHost] Failed to stop plugin-owned MCP server during shutdown:',
      expect.objectContaining({
        pluginId: 'com.deepchat.plugins.first',
        serverName: 'plugin-first',
        error: expect.any(Error)
      })
    )
    consoleWarnSpy.mockRestore()
  })

  it('declares the CUA internal tool server with cross-platform helper context', async () => {
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))
    const mcpConfig = JSON.parse(await readFile('plugins/cua/mcp/cua-driver.json', 'utf8'))
    const server = manifest.mcpServers.find((item: { id: string }) => item.id === 'cua-driver')

    expect(manifest.runtime.detect).toEqual([
      'app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
      'plugin:runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
      'plugin:runtime/win32/${arch}/cua-driver.exe',
      'plugin:runtime/linux/${arch}/cua-driver'
    ])
    expect(manifest.capabilities).toContain('shell.openPath')
    expect(server.args).toEqual(['mcp', '--no-daemon-relaunch'])
    expect(server.env).toEqual({
      CUA_DRIVER_MCP_MODE: '1',
      CUA_DRIVER_RS_MCP_NO_RELAUNCH: '1',
      DEEPCHAT_COMPUTER_USE_APP_PATH: '${runtime.cua-driver.helperAppPath}',
      DEEPCHAT_COMPUTER_USE_BINARY_PATH: '${runtime.cua-driver.command}'
    })
    expect(mcpConfig.env).toEqual(server.env)
  })

  it('keeps CUA v0.6.7 tool policies explicit and conservative', async () => {
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))
    const policy = JSON.parse(await readFile('plugins/cua/policies/tool-policy.json', 'utf8'))
    const manifestTools = manifest.toolPolicies.find(
      (item: { serverId: string }) => item.serverId === 'cua-driver'
    ).tools
    const EXPECTED_ALLOW = [
      'check_permissions',
      'list_apps',
      'list_windows',
      'get_screen_size',
      'get_window_state',
      'get_accessibility_tree',
      'get_cursor_position',
      'get_config',
      'get_recording_state',
      'get_agent_cursor_state',
      'check_for_update',
      'health_report',
      'debug_window_info',
      'start_session',
      'end_session'
    ]
    const EXPECTED_ASK = [
      'launch_app',
      'kill_app',
      'bring_to_front',
      'click',
      'right_click',
      'double_click',
      'drag',
      'mouse_button_down',
      'mouse_button_up',
      'mouse_drag',
      'parallel_mouse_drag',
      'scroll',
      'move_cursor',
      'type_text',
      'type_text_chars',
      'press_key',
      'hotkey',
      'set_value',
      'set_config',
      'start_recording',
      'stop_recording',
      'install_ffmpeg',
      'set_agent_cursor_enabled',
      'set_agent_cursor_motion',
      'set_agent_cursor_style',
      'replay_trajectory',
      'zoom',
      'page'
    ]

    for (const tool of EXPECTED_ALLOW) {
      expect(manifestTools[tool]).toBe('allow')
      expect(policy.tools[tool]).toBe('allow')
    }
    for (const tool of EXPECTED_ASK) {
      expect(manifestTools[tool]).toBe('ask')
      expect(policy.tools[tool]).toBe('ask')
    }

    expect(manifestTools.screenshot).toBeUndefined()
    expect(manifestTools.set_recording).toBeUndefined()
    expect(policy.tools.screenshot).toBeUndefined()
    expect(policy.tools.set_recording).toBeUndefined()
  })

  it('tracks CUA as a pinned upstream release asset set', async () => {
    const metadata = JSON.parse(
      await readFile('plugins/cua/vendor/cua-driver/upstream.json', 'utf8')
    )
    const buildScript = await readFile('scripts/build-cua-plugin-runtime.mjs', 'utf8')

    expect(metadata).toMatchObject({
      sourceKind: 'upstream-release',
      upstreamRepo: 'https://github.com/trycua/cua.git',
      upstreamSubdir: 'libs/cua-driver/rust',
      tag: 'cua-driver-rs-v0.6.7',
      commit: '2cba1e769264a18f5a9d5f4e419729eb7fc17962',
      version: '0.6.7',
      supportedTargets: ['darwin/arm64', 'darwin/x64', 'win32/x64', 'win32/arm64', 'linux/x64'],
      unsupportedTargets: ['linux/arm64']
    })
    expect(metadata.assets['windows-x64'].name).toBe('cua-driver-rs-0.6.7-windows-x86_64.zip')
    expect(metadata.assets['windows-arm64'].name).toBe('cua-driver-rs-0.6.7-windows-arm64.zip')
    expect(metadata.assets['linux-x64'].name).toBe('cua-driver-rs-0.6.7-linux-x86_64-binary.tar.gz')
    expect(buildScript).toContain('verifyChecksum')
    expect(buildScript).toContain('downloadFile')
    expect(buildScript).toContain('isLinuxGlibcLoaderMismatch')
    expect(buildScript).toContain('host glibc loader')
    expect(buildScript).toContain("targetPlatform !== 'darwin'")
    expect(buildScript).toContain('signDarwinHelper(runtimeDir, targetPlatform)')
    expect(buildScript).toContain('sourceKind')
    expect(buildScript).toContain('upstream-release')
    expect(buildScript).not.toContain('swift')
    expect(buildScript).not.toContain('--package-path')
  })

  it('keeps ACP registry build-time fetching compatible with Windows arm64', async () => {
    const source = await readFile('scripts/fetch-acp-registry.mjs', 'utf8')

    expect(source).toContain('node:https')
    expect(source).toContain('for (const agent of iconAgents)')
    expect(source).not.toContain('Promise.all(')
    expect(source).not.toContain('fetch(')
  })

  it('keeps unreviewed CUA tools out of the policy surface', async () => {
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))
    const policy = JSON.parse(await readFile('plugins/cua/policies/tool-policy.json', 'utf8'))
    const manifestTools = manifest.toolPolicies.find(
      (item: { serverId: string }) => item.serverId === 'cua-driver'
    ).tools

    expect(manifestTools.set_electron_accessibility).toBeUndefined()
    expect(policy.tools.set_electron_accessibility).toBeUndefined()
  })

  it('keeps the CUA skill instructions aligned with DeepChat bundled tools', async () => {
    const files = ['SKILL.md', 'README.md', 'WEB_APPS.md', 'RECORDING.md', 'TESTS.md']
    const contents = await Promise.all(
      files.map((file) => readFile(`plugins/cua/skills/cua-driver/${file}`, 'utf8'))
    )
    const combined = contents.join('\n')

    expect(combined).toContain('list_apps')
    expect(combined).toContain('launch_app')
    expect(combined).toContain('get_window_state')
    expect(combined).toContain('check_permissions')
    expect(combined).toContain('set_agent_cursor_style')
    expect(combined).toContain('DeepChat Computer Use.app')
    expect(combined).toContain('win32/x64')
    expect(combined).toContain('linux/x64')
    expect(combined).toContain('win32/arm64')
    expect(combined).toContain('start_recording')
    expect(combined).toContain('stop_recording')
    expect(combined).not.toContain('screenshot({ window_id })')
    expect(combined).not.toContain('set_recording')
    expect(combined).toContain('zoom({ pid, window_id')
    expect(combined).toContain('Repeated zoom calls are a failure signal')
    expect(combined).toContain('Do not ask the user to install CUA manually')
    expect(combined).not.toContain('Bash')
    expect(combined).not.toContain('cua-driver <tool')
    expect(combined).not.toContain('open -n -g -a')
  })

  it('pins the Feishu MCP bootstrap package and keeps registry selection explicit', async () => {
    const source = await readFile('plugins/feishu/mcp/serve.mjs', 'utf8')

    expect(source).not.toContain('@modelcontextprotocol/sdk')
    expect(source).toContain('Content-Length:')
    expect(source).toContain('@larksuiteoapi/lark-mcp@0.5.1')
    expect(source).toContain('REGISTRY_OVERRIDE')
    expect(source).not.toContain('registry.npmmirror.com')
  })

  it('uses conservative Feishu MCP defaults in the plugin manifest', async () => {
    const manifest = JSON.parse(await readFile('plugins/feishu/plugin.json', 'utf8'))

    expect(manifest.mcpServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'feishu-tools',
          autoApprove: []
        })
      ])
    )
  })

  it('declares a Feishu plugin skill for MCP tool routing', async () => {
    const manifest = JSON.parse(await readFile('plugins/feishu/plugin.json', 'utf8'))
    const skill = await readFile('plugins/feishu/skills/feishu-tools/SKILL.md', 'utf8')

    expect(manifest.capabilities).toContain('skills.register')
    expect(manifest.skills).toEqual([
      {
        id: 'feishu-tools',
        path: 'skills/feishu-tools/SKILL.md',
        scope: 'agent'
      }
    ])
    expect(skill).toContain('This plugin is an MCP server tool surface')
    expect(skill).toContain('Do not ask the user to classify the plugin')
    expect(skill).toContain('Use the live tool names and descriptions in the current session')
    expect(skill).toContain('Feishu plugin settings')
  })

  it('wires CUA plugin packaging docs and release gates for supported targets', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
    const buildWorkflow = await readFile('.github/workflows/build.yml', 'utf8')
    const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8')
    const packageScript = await readFile('scripts/package-plugin.mjs', 'utf8')
    const guide = await readFile('docs/guides/plugin-packaging.md', 'utf8')

    expect(packageJson.scripts['plugin:cua:build:mac:arm64']).toContain('--arch arm64')
    expect(packageJson.scripts['plugin:cua:build:mac:x64']).toContain('--arch x64')
    expect(packageJson.scripts['plugin:cua:build:win:x64']).toContain('--platform win32 --arch x64')
    expect(packageJson.scripts['plugin:cua:build:win:arm64']).toContain(
      '--platform win32 --arch arm64'
    )
    expect(packageJson.scripts['plugin:cua:build:linux:x64']).toContain(
      '--platform linux --arch x64'
    )
    expect(packageJson.scripts['plugin:bundle:clean']).toContain('build/managed-helpers')
    expect(packageJson.scripts['build:mac:arm64']).toContain(
      'plugin:bundle -- --name cua --platform darwin --arch arm64'
    )
    expect(packageJson.scripts['build:mac:x64']).toContain(
      'plugin:bundle -- --name cua --platform darwin --arch x64'
    )
    expect(packageJson.scripts['build:win:x64']).toContain(
      'plugin:bundle -- --name cua --platform win32 --arch x64'
    )
    expect(packageJson.scripts['build:win:arm64']).toContain(
      'plugin:bundle -- --name cua --platform win32 --arch arm64'
    )
    expect(packageJson.scripts['build:linux:x64']).toContain(
      'plugin:bundle -- --name cua --platform linux --arch x64'
    )
    expect(packageJson.scripts['build:mac:arm64']).toContain('installRuntime:duckdb:vss:mac:arm64')
    expect(packageJson.scripts['build:mac:x64']).toContain('installRuntime:duckdb:vss:mac:x64')
    expect(packageJson.scripts['build:win:x64']).toContain('installRuntime:duckdb:vss:win:x64')
    expect(packageJson.scripts['build:win:arm64']).toContain('installRuntime:duckdb:vss:win:arm64')
    expect(packageJson.scripts['build:linux:x64']).toContain('installRuntime:duckdb:vss:linux:x64')
    expect(packageJson.scripts['build:linux:arm64']).toContain(
      'installRuntime:duckdb:vss:linux:arm64'
    )
    expect(buildWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform darwin --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain(
      'pnpm run installRuntime:duckdb:vss -- --platform darwin --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform darwin --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain(
      'pnpm run installRuntime:duckdb:vss -- --platform win32 --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform win32 --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain(
      'pnpm run installRuntime:duckdb:vss -- --platform linux --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform linux --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain('runs-on: ${{ matrix.runner }}')
    expect(buildWorkflow).toMatch(/(^|\n)\s*runner:\s+macos-15-intel(\n|$)/)
    expect(buildWorkflow).toMatch(/(^|\n)\s*runner:\s+macos-15(\n|$)/)
    expect(buildWorkflow).toContain('Verify packaged DuckDB VSS for Windows')
    expect(buildWorkflow).toContain('Verify packaged DuckDB VSS for Linux')
    expect(buildWorkflow).toContain('Verify packaged DuckDB VSS for macOS')
    expect(buildWorkflow).toContain(
      'dist/${{ matrix.unpacked }}/resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension'
    )
    expect(buildWorkflow).toContain(
      'dist/linux-unpacked/resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension'
    )
    expect(buildWorkflow).toContain(
      '${APP_DIR}/Contents/Resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension.b64'
    )
    expect(buildWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform darwin --arch "$TARGET_ARCH" --extension-base64-path "$EXTENSION_BASE64_PATH"'
    )
    expect(buildWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform win32 --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform linux --arch ${{ matrix.arch }}'
    )
    expect(buildWorkflow).toContain('- name: Build Windows\n        shell: bash')
    expect(buildWorkflow).not.toContain('if ("${{ matrix.arch }}" -eq "x64")')
    expect(buildWorkflow).toContain('Verify bundled plugins')
    expect(buildWorkflow).toContain('Contents/Resources/app.asar.unpacked/plugins')
    expect(releaseWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform darwin --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform win32 --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform linux --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run installRuntime:duckdb:vss -- --platform darwin --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform darwin --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run installRuntime:duckdb:vss -- --platform win32 --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform win32 --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run installRuntime:duckdb:vss -- --platform linux --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform linux --arch ${{ matrix.arch }}'
    )
    expect(releaseWorkflow).toContain('runs-on: ${{ matrix.runner }}')
    expect(releaseWorkflow).toMatch(/(^|\n)\s*runner:\s+macos-15-intel(\n|$)/)
    expect(releaseWorkflow).toMatch(/(^|\n)\s*runner:\s+macos-15(\n|$)/)
    expect(releaseWorkflow).toContain('Verify packaged DuckDB VSS for Windows')
    expect(releaseWorkflow).toContain('Verify packaged DuckDB VSS for Linux')
    expect(releaseWorkflow).toContain('Verify packaged DuckDB VSS for macOS')
    expect(releaseWorkflow).toContain(
      'dist/${{ matrix.unpacked }}/resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension'
    )
    expect(releaseWorkflow).toContain(
      'dist/linux-unpacked/resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension'
    )
    expect(releaseWorkflow).toContain(
      '${APP_DIR}/Contents/Resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension.b64'
    )
    expect(releaseWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform darwin --arch "$TARGET_ARCH" --extension-base64-path "$EXTENSION_BASE64_PATH"'
    )
    expect(releaseWorkflow).not.toContain('require_cua_plugin_asset')
    expect(releaseWorkflow).not.toContain('cp "${dir}/${asset}" release_assets/')
    expect(packageScript).toContain("parts[0] === 'runtime'")
    expect(packageScript).toContain('parts[1] !== args.targetPlatform')
    expect(packageScript).toContain('parts[2] !== args.targetArch')
    expect(packageScript).toContain('CUA plugin does not support')
    expect(packageScript).toContain('CUA_DARWIN_MANAGED_HELPER_DETECT')
    expect(guide).toContain('build/bundled-plugins/')
    expect(guide).toContain('build/managed-helpers/')
    expect(guide).toContain('Contents/Helpers/DeepChat Computer Use.app')
    expect(guide).toContain('app.asar.unpacked/plugins/')
    expect(guide).toContain('win32/arm64')
    expect(guide).toContain('linux/arm64')
  })
})
