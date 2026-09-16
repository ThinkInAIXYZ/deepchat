import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { zipSync } from 'fflate'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { PluginService } from '@/plugin'
import { PluginSettingsWindow } from '@/desktop/pluginSettingsWindow'
import {
  PluginCatalogService,
  PLUGIN_CATALOG_OVERRIDE_ENV,
  PLUGIN_CATALOG_FILE_NAME
} from '@/plugin/catalog'
import { PluginRemoteInstaller } from '@/plugin/remoteInstaller'
import { resetProbeCacheForTests, type FetchLike } from '@/toolchains/downloader'

const tempRoots: string[] = []

beforeEach(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-l1-'))
  tempRoots.push(root)
})

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })))
  tempRoots.length = 0
  resetProbeCacheForTests()
  vi.restoreAllMocks()
})

function createFixturePackageBytes(pluginId: string): Uint8Array {
  const manifest = {
    id: pluginId,
    name: 'Fixture Runtime',
    version: '0.2.3',
    publisher: 'DeepChat',
    engines: {
      deepchat: '>=0.2.3',
      platforms: ['darwin', 'win32', 'linux']
    },
    activationEvents: ['onEnable'],
    capabilities: ['mcp.register'],
    source: {
      type: 'deepchat-official',
      url: 'https://github.com/ThinkInAIXYZ/deepchat/releases/download/v0.2.3/deepchat-plugin-fixture.dcplugin',
      publisher: 'DeepChat'
    },
    mcpServers: [
      {
        id: 'fixture-runtime',
        displayName: 'Fixture Runtime',
        transport: 'stdio',
        command: '${runtime.fixture-runtime.command}',
        args: ['mcp']
      }
    ]
  }
  const files: Record<string, Uint8Array> = {
    'plugin.json': new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    'skills/fixture/SKILL.md': new TextEncoder().encode('# Fixture skill\n')
  }
  const checksums = Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      createHash('sha256').update(Buffer.from(content)).digest('hex')
    ])
  )
  files['checksums.json'] = new TextEncoder().encode(`${JSON.stringify(checksums, null, 2)}\n`)
  return zipSync(files, { level: 6 })
}

async function createPluginServiceL1(root: string): Promise<PluginService> {
  const appPath = path.join(root, 'app')
  const userDataPath = path.join(root, 'userData')
  await mkdir(appPath, { recursive: true })
  await mkdir(userDataPath, { recursive: true })
  vi.mocked(app.getPath).mockImplementation((name: string) => {
    if (name === 'userData') return userDataPath
    if (name === 'temp' || name === 'home') return root
    return '/mock/path'
  })
  const mcpSettings = {
    getMcpServers: vi.fn().mockResolvedValue({}),
    addMcpServer: vi.fn(),
    updateMcpServer: vi.fn(),
    removeMcpServer: vi.fn(),
    getMcpEnabled: vi.fn().mockResolvedValue(true)
  }
  const mcpService = {
    isReady: vi.fn(() => true),
    isServerRunning: vi.fn().mockResolvedValue(false),
    getServerLastError: vi.fn().mockReturnValue(undefined),
    checkPluginRuntimePermissions: vi.fn().mockResolvedValue(undefined)
  }
  const runtimeSupervisor = {
    attachSafetyStore: vi.fn(),
    registerServer: vi.fn(),
    commitPluginRegistration: vi.fn(),
    unregisterPlugin: vi.fn(),
    reconcilePlugin: vi.fn(),
    testRuntime: vi.fn(),
    retryRuntime: vi.fn(),
    getState: vi.fn().mockReturnValue(undefined)
  }
  const skillService = {
    registerPluginSkill: vi.fn().mockResolvedValue(undefined),
    unregisterPluginSkillsByOwner: vi.fn().mockResolvedValue(undefined)
  }
  return new PluginService({
    platform: process.platform,
    arch: process.arch,
    appPath,
    isPackaged: true,
    resourcesPath: path.join(root, 'resources'),
    mcpSettings: mcpSettings as never,
    mcpService: mcpService as never,
    runtimeSupervisor: runtimeSupervisor as never,
    skillService: skillService as never,
    settingsWindow: new PluginSettingsWindow()
  } as never)
}

