import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
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

const createPluginPresenter = async (platform: NodeJS.Platform, appPath = process.cwd()) => {
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
    getMcpEnabled: vi.fn().mockResolvedValue(true)
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
  return new PluginPresenter({
    platform,
    appPath,
    configPresenter,
    mcpPresenter,
    skillPresenter
  } as any)
}

const createBundledFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-test-'))
  tempRoots.push(root)
  const appPath = path.join(root, 'app')
  const userDataPath = path.join(root, 'userData')
  const packageRoot = path.join(appPath, 'plugins')
  const packagePath = path.join(packageRoot, 'deepchat-plugin-fixture-0.2.3-darwin-x64.dcplugin')
  const runtimeRelativePath = `runtime/darwin/${process.arch}/fixture-runtime`
  const manifest = {
    id: 'com.deepchat.plugins.fixture',
    name: 'Fixture Runtime',
    version: '0.2.3',
    publisher: 'DeepChat',
    engines: {
      deepchat: '>=0.2.3',
      platforms: ['darwin']
    },
    activationEvents: ['onEnable'],
    capabilities: ['runtime.manage', 'mcp.register'],
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
    ]
  }
  const files: Record<string, Uint8Array> = {
    'plugin.json': new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    [runtimeRelativePath]: new TextEncoder().encode('#!/bin/sh\necho fixture-runtime 1.0.0\n')
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
    pluginId: manifest.id
  }
}

describe('PluginPresenter', () => {
  afterEach(async () => {
    vi.mocked(app.getPath).mockImplementation(() => '/mock/path')
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('hides the CUA official plugin on unsupported platforms', async () => {
    const winPresenter = await createPluginPresenter('win32')
    const linuxPresenter = await createPluginPresenter('linux')
    const manifest = JSON.parse(await readFile('plugins/cua/plugin.json', 'utf8'))

    expect(manifest.engines.platforms).toEqual(['darwin'])
    expect(await winPresenter.listPlugins()).toEqual([])
    expect(await linuxPresenter.listPlugins()).toEqual([])
  })

  it('lists bundled official plugins as installed and enables them by materializing the package', async () => {
    const fixture = await createBundledFixture()
    const presenter = await createPluginPresenter('darwin', fixture.appPath)

    const plugins = await presenter.listPlugins()
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({
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
    expect(presenterSource).toContain('this.configPresenter.getMcpEnabled()')
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
    expect(combined).toContain('DeepChat Computer Use.app')
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
