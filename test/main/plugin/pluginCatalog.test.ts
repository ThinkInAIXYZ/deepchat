import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import {
  PluginCatalogService,
  PLUGIN_CATALOG_FILE_NAME,
  PLUGIN_CATALOG_OVERRIDE_ENV
} from '@/plugin/catalog'
import type { PluginCatalogArtifact } from '@shared/types/pluginCatalog'
import { parsePluginCatalog } from '@shared/contracts/routes'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-catalog-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

function writeCatalogFile(dir: string, content: unknown): string {
  const resourcesDir = path.join(dir, 'resources')
  fs.mkdirSync(resourcesDir, { recursive: true })
  const filePath = path.join(resourcesDir, PLUGIN_CATALOG_FILE_NAME)
  fs.writeFileSync(filePath, JSON.stringify(content), 'utf8')
  return filePath
}

function createArtifact(overrides: Partial<PluginCatalogArtifact> = {}): PluginCatalogArtifact {
  return {
    pluginId: 'com.deepchat.plugins.example',
    version: '1.0.0',
    channel: 'stable',
    displayName: 'Example',
    targets: [
      {
        platform: 'darwin',
        arch: 'arm64',
        url: 'https://example.com/plugin.dcplugin',
        sha256: 'a'.repeat(64),
        size: 1234,
        mirrors: []
      }
    ],
    ...overrides
  }
}

describe('parsePluginCatalog', () => {
  it('accepts a valid catalog', () => {
    const catalog = parsePluginCatalog({
      schemaVersion: 1,
      artifacts: [createArtifact()]
    })
    expect(catalog.artifacts).toHaveLength(1)
    expect(catalog.artifacts[0].pluginId).toBe('com.deepchat.plugins.example')
  })

  it('rejects an unknown schema version', () => {
    expect(() => parsePluginCatalog({ schemaVersion: 2, artifacts: [] })).toThrow(
      /Invalid plugin catalog/
    )
  })

  it('rejects an invalid sha256 pin', () => {
    expect(() =>
      parsePluginCatalog({
        schemaVersion: 1,
        artifacts: [
          createArtifact({
            targets: [
              {
                platform: 'darwin',
                arch: 'arm64',
                url: 'https://example.com/plugin.dcplugin',
                sha256: 'not-a-hash',
                size: 10,
                mirrors: []
              }
            ]
          })
        ]
      })
    ).toThrow(/Invalid plugin catalog/)
  })

  it('rejects an invalid mirror protocol', () => {
    expect(() =>
      parsePluginCatalog({
        schemaVersion: 1,
        artifacts: [
          createArtifact({
            targets: [
              {
                platform: 'darwin',
                arch: 'arm64',
                url: 'https://example.com/plugin.dcplugin',
                sha256: 'a'.repeat(64),
                size: 10,
                mirrors: ['ftp://mirror.example.com/']
              }
            ]
          })
        ]
      })
    ).toThrow(/Invalid plugin catalog/)
  })
})

