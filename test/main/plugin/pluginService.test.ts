import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

type CreatePluginServiceOptions = {
  appPath?: string
  isPackaged?: boolean
  resourcesPath?: string
  mcpEnabled?: boolean
  arch?: NodeJS.Architecture
}

const createPluginService = async (
  platform: NodeJS.Platform,
  optionsOrAppPath: CreatePluginServiceOptions | string = process.cwd()
) => {
  const options =
    typeof optionsOrAppPath === 'string' ? { appPath: optionsOrAppPath } : optionsOrAppPath
  const { PluginService } = await import('@/plugin')
  const { PluginSettingsWindow } = await import('@/desktop/pluginSettingsWindow')
  const mcpServers: Record<string, unknown> = {}
  const mcpSettings = {
    getMcpServers: vi.fn().mockImplementation(async () => mcpServers),
    addMcpServer: vi.fn().mockImplementation(async (serverName: string, config: unknown) => {
      mcpServers[serverName] = config
    }),
    updateMcpServer: vi.fn().mockImplementation(async (serverName: string, config: unknown) => {
      mcpServers[serverName] = {
        ...(mcpServers[serverName] as Record<string, unknown> | undefined),
        ...(config as Record<string, unknown>)
      }
    }),
    removeMcpServer: vi.fn().mockImplementation(async (serverName: string) => {
      delete mcpServers[serverName]
    }),
    getMcpEnabled: vi.fn().mockResolvedValue(options.mcpEnabled ?? true)
  }
  const mcpService = {
    isReady: vi.fn(() => true),
    isServerRunning: vi.fn().mockResolvedValue(false),
    isServerActive: vi.fn().mockResolvedValue(false),
    startServer: vi.fn().mockResolvedValue(undefined),
    stopServer: vi.fn().mockResolvedValue(undefined),
    stopServerDuringShutdownByName: vi.fn().mockResolvedValue(undefined),
    getServerLastError: vi.fn().mockReturnValue(undefined),
    checkPluginRuntimePermissions: vi.fn().mockResolvedValue(undefined)
  }
  const runtimeRegistrations = new Map<string, Record<string, unknown>>()
  const runtimeSupervisor = {
    attachSafetyStore: vi.fn(),
    registerServer: vi.fn().mockImplementation((registration: Record<string, unknown>) => {
      runtimeRegistrations.set(String(registration.serverName), registration)
    }),
    commitPluginRegistration: vi.fn(),
    unregisterPlugin: vi.fn().mockImplementation(async (pluginId: string) => {
      for (const [serverName, registration] of runtimeRegistrations) {
        if (registration.pluginId === pluginId) {
          runtimeRegistrations.delete(serverName)
        }
      }
    }),
    reconcilePlugin: vi.fn().mockResolvedValue(undefined),
    testRuntime: vi.fn().mockResolvedValue(undefined),
    retryRuntime: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(undefined)
  }
  const skillService = {
    registerPluginSkill: vi.fn().mockResolvedValue(undefined),
    unregisterPluginSkillsByOwner: vi.fn().mockResolvedValue(undefined)
  }
  const presenter = new PluginService({
    platform,
    arch: options.arch,
    appPath: options.appPath ?? process.cwd(),
    isPackaged: options.isPackaged,
    resourcesPath: options.resourcesPath,
    mcpSettings,
    mcpService,
    runtimeSupervisor,
    skillService,
    settingsWindow: new PluginSettingsWindow()
  } as any)
  return Object.assign(presenter, {
    __mocks: {
      mcpServers,
      mcpSettings,
      mcpService,
      runtimeSupervisor,
      skillService
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
    startMode?: 'eager' | 'onDemand'
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
  const startMode = options.startMode ?? 'eager'
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
        autoApprove: [],
        ...(startMode === 'onDemand'
          ? {
              startMode,
              surfaces: ['tools'],
              toolCatalog: 'mcp/tool-catalog.json'
            }
          : {})
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
  if (startMode === 'onDemand') {
    files['mcp/tool-catalog.json'] = new TextEncoder().encode(
      `${JSON.stringify({
        version: '1.0.0',
        tools: [
          {
            name: 'fixture_tool',
            description: 'Fixture tool',
            input_schema: { type: 'object', properties: {}, required: [] },
            read_only: true,
            destructive: false,
            idempotent: true
          }
        ]
      })}\n`
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

describe('PluginService', () => {
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

    const winX64Presenter = await createPluginService('win32', { arch: 'x64' })
    const winArmPresenter = await createPluginService('win32', { arch: 'arm64' })
    const linuxX64Presenter = await createPluginService('linux', { arch: 'x64' })
    const linuxArmPresenter = await createPluginService('linux', { arch: 'arm64' })
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

    const presenter = await createPluginService('win32', { appPath, arch: 'x64' })
    await presenter.__mocks.mcpSettings.addMcpServer('cua-driver', {
      ownerPluginId: pluginId,
      source: 'plugin',
      sourceId: pluginId
    })
    presenter.__mocks.mcpService.isServerActive.mockResolvedValue(true)

    await (presenter as any).loadOfficialPlugins()

    const resolvedPlugin = (presenter as any).officialPlugins.get(pluginId)
    expect(resolvedPlugin.manifest.name).toBe('CUA Windows X64')
    expect(fs.realpathSync(resolvedPlugin.sourcePath)).toBe(fs.realpathSync(winX64Package))
    expect(presenter.__mocks.mcpService.stopServer).not.toHaveBeenCalled()
    expect(presenter.__mocks.mcpSettings.removeMcpServer).not.toHaveBeenCalled()
  })

  it('lists bundled official plugins as installed and enables them by materializing the package', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginService('darwin', fixture.appPath)

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
    const presenter = await createPluginService('darwin', fixture.appPath)
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
    const presenter = await createPluginService('darwin', fixture.appPath)
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
    const presenter = await createPluginService('darwin', fixture.appPath)

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
    const presenter = await createPluginService('darwin', fixture.appPath)
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
    const presenter = await createPluginService('darwin', fixture.appPath)
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
    const servers = await presenter.__mocks.mcpSettings.getMcpServers()

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
      enabled: false
    })
    expect(servers['fixture-tools'].args.map((arg: string) => path.normalize(arg))).toEqual([
      path.join(fixture.installedRoot, 'mcp', 'serve.mjs')
    ])
    expect(presenter.__mocks.runtimeSupervisor.registerServer).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: fixture.pluginId,
        serverName: 'fixture-tools',
        startMode: 'eager'
      }),
      { ready: false }
    )
    expect(presenter.__mocks.runtimeSupervisor.commitPluginRegistration).toHaveBeenCalledWith(
      fixture.pluginId
    )
    expect(presenter.__mocks.runtimeSupervisor.reconcilePlugin).toHaveBeenCalledWith(
      fixture.pluginId
    )
  })

  it('syncs dev directory installs even when only the plugin files changed', async () => {
    const fixture = await createDirectoryFixture()
    const presenter = await createPluginService('darwin', fixture.appPath)
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
    expect(presenter.__mocks.runtimeSupervisor.reconcilePlugin).toHaveBeenCalledWith(
      fixture.pluginId
    )
  })

  it('does not commit a partially activated plugin when a later contribution fails', async () => {
    const fixture = await createDirectoryFixture()
    const manifestPath = path.join(fixture.pluginRoot, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.capabilities.push('skills.register')
    manifest.skills = [
      {
        id: 'fixture-skill',
        path: 'skills/fixture/SKILL.md',
        scope: 'agent'
      }
    ]
    await mkdir(path.join(fixture.pluginRoot, 'skills', 'fixture'), { recursive: true })
    await writeFile(path.join(fixture.pluginRoot, 'skills', 'fixture', 'SKILL.md'), '# Fixture\n')
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const presenter = await createPluginService('darwin', fixture.appPath)
    presenter.__mocks.skillService.registerPluginSkill.mockRejectedValueOnce(
      new Error('skill registration failed')
    )

    const result = await presenter.enablePlugin(fixture.pluginId)
    const servers = await presenter.__mocks.mcpSettings.getMcpServers()

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining('skill registration failed')
      })
    )
    expect(presenter.__mocks.runtimeSupervisor.commitPluginRegistration).not.toHaveBeenCalled()
    expect(presenter.__mocks.runtimeSupervisor.unregisterPlugin).toHaveBeenLastCalledWith(
      fixture.pluginId
    )
    expect(servers['fixture-tools']).toBeUndefined()
    expect(await presenter.getPlugin(fixture.pluginId)).toMatchObject({
      enabled: false,
      activationError: 'skill registration failed'
    })

    await expect(presenter.disablePlugin(fixture.pluginId)).resolves.toMatchObject({ ok: true })
    expect((await presenter.getPlugin(fixture.pluginId))?.activationError).toBeUndefined()

    await expect(presenter.enablePlugin(fixture.pluginId)).resolves.toMatchObject({ ok: true })
    expect((await presenter.getPlugin(fixture.pluginId))?.activationError).toBeUndefined()
  })

  it('loads and stages a validated on-demand catalog before exposing the server', async () => {
    const fixture = await createDirectoryFixture()
    const manifestPath = path.join(fixture.pluginRoot, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    Object.assign(manifest.mcpServers[0], {
      startMode: 'onDemand',
      surfaces: ['tools'],
      toolCatalog: 'mcp/tool-catalog.json'
    })
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(
      path.join(fixture.pluginRoot, 'mcp', 'tool-catalog.json'),
      `${JSON.stringify({
        version: '1.0.0',
        tools: [
          {
            name: 'fixture_tool',
            description: 'Fixture tool',
            input_schema: { type: 'object', properties: {}, required: [] },
            read_only: false,
            destructive: true,
            idempotent: false
          }
        ]
      })}\n`
    )

    const presenter = await createPluginService('darwin', fixture.appPath)
    const result = await presenter.enablePlugin(fixture.pluginId)

    expect(result.ok).toBe(true)
    expect(presenter.__mocks.runtimeSupervisor.registerServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'fixture-tools',
        startMode: 'onDemand',
        surfaces: ['tools'],
        toolCatalog: {
          version: '1.0.0',
          tools: [
            expect.objectContaining({
              name: 'fixture_tool',
              annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false
              }
            })
          ]
        }
      }),
      { ready: false }
    )
    expect(
      presenter.__mocks.runtimeSupervisor.registerServer.mock.invocationCallOrder[0]
    ).toBeLessThan(
      presenter.__mocks.runtimeSupervisor.commitPluginRegistration.mock.invocationCallOrder[0]
    )
  })

  it('binds the CUA embedded adapter to its plugin-owned server registration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-adapter-registration-'))
    tempRoots.push(root)
    const catalogRelativePath = 'runtime/darwin/arm64/tool-catalog.json'
    const integrityRelativePath = 'runtime/darwin/arm64/integrity.json'
    await mkdir(path.join(root, 'runtime', 'darwin', 'arm64'), { recursive: true })
    const catalogContents = `${JSON.stringify({
      version: '0.13.1',
      tools: [
        {
          name: 'check_permissions',
          description: 'Check native permissions.',
          input_schema: { type: 'object', properties: {}, required: [] },
          read_only: false,
          destructive: false,
          idempotent: true
        }
      ]
    })}\n`
    await writeFile(path.join(root, catalogRelativePath), catalogContents)
    const presenter = await createPluginService('darwin', { arch: 'arm64' })
    const { CuaEmbeddedRuntimeAdapter } = await import('@/plugin/cuaEmbeddedAdapter')
    const { CuaRuntimeIntegrityVerifier } = await import('@/plugin/cuaRuntimeIntegrity')
    const manifest = {
      id: 'com.deepchat.plugins.cua',
      runtime: {
        id: 'cua-driver',
        adapter: 'cua-embedded-v1',
        integrityDescriptor: integrityRelativePath,
        detect: [
          'app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
          'plugin:runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver'
        ],
        adapterContract: {
          hostBundleId: 'com.wefonk.deepchat',
          driverVersion: '0.13.1',
          contractVersion: '0.2.0',
          toolsListSchemaVersion: '1',
          capabilityVersion: '1',
          mcpProtocolVersion: '2025-06-18'
        }
      },
      mcpServers: [
        {
          id: 'cua-driver',
          displayName: 'CUA Driver',
          transport: 'stdio',
          command: '${runtime.cua-driver.command}',
          args: ['mcp', '--embedded'],
          autoApprove: [],
          startMode: 'onDemand',
          surfaces: ['tools'],
          toolCatalog: catalogRelativePath,
          inheritEnv: 'minimal'
        }
      ]
    }

    await (presenter as any).registerMcpServers(
      {
        manifest,
        root,
        sourcePath: root,
        sourceType: 'directory',
        integrityDescriptor: {
          schemaVersion: 1,
          pluginId: 'com.deepchat.plugins.cua',
          runtimeId: 'cua-driver',
          runtimeVersion: '0.13.1',
          target: 'darwin/arm64',
          runtimeRoot: 'runtime/darwin/arm64',
          binaryPath: 'DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
          catalogPath: 'tool-catalog.json',
          files: {
            'DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver': 'a'.repeat(64),
            'tool-catalog.json': createHash('sha256').update(catalogContents).digest('hex')
          },
          executablePaths: ['DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver'],
          macos: {
            bundlePath: 'DeepChat Computer Use.app',
            bundleIdentifier: 'com.deepchat.computeruse.helper',
            signatureType: 'ad-hoc',
            teamId: null,
            hardenedRuntime: true,
            entitlements: {
              'com.apple.security.automation.apple-events': true,
              'com.apple.security.device.screen-capture': true
            }
          }
        }
      },
      {
        runtimeId: 'cua-driver',
        displayName: 'CUA Driver',
        state: 'available',
        command: '/plugin/cua-driver'
      }
    )

    expect(presenter.__mocks.runtimeSupervisor.registerServer).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'com.deepchat.plugins.cua',
        serverName: 'cua-driver',
        adapter: expect.any(CuaEmbeddedRuntimeAdapter),
        launchGuard: expect.any(CuaRuntimeIntegrityVerifier)
      }),
      { ready: false }
    )
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

    const presenter = await createPluginService('darwin', fixture.appPath)
    const { getPluginToolPolicy } = await import('@/plugin/toolPolicyStore')

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

    const servers = await presenter.__mocks.mcpSettings.getMcpServers()

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
    const presenter = await createPluginService('darwin', {
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
    const windowSource = await readFile('src/main/desktop/pluginSettingsWindow.ts', 'utf8')
    const viteConfigSource = await readFile('electron.vite.config.ts', 'utf8')

    expect(viteConfigSource).toContain('pluginSettings: resolve')
    expect(windowSource).toContain('../preload/pluginSettings.mjs')
    expect(windowSource).not.toContain('../preload/plugin-settings-preload.mjs')
  })

  it('keeps upstream-compatible permission args for direct legacy runtimes', async () => {
    const presenterSource = await readFile('src/main/plugin/index.ts', 'utf8')
    const presenter = await createPluginService('darwin')

    expect((presenter as any).runtimePermissionToolArgs()).toEqual([
      'check_permissions',
      '{"prompt":false}'
    ])
    expect(presenterSource).not.toContain('deepchat-permission-probe')
    expect(presenterSource).not.toContain('Runtime permission probe failed')
  })

  it('discovers the embedded CUA runtime without executing it', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-discovery-'))
    tempRoots.push(pluginRoot)
    const markerPath = path.join(pluginRoot, 'executed.txt')
    const commandName = process.platform === 'win32' ? 'cua-driver.cmd' : 'cua-driver'
    const commandPath = path.join(pluginRoot, commandName)
    const commandContents =
      process.platform === 'win32'
        ? `@echo off\r\n> "${markerPath}" echo executed\r\necho cua-driver 0.13.1\r\n`
        : `#!/bin/sh\nprintf executed > '${markerPath}'\nprintf 'cua-driver 0.13.1\\n'\n`
    await writeFile(commandPath, commandContents)
    if (process.platform !== 'win32') {
      await chmod(commandPath, 0o755)
    }
    const presenter = await createPluginService(process.platform)

    const status = await (presenter as any).detectRuntime(
      {
        id: 'cua-driver',
        displayName: 'CUA Driver',
        type: 'external-helper',
        detect: [`plugin:${commandName}`],
        adapter: 'cua-embedded-v1',
        adapterContract: {
          hostBundleId: 'com.wefonk.deepchat',
          driverVersion: '0.13.1',
          contractVersion: '1',
          toolsListSchemaVersion: '1',
          capabilityVersion: '1',
          mcpProtocolVersion: '2024-11-05'
        }
      },
      pluginRoot
    )

    expect(status).toMatchObject({
      state: 'installed',
      command: commandPath,
      version: '0.13.1'
    })
    expect(fs.existsSync(markerPath)).toBe(false)
  })

  it('fails closed when only a legacy CUA lifecycle is available', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-legacy-cua-'))
    tempRoots.push(root)
    const resourcesPath = path.join(root, 'resources')
    await createBundledFixture({
      appPath: path.join(root, 'app'),
      packageRoot: path.join(resourcesPath, 'plugins'),
      pluginId: 'com.deepchat.plugins.cua',
      name: 'Legacy CUA'
    })
    const presenter = await createPluginService('darwin', {
      appPath: path.join(root, 'app'),
      isPackaged: true,
      resourcesPath
    })

    const result = await presenter.enablePlugin('com.deepchat.plugins.cua')

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('unsupported legacy lifecycle')
    })
    expect(presenter.__mocks.runtimeSupervisor.registerServer).not.toHaveBeenCalled()
  })

  it('checks CUA permissions through the supervised embedded runtime', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-permission-test-'))
    tempRoots.push(root)
    const userDataPath = path.join(root, 'userData')
    await mkdir(userDataPath, { recursive: true })
    vi.mocked(app.getPath).mockImplementation((name: string) =>
      name === 'userData' ? userDataPath : path.join(root, name)
    )
    const presenter = await createPluginService('darwin')
    await presenter.listPlugins()
    const directCheck = vi.spyOn(presenter as any, 'runRuntimePermissionTool')
    ;(presenter as any).refreshRuntime = vi.fn().mockResolvedValue({
      runtimeId: 'cua-driver',
      displayName: 'CUA Driver',
      state: 'installed',
      command: '/plugin/cua-driver',
      version: 'cua-driver 0.13.1'
    })
    presenter.__mocks.mcpService.checkPluginRuntimePermissions.mockResolvedValue({
      structuredContent: {
        accessibility: true,
        screen_recording: false,
        source: {
          attribution: 'host',
          embedded: true
        }
      },
      content: []
    })

    const action = await presenter.invokeAction(
      'com.deepchat.plugins.cua',
      'runtime.checkPermissions'
    )

    expect(action).toMatchObject({
      ok: true,
      data: {
        platform: 'darwin',
        accessibility: 'granted',
        screenRecording: 'missing',
        command: '/plugin/cua-driver'
      }
    })
    expect(presenter.__mocks.mcpService.checkPluginRuntimePermissions).toHaveBeenCalledWith(
      'cua-driver'
    )
    expect(directCheck).not.toHaveBeenCalled()

    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
    vi.mocked(shell.openPath).mockResolvedValue('')
    const guide = await presenter.invokeAction(
      'com.deepchat.plugins.cua',
      'runtime.openPermissionGuide'
    )
    expect(guide).toMatchObject({ ok: true })
    expect(shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('keeps helper-app permission guidance for non-adapter macOS runtimes', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginService('darwin', fixture.appPath)
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
    const presenter = await createPluginService('darwin', fixture.appPath)
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
    const presenter = await createPluginService('win32')

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
    const presenter = await createPluginService('darwin')

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

  it('resolves packaged macOS CUA helpers from the managed app bundle', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-managed-helper-'))
    tempRoots.push(root)
    const resourcesPath = path.join(root, 'DeepChat.app', 'Contents', 'Resources')
    const presenter = await createPluginService('darwin', {
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
    const presenter = await createPluginService('win32', {
      isPackaged: true,
      resourcesPath: path.join('C:', 'DeepChat', 'resources')
    })

    const command = (presenter as any).resolveRuntimeCandidate(
      'app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
      path.join('C:', 'plugin')
    )

    expect(command).toBeNull()
  })

  it('reconciles eager plugin servers independently of the global MCP switch', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginService('darwin', {
      appPath: fixture.appPath,
      mcpEnabled: false
    })

    const result = await presenter.enablePlugin(fixture.pluginId)

    expect(result.ok).toBe(true)
    expect(presenter.__mocks.runtimeSupervisor.reconcilePlugin).toHaveBeenCalledWith(
      fixture.pluginId
    )
    expect(presenter.__mocks.mcpService.startServer).not.toHaveBeenCalled()
  })

  it('routes runtime test and retry actions through the supervisor without changing intent', async () => {
    const fixture = await createBundledFixture({ startMode: 'onDemand' })
    const presenter = await createPluginService('darwin', fixture.appPath)
    const enabled = await presenter.enablePlugin(fixture.pluginId)
    expect(enabled.ok, enabled.error).toBe(true)

    const tested = await presenter.invokeAction(fixture.pluginId, 'runtime.test')
    const retried = await presenter.invokeAction(fixture.pluginId, 'runtime.retry')

    expect(tested.ok).toBe(true)
    expect(retried.ok).toBe(true)
    expect(presenter.__mocks.runtimeSupervisor.testRuntime).toHaveBeenCalledWith(
      fixture.pluginId,
      'fixture-runtime'
    )
    expect(presenter.__mocks.runtimeSupervisor.retryRuntime).toHaveBeenCalledWith(
      fixture.pluginId,
      'fixture-runtime'
    )
    expect((await presenter.getPlugin(fixture.pluginId))?.enabled).toBe(true)
  })

  it('reports integrity blocks independently from quarantine lifecycle state', async () => {
    const fixture = await createBundledFixture({ startMode: 'onDemand' })
    const presenter = await createPluginService('darwin', fixture.appPath)
    const enabled = await presenter.enablePlugin(fixture.pluginId)
    expect(enabled.ok, enabled.error).toBe(true)
    presenter.__mocks.runtimeSupervisor.getState.mockReturnValue({
      state: 'quarantined',
      integrityError: 'runtime integrity mismatch',
      quarantine: {
        schemaVersion: 1,
        attemptId: '00000000-0000-4000-8000-000000000001',
        pluginId: fixture.pluginId,
        runtimeId: 'fixture-runtime',
        serverName: 'fixture-runtime',
        fingerprint: {
          value: 'a'.repeat(64),
          pluginId: fixture.pluginId,
          runtimeId: 'fixture-runtime',
          target: 'darwin/arm64',
          binarySha256: 'b'.repeat(64)
        },
        recordedAt: 123
      }
    })

    await expect(presenter.getPlugin(fixture.pluginId)).resolves.toMatchObject({
      mcpServers: [
        {
          serverId: 'fixture-runtime',
          lifecycleState: 'quarantined',
          quarantinedAt: 123,
          integrityError: 'runtime integrity mismatch'
        }
      ]
    })
  })

  it('keeps enabled intent when an eager runtime start fails', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginService('darwin', {
      appPath: fixture.appPath,
      mcpEnabled: false
    })
    presenter.__mocks.runtimeSupervisor.reconcilePlugin.mockRejectedValueOnce(
      new Error('runtime failed')
    )

    const result = await presenter.enablePlugin(fixture.pluginId)

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect((await presenter.getPlugin(fixture.pluginId))?.enabled).toBe(true)
  })

  it('applies the legacy CUA ownership migration safely and only once', async () => {
    const presenter = await createPluginService('darwin')
    presenter.__mocks.mcpServers['cua-driver'] = {
      type: 'stdio',
      command: '/fixture/cua-driver',
      args: ['mcp', '--no-daemon-relaunch'],
      env: {
        CUA_DRIVER_MCP_MODE: '1',
        CUA_DRIVER_RS_MCP_NO_RELAUNCH: '1'
      },
      enabled: true,
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.cua',
      ownerPluginId: 'com.deepchat.plugins.cua'
    }

    await presenter.initialize()
    await presenter.initialize()

    expect(presenter.__mocks.mcpSettings.removeMcpServer).toHaveBeenCalledOnce()
    expect(presenter.__mocks.mcpSettings.removeMcpServer).toHaveBeenCalledWith('cua-driver')
    expect(presenter.__mocks.mcpServers).not.toHaveProperty('cua-driver')
  })

  it('preserves an explicit legacy CUA disable in installation intent before cleanup', async () => {
    const presenter = await createPluginService('darwin')
    const { getPluginToolPolicy, registerPluginToolPolicy } =
      await import('@/plugin/toolPolicyStore')
    const now = Date.now()
    ;(presenter as any).store.set('installations', [
      {
        pluginId: 'com.deepchat.plugins.cua',
        version: '1.0.4-beta.3',
        path: '/fixture/legacy-cua',
        enabled: true,
        trusted: true,
        source: 'deepchat-official',
        installedAt: now,
        updatedAt: now
      }
    ])
    presenter.__mocks.mcpServers['cua-driver'] = {
      type: 'stdio',
      command: '/fixture/cua-driver',
      args: ['mcp', '--no-daemon-relaunch'],
      env: { CUA_DRIVER_MCP_MODE: '1' },
      enabled: false,
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.cua',
      ownerPluginId: 'com.deepchat.plugins.cua'
    }
    registerPluginToolPolicy({
      pluginId: 'com.deepchat.plugins.cua',
      serverId: 'cua-driver',
      tools: { click: 'ask' },
      enabled: true
    })

    await (presenter as any).applyRuntimeMigrations()

    expect((presenter as any).store.get('installations')[0]).toMatchObject({
      pluginId: 'com.deepchat.plugins.cua',
      enabled: false
    })
    expect(presenter.__mocks.mcpSettings.removeMcpServer).toHaveBeenCalledWith('cua-driver')
    expect(getPluginToolPolicy('cua-driver', 'click')).toBeNull()
  })

  it('does not reinterpret the supervised CUA record as a legacy disable signal', async () => {
    const presenter = await createPluginService('darwin')
    const now = Date.now()
    ;(presenter as any).store.set('installations', [
      {
        pluginId: 'com.deepchat.plugins.cua',
        version: '1.1.0',
        path: '/fixture/current-cua',
        enabled: true,
        trusted: true,
        source: 'deepchat-official',
        installedAt: now,
        updatedAt: now
      }
    ])
    presenter.__mocks.mcpServers['cua-driver'] = {
      type: 'stdio',
      command: '/fixture/cua-driver',
      args: ['mcp', '--embedded'],
      enabled: false,
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.cua',
      ownerPluginId: 'com.deepchat.plugins.cua'
    }

    await (presenter as any).applyRuntimeMigrations()

    expect((presenter as any).store.get('installations')[0]).toMatchObject({ enabled: true })
    expect(presenter.__mocks.mcpSettings.removeMcpServer).not.toHaveBeenCalled()
  })

  it('retries a failed legacy migration without blocking unrelated plugins', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginService('darwin', {
      appPath: fixture.appPath,
      arch: 'x64'
    })
    expect((await presenter.enablePlugin(fixture.pluginId)).ok).toBe(true)
    const now = Date.now()
    ;(presenter as any).store.set('installations', [
      ...(presenter as any).store.get('installations'),
      {
        pluginId: 'com.deepchat.plugins.cua',
        version: '1.0.4-beta.3',
        path: '/fixture/legacy-cua',
        enabled: true,
        trusted: true,
        source: 'deepchat-official',
        installedAt: now,
        updatedAt: now
      }
    ])
    vi.clearAllMocks()
    const activatePluginImplementation = (presenter as any).activatePlugin.bind(presenter)
    const activatePlugin = vi
      .spyOn(presenter as any, 'activatePlugin')
      .mockImplementation(async (pluginId: string) => {
        if (pluginId === 'com.deepchat.plugins.cua') {
          return
        }
        await activatePluginImplementation(pluginId)
      })
    presenter.__mocks.mcpServers['cua-driver'] = {
      type: 'stdio',
      command: '/fixture/cua-driver',
      args: ['mcp', '--no-daemon-relaunch'],
      env: { CUA_DRIVER_MCP_MODE: '1' },
      enabled: true,
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.cua',
      ownerPluginId: 'com.deepchat.plugins.cua'
    }
    presenter.__mocks.mcpSettings.removeMcpServer.mockRejectedValueOnce(
      new Error('database unavailable')
    )

    await presenter.initialize()
    expect(presenter.__mocks.runtimeSupervisor.reconcilePlugin).toHaveBeenCalledWith(
      fixture.pluginId
    )
    expect(activatePlugin).toHaveBeenCalledWith(fixture.pluginId)
    expect(activatePlugin).not.toHaveBeenCalledWith('com.deepchat.plugins.cua')
    await presenter.initialize()

    expect(
      presenter.__mocks.mcpSettings.removeMcpServer.mock.calls.filter(
        ([serverName]) => serverName === 'cua-driver'
      )
    ).toHaveLength(2)
    expect(activatePlugin).toHaveBeenCalledWith('com.deepchat.plugins.cua')
    expect(presenter.__mocks.mcpServers['cua-driver']).toBeUndefined()
    expect((presenter as any).store.get('migrations')).toMatchObject({
      'cua-runtime-ownership': 2
    })
  })

  it('persists runtime safety sentinels in the plugin settings store', async () => {
    const presenter = await createPluginService('linux', { arch: 'x64' })
    const safetyStore = presenter.__mocks.runtimeSupervisor.attachSafetyStore.mock.calls[0][0]
    const sentinel = {
      schemaVersion: 1,
      attemptId: '00000000-0000-4000-8000-000000000001',
      pluginId: 'com.deepchat.plugins.cua',
      runtimeId: 'cua-driver',
      serverName: 'cua-driver',
      fingerprint: {
        value: 'a'.repeat(64),
        pluginId: 'com.deepchat.plugins.cua',
        runtimeId: 'cua-driver',
        target: 'linux/x64',
        binarySha256: 'b'.repeat(64)
      },
      recordedAt: Date.now()
    }

    safetyStore.write('cua-key', sentinel)

    expect(safetyStore.read('cua-key')).toEqual(sentinel)
    expect(safetyStore.read('cua-key')).not.toBe(sentinel)
    safetyStore.remove('cua-key')
    expect(safetyStore.read('cua-key')).toBeUndefined()
  })

  it('rejects malformed and duplicate lifecycle declarations before registration', async () => {
    const presenter = await createPluginService('darwin')
    const baseManifest = {
      id: 'com.deepchat.plugins.invalid',
      mcpServers: [
        {
          id: 'duplicate',
          startMode: 'eager',
          surfaces: ['tools']
        }
      ]
    }

    expect(() =>
      (presenter as any).assertManifestLifecycleContract({
        ...baseManifest,
        mcpServers: [{ ...baseManifest.mcpServers[0], surfaces: 'tools' }]
      })
    ).toThrow('invalid surfaces')
    expect(() =>
      (presenter as any).assertManifestLifecycleContract({
        ...baseManifest,
        mcpServers: [...baseManifest.mcpServers, { ...baseManifest.mcpServers[0] }]
      })
    ).toThrow('duplicate MCP server id')
    expect(() =>
      (presenter as any).assertManifestLifecycleContract({
        ...baseManifest,
        mcpServers: [
          {
            ...baseManifest.mcpServers[0],
            startMode: 'onDemand',
            surfaces: ['tools']
          }
        ]
      })
    ).toThrow('must declare surfaces ["tools"] and a toolCatalog')
    expect(() =>
      (presenter as any).assertManifestLifecycleContract({
        ...baseManifest,
        mcpServers: [{ ...baseManifest.mcpServers[0], id: ' duplicate ' }]
      })
    ).toThrow('invalid id')
  })

  it('leaves process shutdown to MCP service without removing saved config', async () => {
    const presenter = await createPluginService('darwin')
    await presenter.__mocks.mcpSettings.addMcpServer('regular-server', {
      source: 'manual'
    })
    await presenter.__mocks.mcpSettings.addMcpServer('plugin-running', {
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.fixture',
      ownerPluginId: 'com.deepchat.plugins.fixture'
    })
    await presenter.__mocks.mcpSettings.addMcpServer('plugin-stopped', {
      source: 'plugin',
      sourceId: 'com.deepchat.plugins.other',
      ownerPluginId: 'com.deepchat.plugins.other'
    })
    await presenter.shutdown()

    expect(presenter.__mocks.runtimeSupervisor.shutdown).not.toHaveBeenCalled()
    expect(presenter.__mocks.mcpSettings.removeMcpServer).not.toHaveBeenCalled()
    expect(await presenter.__mocks.mcpSettings.getMcpServers()).toMatchObject({
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
    expect(manifest.runtime.adapter).toBe('cua-embedded-v1')
    expect(manifest.runtime.integrityDescriptor).toBe(
      'runtime/${target.platform}/${arch}/integrity.json'
    )
    expect(manifest.runtime.adapterContract).toEqual({
      hostBundleId: 'com.wefonk.deepchat',
      driverVersion: '0.13.1',
      contractVersion: '0.2.0',
      toolsListSchemaVersion: '1',
      capabilityVersion: '1',
      mcpProtocolVersion: '2025-06-18'
    })
    expect(server.args).toEqual(['mcp', '--embedded'])
    expect(server.env).toBeUndefined()
    expect(mcpConfig.env).toBeUndefined()
    expect(server).toMatchObject({
      startMode: 'onDemand',
      surfaces: ['tools'],
      toolCatalog: 'runtime/${target.platform}/${arch}/tool-catalog.json',
      inheritEnv: 'minimal'
    })
    expect(mcpConfig).toEqual(
      expect.objectContaining({
        args: server.args,
        startMode: server.startMode,
        surfaces: server.surfaces,
        toolCatalog: server.toolCatalog,
        inheritEnv: server.inheritEnv
      })
    )
  })

  it('keeps CUA v0.13.1 tool policies explicit and conservative', async () => {
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
      'get_desktop_state',
      'get_cursor_position',
      'get_config',
      'get_recording_state',
      'get_agent_cursor_state',
      'check_for_update',
      'health_report',
      'get_browser_state',
      'get_session_state',
      'start_session',
      'end_session'
    ]
    const EXPECTED_ASK = [
      'launch_app',
      'bring_to_front',
      'click',
      'right_click',
      'double_click',
      'drag',
      'parallel_mouse_drag',
      'scroll',
      'move_cursor',
      'type_text',
      'press_key',
      'hotkey',
      'set_value',
      'set_config',
      'start_recording',
      'stop_recording',
      'install_ffmpeg',
      'set_agent_cursor_enabled',
      'set_agent_cursor_motion',
      'set_agent_cursor_theme',
      'replay_trajectory',
      'zoom',
      'page',
      'browser_prepare',
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_dialog',
      'browser_set_input_files',
      'browser_download',
      'browser_pointer',
      'escalate_session'
    ]
    const EXPECTED_DENY = [
      'debug_window_info',
      'kill_app',
      'mouse_button_down',
      'mouse_button_up',
      'mouse_drag'
    ]

    for (const tool of EXPECTED_ALLOW) {
      expect(manifestTools[tool]).toBe('allow')
      expect(policy.tools[tool]).toBe('allow')
    }
    for (const tool of EXPECTED_ASK) {
      expect(manifestTools[tool]).toBe('ask')
      expect(policy.tools[tool]).toBe('ask')
    }
    for (const tool of EXPECTED_DENY) {
      expect(manifestTools[tool]).toBe('deny')
      expect(policy.tools[tool]).toBe('deny')
    }

    expect(manifestTools.kill_app).toBe('deny')
    expect(policy.tools.kill_app).toBe('deny')
    expect(manifestTools.set_agent_cursor_style).toBeUndefined()
    expect(policy.tools.set_agent_cursor_style).toBeUndefined()
    expect(manifestTools.screenshot).toBeUndefined()
    expect(manifestTools.set_recording).toBeUndefined()
    expect(manifestTools.type_text_chars).toBeUndefined()
    expect(policy.tools.screenshot).toBeUndefined()
    expect(policy.tools.set_recording).toBeUndefined()
    expect(policy.tools.type_text_chars).toBeUndefined()
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
      tag: 'cua-driver-rs-v0.13.1',
      commit: 'd8c1efac808333bbecfcb2a9ff6705b5b1e6195a',
      version: '0.13.1',
      checksumsSha256: '9dc81da0fda626ca79ed603ebe0d9913c291d89ab348bedbaefd2adb24547ed8',
      supportedTargets: ['darwin/arm64', 'darwin/x64', 'win32/x64', 'win32/arm64', 'linux/x64'],
      unsupportedTargets: ['linux/arm64']
    })
    expect(metadata.assets).toEqual({
      'darwin-arm64': {
        name: 'cua-driver-rs-0.13.1-darwin-arm64.tar.gz',
        sha256: '17e09bd109bfb0d99b5bf9b0b75575e8f797ff30cb13be17988b2709b09d1ee5'
      },
      'darwin-x64': {
        name: 'cua-driver-rs-0.13.1-darwin-x86_64.tar.gz',
        sha256: 'f5df0e5600a26a822de872dd8361fc820bd3fde611ab91c1ddc3ddaa2ede1933'
      },
      'windows-x64': {
        name: 'cua-driver-rs-0.13.1-windows-x86_64-binary.zip',
        sha256: '3d30f7cd62300d26f06e2f4136118b11b1bef22a59897d454e479d1f425be46a'
      },
      'windows-arm64': {
        name: 'cua-driver-rs-0.13.1-windows-arm64-binary.zip',
        sha256: '0e15330f9a4461faae64264e9e642c93fa1e5080177c874f0c9136688bde06fa'
      },
      'linux-x64': {
        name: 'cua-driver-rs-0.13.1-linux-x86_64-binary.tar.gz',
        sha256: '0676c727980a1a5ea792d715f576ec12e7c15099493a01af2a74ea64b036303f'
      }
    })
    for (const asset of Object.values(metadata.assets) as Array<{ sha256: string }>) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(buildScript).toContain('verifyChecksum')
    expect(buildScript).toContain('downloadFile')
    expect(buildScript).toContain('isLinuxGlibcLoaderMismatch')
    expect(buildScript).toContain('host glibc loader')
    expect(buildScript).toContain("targetPlatform !== 'darwin'")
    expect(buildScript).toContain('signDarwinHelper(runtimeDir, targetPlatform, packagePurpose)')
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
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))
    const files = ['SKILL.md', 'README.md', 'WEB_APPS.md', 'RECORDING.md', 'TESTS.md']
    const contents = await Promise.all(
      files.map((file) => readFile(`plugins/cua/skills/computer-use/${file}`, 'utf8'))
    )
    const combined = contents.join('\n')

    expect(manifest.skills).toEqual([
      {
        id: 'computer-use',
        path: 'skills/computer-use/SKILL.md',
        scope: 'agent'
      }
    ])
    expect(contents[0]).toContain('name: computer-use')
    expect(contents[0]).toContain('# computer-use')
    expect(combined).toContain('list_apps')
    expect(combined).toContain('launch_app')
    expect(combined).toContain('get_window_state')
    expect(combined).toContain('check_permissions')
    expect(combined).toContain('set_agent_cursor_theme')
    expect(combined).toContain('browser_type({ replace: true, text: "" })')
    expect(combined).toContain('## CUA structured refusal')
    expect(combined).toContain('refusal.code')
    expect(combined).toContain('generation_mismatch')
    expect(combined).toContain('single-session object')
    expect(combined).toContain('do not pass appearance fields')
    expect(combined).toContain('read-only `get_text` or `query_dom`')
    expect(combined).toMatch(/Omit\s+`cursor_theme` during normal session setup/)
    expect(combined).toContain('`cua.default` is the bundled, verified theme')
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
    expect(combined).not.toContain('kill_app')
    expect(combined).not.toContain('undeclared session arguments')
    expect(combined).not.toContain('call the native driver directly')
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
    const windowsPackageWorkflow = await readFile('.github/workflows/_package-windows.yml', 'utf8')
    const linuxPackageWorkflow = await readFile('.github/workflows/_package-linux.yml', 'utf8')
    const macosPackageWorkflow = await readFile('.github/workflows/_package-macos.yml', 'utf8')
    const pluginScript = await readFile('scripts/plugin.mjs', 'utf8')
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
    expect(macosPackageWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform darwin --arch "${TARGET_ARCH}"'
    )
    expect(windowsPackageWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform win32 --arch "${TARGET_ARCH}"'
    )
    expect(linuxPackageWorkflow).toContain(
      'pnpm run plugin:bundle -- --name cua --platform linux --arch ${{ inputs.arch }}'
    )
    for (const [workflow, platform] of [
      [macosPackageWorkflow, 'darwin'],
      [windowsPackageWorkflow, 'win32'],
      [linuxPackageWorkflow, 'linux']
    ]) {
      expect(workflow).toContain(
        `pnpm run installRuntime:duckdb:vss -- --platform ${platform} --arch`
      )
      expect(workflow).toContain(`pnpm run smoke:duckdb:vss -- --platform ${platform} --arch`)
      expect(workflow).toContain('Verify packaged DuckDB VSS')
    }
    expect(macosPackageWorkflow).toContain('macos-15-intel')
    expect(macosPackageWorkflow).toContain('macos-15')
    expect(windowsPackageWorkflow).toContain(
      'dist/${UNPACKED_DIRECTORY}/resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension'
    )
    expect(linuxPackageWorkflow).toContain(
      'dist/${UNPACKED_DIRECTORY}/resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension'
    )
    expect(macosPackageWorkflow).toContain(
      '${APP_DIRECTORY}/Contents/Resources/app.asar.unpacked/runtime/duckdb/extensions/vss.duckdb_extension.b64'
    )
    expect(macosPackageWorkflow).toContain(
      'pnpm run smoke:duckdb:vss -- --platform darwin --arch "${TARGET_ARCH}" --extension-base64-path "${extension_path}"'
    )
    expect(windowsPackageWorkflow).toContain(
      '- name: Build and package Windows\n        shell: bash'
    )
    expect(windowsPackageWorkflow).toContain('Verify bundled plugins')
    expect(macosPackageWorkflow).toContain('Contents/Resources/app.asar.unpacked/plugins')
    expect(packageScript).toContain("parts[0] === 'runtime'")
    expect(packageScript).toContain('parts[1] !== args.targetPlatform')
    expect(packageScript).toContain('parts[2] !== args.targetArch')
    expect(packageScript).toContain('CUA plugin does not support')
    expect(packageScript).toContain('CUA_DARWIN_MANAGED_HELPER_DETECT')
    expect(pluginScript).toContain("pkgArgs.push('--purpose', args.purpose)")
    expect(guide).toContain('build/bundled-plugins/')
    expect(guide).toContain('build/managed-helpers/')
    expect(guide).toContain('Contents/Helpers/DeepChat Computer Use.app')
    expect(guide).toContain('app.asar.unpacked/plugins/')
    expect(guide).toContain('win32/arm64')
    expect(guide).toContain('linux/arm64')
  })
})