describe('remote plugin distribution (L1 chain)', () => {
  it('installs a catalog plugin from a remote artifact end to end', async () => {
    const root = tempRoots[0]
    const pluginId = 'com.deepchat.plugins.fixture'
    const packageBytes = createFixturePackageBytes(pluginId)
    const sha256 = createHash('sha256').update(Buffer.from(packageBytes)).digest('hex')

    // Catalog via the dev override hook (the same mechanism the L1 e2e uses).
    const resourcesDir = path.join(root, 'resources')
    await mkdir(resourcesDir, { recursive: true })
    const overrideCatalogPath = path.join(root, 'override-catalog.json')
    await writeFile(
      overrideCatalogPath,
      JSON.stringify({
        schemaVersion: 1,
        artifacts: [
          {
            pluginId,
            version: '0.2.3',
            channel: 'stable',
            displayName: 'Fixture Runtime',
            targets: [
              {
                platform: process.platform,
                arch: process.arch,
                url: 'http://127.0.0.1:9/fixture.dcplugin',
                sha256,
                size: packageBytes.length,
                mirrors: []
              }
            ]
          }
        ]
      }),
      'utf8'
    )
    fs.writeFileSync(
      path.join(resourcesDir, PLUGIN_CATALOG_FILE_NAME),
      JSON.stringify({ schemaVersion: 1, artifacts: [] })
    )
    const catalog = new PluginCatalogService({
      appPath: path.join(root, 'app'),
      resourcesPath: resourcesDir,
      isPackaged: false,
      platform: process.platform,
      arch: process.arch,
      appVersion: '1.0.0',
      env: { [PLUGIN_CATALOG_OVERRIDE_ENV]: overrideCatalogPath }
    })

    const resolution = catalog.resolveArtifact(pluginId)
    expect(resolution).not.toBeNull()

    const pluginService = await createPluginServiceL1(root)
    const progressPhases: string[] = []
    const installer = new PluginRemoteInstaller({
      stagingRoot: () => path.join(root, 'userData', 'plugins', '.staging'),
      installPackage: (packagePath) => pluginService.installOfficialPluginPackage(packagePath),
      fetchImpl: (async () =>
        new Response(new Uint8Array(packageBytes), { status: 200 })) satisfies FetchLike,
      probeTimeoutMs: 250,
      onProgress: (state) => progressPhases.push(state.phase)
    })

    const result = await installer.install(resolution!.artifact, resolution!.target)

    expect(result.ok).toBe(true)
    expect(progressPhases).toContain('downloading')
    expect(progressPhases[progressPhases.length - 1]).toBe('installed')

    // The plugin is registered and visible through the normal list flow.
    const plugins = await pluginService.listPlugins()
    const installed = plugins.find((plugin) => plugin.id === pluginId)
    expect(installed).toMatchObject({ version: '0.2.3', official: true, trusted: true })

    // The payload is materialized in the install root with checksums intact.
    const installRoot = path.join(root, 'userData', 'plugins')
    const pluginDir = fs.readdirSync(installRoot).find((entry) => entry.includes('fixture'))
    expect(pluginDir).toBeDefined()
    const manifestPath = path.join(installRoot, pluginDir!, 'plugin.json')
    expect(fs.existsSync(manifestPath)).toBe(true)

    // Staging is cleaned up.
    expect(fs.readdirSync(path.join(installRoot, '.staging'))).toEqual([])
  })

  it('leaves no installation behind when the artifact fails checksum verification', async () => {
    const root = tempRoots[0]
    const pluginId = 'com.deepchat.plugins.fixture'
    const packageBytes = createFixturePackageBytes(pluginId)

    const pluginService = await createPluginServiceL1(root)
    const installer = new PluginRemoteInstaller({
      stagingRoot: () => path.join(root, 'userData', 'plugins', '.staging'),
      installPackage: (packagePath) => pluginService.installOfficialPluginPackage(packagePath),
      fetchImpl: (async () =>
        new Response(new Uint8Array(packageBytes), { status: 200 })) satisfies FetchLike,
      probeTimeoutMs: 250
    })

    const artifact = {
      pluginId,
      version: '0.2.3',
      channel: 'stable' as const,
      targets: [
        {
          platform: process.platform,
          arch: process.arch,
          url: 'http://127.0.0.1:9/fixture.dcplugin',
          sha256: '0'.repeat(64),
          size: packageBytes.length,
          mirrors: []
        }
      ]
    }

    const result = await installer.install(artifact, artifact.targets[0])

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('checksum_mismatch')
    const plugins = await pluginService.listPlugins()
    expect(plugins.find((plugin) => plugin.id === pluginId)).toBeUndefined()
    const installRoot = path.join(root, 'userData', 'plugins')
    if (fs.existsSync(installRoot)) {
      expect(fs.readdirSync(installRoot).filter((entry) => entry !== '.staging')).toEqual([])
    }
  })
})