describe('PluginCatalogService', () => {
  it('returns an empty catalog when the catalog file is missing', () => {
    const service = new PluginCatalogService({
      appPath: os.tmpdir(),
      isPackaged: false,
      platform: 'darwin',
      arch: 'arm64',
      appVersion: '1.0.0',
      env: {}
    })
    expect(service.getCatalog().artifacts).toHaveLength(0)
  })

  it('resolves the artifact matching the current platform and arch', async () => {
    const dir = await createTempDir()
    writeCatalogFile(dir, {
      schemaVersion: 1,
      artifacts: [
        createArtifact({ pluginId: 'plugin.a' }),
        createArtifact({
          pluginId: 'plugin.b',
          targets: [
            {
              platform: 'win32',
              arch: 'x64',
              url: 'https://example.com/b.dcplugin',
              sha256: 'b'.repeat(64),
              size: 10,
              mirrors: []
            }
          ]
        })
      ]
    })
    const service = new PluginCatalogService({
      appPath: dir,
      isPackaged: false,
      platform: 'darwin',
      arch: 'arm64',
      appVersion: '1.0.0',
      env: {}
    })

    expect(service.resolveArtifact('plugin.a')?.artifact.pluginId).toBe('plugin.a')
    expect(service.resolveArtifact('plugin.b')).toBeNull()
    expect(service.listVisibleArtifacts().map((a) => a.pluginId)).toEqual(['plugin.a', 'plugin.b'])
  })

  it('hides pre-release entries from packaged builds', async () => {
    const dir = await createTempDir()
    writeCatalogFile(dir, {
      schemaVersion: 1,
      artifacts: [
        createArtifact({ pluginId: 'plugin.stable' }),
        createArtifact({ pluginId: 'plugin.rc', channel: 'pre-release' })
      ]
    })

    const packaged = new PluginCatalogService({
      resourcesPath: path.join(dir, 'resources'),
      isPackaged: true,
      platform: 'darwin',
      arch: 'arm64',
      appVersion: '1.0.0',
      env: { [PLUGIN_CATALOG_OVERRIDE_ENV]: '/should/be/ignored.json' }
    })
    expect(packaged.listVisibleArtifacts().map((a) => a.pluginId)).toEqual(['plugin.stable'])
    expect(packaged.resolveArtifact('plugin.rc')).toBeNull()

    const dev = new PluginCatalogService({
      appPath: dir,
      isPackaged: false,
      platform: 'darwin',
      arch: 'arm64',
      appVersion: '1.0.0',
      env: {}
    })
    expect(dev.listVisibleArtifacts().map((a) => a.pluginId)).toEqual([
      'plugin.stable',
      'plugin.rc'
    ])
  })

  it('gates artifacts by minAppVersion', async () => {
    const dir = await createTempDir()
    writeCatalogFile(dir, {
      schemaVersion: 1,
      artifacts: [
        createArtifact({ pluginId: 'plugin.new', minAppVersion: '2.0.0' }),
        createArtifact({ pluginId: 'plugin.old', minAppVersion: '0.5.0' })
      ]
    })
    const service = new PluginCatalogService({
      appPath: dir,
      isPackaged: false,
      platform: 'darwin',
      arch: 'arm64',
      appVersion: '1.0.0',
      env: {}
    })

    expect(service.resolveArtifact('plugin.new')).toBeNull()
    expect(service.describeAvailability(service.listVisibleArtifacts()[0]).availability).toBe(
      'incompatible-app'
    )
    expect(service.resolveArtifact('plugin.old')?.artifact.pluginId).toBe('plugin.old')
  })

  it('loads an overridden catalog from the env hook in dev builds only', async () => {
    const dir = await createTempDir()
    const overridePath = path.join(dir, 'override-catalog.json')
    await writeFile(
      overridePath,
      JSON.stringify({
        schemaVersion: 1,
        artifacts: [createArtifact({ pluginId: 'plugin.override', version: '9.9.9' })]
      }),
      'utf8'
    )
    writeCatalogFile(dir, {
      schemaVersion: 1,
      artifacts: [createArtifact({ pluginId: 'plugin.bundled' })]
    })

    const dev = new PluginCatalogService({
      appPath: dir,
      isPackaged: false,
      platform: 'darwin',
      arch: 'arm64',
      appVersion: '1.0.0',
      env: { [PLUGIN_CATALOG_OVERRIDE_ENV]: overridePath }
    })
    expect(dev.listVisibleArtifacts().map((a) => a.pluginId)).toEqual(['plugin.override'])
  })

  it('describes unsupported platforms', async () => {
    const dir = await createTempDir()
    writeCatalogFile(dir, {
      schemaVersion: 1,
      artifacts: [createArtifact({ pluginId: 'plugin.a' })]
    })
    const service = new PluginCatalogService({
      appPath: dir,
      isPackaged: false,
      platform: 'linux',
      arch: 'arm64',
      appVersion: '1.0.0',
      env: {}
    })
    expect(service.describeAvailability(service.listVisibleArtifacts()[0])).toEqual({
      availability: 'unsupported-platform',
      target: null
    })
  })
})
