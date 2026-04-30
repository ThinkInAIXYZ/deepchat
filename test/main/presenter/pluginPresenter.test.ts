import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

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

const createPluginPresenter = async (platform: NodeJS.Platform) => {
  const { PluginPresenter } = await import('@/presenter/pluginPresenter')
  return new PluginPresenter({
    platform,
    appPath: process.cwd(),
    configPresenter: {
      getMcpServers: vi.fn().mockResolvedValue({})
    },
    mcpPresenter: {
      isServerRunning: vi.fn().mockResolvedValue(false)
    },
    skillPresenter: {}
  } as any)
}

describe('PluginPresenter', () => {
  it('hides the CUA official plugin on unsupported platforms', async () => {
    const winPresenter = await createPluginPresenter('win32')
    const linuxPresenter = await createPluginPresenter('linux')
    const catalog = JSON.parse(await readFile('resources/plugins/official-catalog.json', 'utf8'))
    const catalogManifest = catalog.plugins[0].manifest

    expect(catalogManifest.engines.platforms).toEqual(['darwin'])
    expect(await winPresenter.listPlugins()).toEqual([])
    expect(await linuxPresenter.listPlugins()).toEqual([])
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
    const catalog = JSON.parse(await readFile('resources/plugins/official-catalog.json', 'utf8'))
    const mcpConfig = JSON.parse(await readFile('plugins/cua/mcp/cua-driver.json', 'utf8'))
    const catalogManifest = catalog.plugins[0].manifest
    const server = manifest.mcpServers.find((item: { id: string }) => item.id === 'cua-driver')
    const catalogServer = catalogManifest.mcpServers.find(
      (item: { id: string }) => item.id === 'cua-driver'
    )

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
    expect(catalogManifest.runtime.detect[0]).toBe(manifest.runtime.detect[0])
    expect(catalogManifest.runtime.detect).toEqual(manifest.runtime.detect)
    expect(catalogServer.env).toEqual(server.env)
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
    expect(buildWorkflow).toContain('pnpm run plugin:cua:package:mac:${{ matrix.arch }}')
    expect(buildWorkflow).toContain('Verify CUA plugin artifact')
    expect(releaseWorkflow).toContain('require_cua_plugin_asset x64')
    expect(releaseWorkflow).toContain('require_cua_plugin_asset arm64')
    expect(releaseWorkflow).toContain('deepchat-plugin-cua-${VERSION}-darwin-${arch}.dcplugin')
    expect(releaseWorkflow).toContain('cp "${dir}/${asset}" release_assets/')
    expect(packageScript).toContain("parts[0] === 'runtime'")
    expect(packageScript).toContain('parts[2] !== args.targetArch')
    expect(guide).toContain('deepchat-plugin-cua-<version>-darwin-arm64.dcplugin')
    expect(guide).toContain('deepchat-plugin-cua-<version>-darwin-x64.dcplugin')
    expect(guide).toContain('Each `.dcplugin` contains only the runtime directory')
  })
})
