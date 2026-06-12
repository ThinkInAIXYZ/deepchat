import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
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
  const runtimeRelativePath = `runtime/darwin/${process.arch}/fixture-runtime`
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
      detect: [`plugin:${runtimeRelativePath}`]
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
    [runtimeRelativePath]: new TextEncoder().encode('#!/bin/sh\necho fixture-runtime 1.0.0\n')
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

  it('hides the CUA official plugin on unsupported platforms', async () => {
    const winPresenter = await createPluginPresenter('win32')
    const linuxPresenter = await createPluginPresenter('linux')
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))

    expect(manifest.engines.platforms).toEqual(['darwin'])
    expect((await winPresenter.listPlugins()).map((plugin) => plugin.id)).not.toContain(
      'com.deepchat.plugins.cua'
    )
    expect((await linuxPresenter.listPlugins()).map((plugin) => plugin.id)).not.toContain(
      'com.deepchat.plugins.cua'
    )
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
        version: 'fixture-runtime 1.0.0'
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
      args: [path.join(fixture.installedRoot, 'mcp', 'serve.mjs')],
      source: 'plugin',
      sourceId: fixture.pluginId,
      enabled: true
    })
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

  it('uses the CUA permission probe for runtime checks', async () => {
    const presenterSource = await readFile('src/main/presenter/pluginPresenter/index.ts', 'utf8')

    expect(presenterSource).toContain('deepchat-permission-probe')
    expect(presenterSource).toContain('Runtime permission probe failed')
  })

  it('resolves CUA helper paths, MCP env, and runtime auto-start hooks', async () => {
    const presenterSource = await readFile('src/main/presenter/pluginPresenter/index.ts', 'utf8')

    expect(presenterSource).toContain('helperAppPath')
    expect(presenterSource).toContain('resolveHelperAppPath')
    expect(presenterSource).toContain('resolvePluginTemplateRecord')
    expect(presenterSource).toContain('startPluginMcpServersIfReady')
    expect(presenterSource).toContain('this.mcpPresenter.startServer(serverName)')
    expect(presenterSource).not.toContain('if (!(await this.configPresenter.getMcpEnabled()))')
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

  it('declares the CUA MCP server with plugin helper context', async () => {
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))
    const mcpConfig = JSON.parse(await readFile('plugins/cua/mcp/cua-driver.json', 'utf8'))
    const server = manifest.mcpServers.find((item: { id: string }) => item.id === 'cua-driver')

    expect(manifest.runtime.detect[0]).toBe(
      'plugin:runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/cua-driver'
    )
    expect(manifest.runtime.detect).toEqual([
      'plugin:runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/cua-driver',
      '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
    ])
    expect(server.env).toEqual({
      CUA_DRIVER_MCP_MODE: '1',
      DEEPCHAT_COMPUTER_USE_APP_PATH: '${runtime.cua-driver.helperAppPath}',
      DEEPCHAT_COMPUTER_USE_BINARY_PATH: '${runtime.cua-driver.command}'
    })
    expect(mcpConfig.env).toEqual(server.env)
  })

  it('keeps new CUA cursor style controls permission-gated', async () => {
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))
    const policy = JSON.parse(await readFile('plugins/cua/policies/tool-policy.json', 'utf8'))
    const registrySource = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/ToolRegistry.swift',
      'utf8'
    )
    const styleToolSource = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/Tools/SetAgentCursorStyleTool.swift',
      'utf8'
    )
    const manifestTools = manifest.toolPolicies.find(
      (item: { serverId: string }) => item.serverId === 'cua-driver'
    ).tools

    expect(styleToolSource).toContain('name: "set_agent_cursor_style"')
    expect(registrySource).toContain('SetAgentCursorStyleTool.handler')
    expect(manifestTools.set_agent_cursor_style).toBe('ask')
    expect(policy.tools.set_agent_cursor_style).toBe('ask')
  })

  it('tracks CUA vendor source as a DeepChat-owned fork', async () => {
    const metadata = JSON.parse(
      await readFile('plugins/cua/vendor/cua-driver/upstream.json', 'utf8')
    )
    const buildScript = await readFile('scripts/build-cua-plugin-runtime.mjs', 'utf8')

    expect(metadata).toMatchObject({
      sourceKind: 'deepchat-owned-fork',
      upstreamRepo: 'https://github.com/trycua/cua.git',
      upstreamSubdir: 'libs/cua-driver'
    })
    expect(metadata.forkPolicy).toContain('Cherry-pick upstream fixes')
    expect(metadata.lastCherryPick).toMatchObject({
      sourceTag: metadata.tag,
      sourceCommit: metadata.commit
    })
    expect(buildScript).toContain('vendorSourceDir')
    expect(buildScript).toContain('sourceKind')
    expect(buildScript).toContain('deepchat-owned-fork')
    expect(buildScript).toContain('--package-path')
    expect(buildScript).toContain('vendorSourceDir')
  })

  it('keeps CUA updates managed by DeepChat instead of upstream release checks', async () => {
    const commandSource = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverCLI/CuaDriverCommand.swift',
      'utf8'
    )

    expect(commandSource).toContain('DeepChat packages this cua-driver fork with the app.')
    expect(commandSource).toContain('Update DeepChat to receive newer Computer Use helper builds.')
    expect(commandSource).not.toContain('VersionCheck.fetchLatest')
    expect(commandSource).not.toContain('Could not reach GitHub')
    expect(commandSource).not.toContain('Checking for updates')
  })

  it('keeps CUA default pixel clicks on the upstream auth-signed path', async () => {
    const mouseInput = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverCore/Input/MouseInput.swift',
      'utf8'
    )

    expect(mouseInput).toContain('try clickViaAuthSignedPost(')
    expect(mouseInput).toContain('private static func clickViaAuthSignedPost')
    expect(mouseInput).not.toContain('clickViaBackgroundPidPost')
  })

  it('scopes CUA zoom contexts to pid and window_id', async () => {
    const registrySource = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/Tools/ImageResizeRegistry.swift',
      'utf8'
    )
    const zoomTool = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/Tools/ZoomTool.swift',
      'utf8'
    )
    const clickTool = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/Tools/ClickTool.swift',
      'utf8'
    )
    const dragTool = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/Tools/DragTool.swift',
      'utf8'
    )
    const stateTool = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/Tools/GetWindowStateTool.swift',
      'utf8'
    )

    expect(registrySource).toContain('public struct ImageContextKey')
    expect(registrySource).toContain('private var ratios: [ImageContextKey: Double]')
    expect(registrySource).toContain('private var zooms: [ImageContextKey: ZoomContext]')
    expect(zoomTool).toContain('"window_id"')
    expect(zoomTool).toContain('capture.captureWindow')
    expect(zoomTool).toContain('windowId: windowId')
    expect(stateTool).toContain('setRatio(')
    expect(stateTool).toContain('windowId: windowId')
    for (const source of [clickTool, dragTool]) {
      expect(source).toContain('from_zoom=true but no zoom context for pid')
      expect(source).toContain('Call `zoom` with the same pid and window_id first.')
      expect(source).toContain('windowId: windowId')
    }
  })

  it('keeps Electron AX enablement internal instead of adding a public tool', async () => {
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))
    const policy = JSON.parse(await readFile('plugins/cua/policies/tool-policy.json', 'utf8'))
    const registrySource = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/ToolRegistry.swift',
      'utf8'
    )
    const stateSource = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverCore/AppState/AppState.swift',
      'utf8'
    )
    const enablementSource = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverCore/Focus/AXEnablementAssertion.swift',
      'utf8'
    )
    const manifestTools = manifest.toolPolicies.find(
      (item: { serverId: string }) => item.serverId === 'cua-driver'
    ).tools

    expect(registrySource).not.toContain('SetElectronAccessibilityTool')
    expect(manifestTools.set_electron_accessibility).toBeUndefined()
    expect(policy.tools.set_electron_accessibility).toBeUndefined()
    expect(stateSource).toContain('activateAccessibilityIfNeeded')
    expect(enablementSource).toContain('AXManualAccessibility')
    expect(enablementSource).toContain('AXEnhancedUserInterface')
  })

  it('keeps the CUA skill instructions MCP-only', async () => {
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
    expect(combined).toContain('AXManualAccessibility')
    expect(combined).toContain('electron_debugging_port: 9222')
    expect(combined).toContain('screenshot({ window_id })')
    expect(combined).toContain('zoom({ pid, window_id')
    expect(combined).toContain('Repeated zoom calls are a failure signal')
    expect(combined).not.toContain('Bash')
    expect(combined).not.toContain('cua-driver <tool')
    expect(combined).not.toContain('PATH')
    expect(combined).not.toMatch(/\bserve\b/)
    expect(combined).not.toContain('open -n -g -a')
    expect(combined).not.toContain('daemon')
  })

  it('uses MCP-mode cache guidance in the CUA driver vendor source', async () => {
    const clickTool = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/Tools/ClickTool.swift',
      'utf8'
    )
    const rightClickTool = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverServer/Tools/RightClickTool.swift',
      'utf8'
    )

    for (const source of [clickTool, rightClickTool]) {
      expect(source).toContain('CUA_DRIVER_MCP_MODE')
      expect(source).toContain('Call get_window_state with the same pid and window_id')
    }
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

  it('skips install telemetry in the bundled CUA CLI entrypoint', async () => {
    const source = await readFile(
      'plugins/cua/vendor/cua-driver/source/Sources/CuaDriverCLI/CuaDriverCommand.swift',
      'utf8'
    )

    expect(source).not.toContain('recordInstallation()')
    expect(source).toContain('telemetryEntryEvent(for: original)')
    expect(source).toContain('TelemetryClient.shared.record(event: entryEvent)')
  })

  it('wires CUA plugin packaging docs and release gates for both mac architectures', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
    const buildWorkflow = await readFile('.github/workflows/build.yml', 'utf8')
    const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8')
    const packageScript = await readFile('scripts/package-plugin.mjs', 'utf8')
    const guide = await readFile('docs/guides/plugin-packaging.md', 'utf8')

    expect(packageJson.scripts['plugin:cua:package:mac:arm64']).toContain('--target-arch arm64')
    expect(packageJson.scripts['plugin:cua:package:mac:x64']).toContain('--target-arch x64')
    expect(packageJson.scripts['plugin:cua:build:mac:x64']).toContain('--arch x64')
    expect(packageJson.scripts['plugin:cua:bundle:mac:arm64']).toContain('--target-arch arm64')
    expect(packageJson.scripts['plugin:cua:bundle:mac:x64']).toContain('--target-arch x64')
    expect(packageJson.scripts['build:mac:arm64']).toContain('plugin:cua:bundle:mac:arm64')
    expect(buildWorkflow).toContain('pnpm run plugin:cua:bundle:mac:${{ matrix.arch }}')
    expect(buildWorkflow).toContain('Verify bundled CUA plugin')
    expect(buildWorkflow).toContain('Contents/Resources/app.asar.unpacked/plugins')
    expect(releaseWorkflow).toContain('pnpm run plugin:cua:bundle:mac:${{ matrix.arch }}')
    expect(releaseWorkflow).not.toContain('require_cua_plugin_asset')
    expect(releaseWorkflow).not.toContain('cp "${dir}/${asset}" release_assets/')
    expect(packageScript).toContain("parts[0] === 'runtime'")
    expect(packageScript).toContain('parts[2] !== args.targetArch')
    expect(guide).toContain('build/bundled-plugins/')
    expect(guide).toContain('app.asar.unpacked/plugins/')
  })
})
