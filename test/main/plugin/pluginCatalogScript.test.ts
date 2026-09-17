import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { PluginCatalogSchema } from '@shared/contracts/routes'

const execFileAsync = promisify(execFile)

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-catalog-script-'))
  tempDirs.push(dir)
  return dir
}

function createPluginPackageBytes(pluginId: string): Uint8Array {
  const manifest = {
    id: pluginId,
    name: 'Fixture Runtime',
    version: '0.2.3',
    publisher: 'DeepChat',
    engines: { deepchat: '>=0.2.3', platforms: ['darwin', 'win32', 'linux'] },
    activationEvents: ['onEnable'],
    capabilities: ['mcp.register'],
    source: {
      type: 'deepchat-official',
      url: 'https://github.com/ThinkInAIXYZ/deepchat/releases/download/v0.2.3/x.dcplugin',
      publisher: 'DeepChat'
    }
  }
  const files: Record<string, Uint8Array> = {
    'plugin.json': new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  }
  files['checksums.json'] = new TextEncoder().encode(
    JSON.stringify({
      'plugin.json': createHash('sha256').update(Buffer.from(files['plugin.json'])).digest('hex')
    })
  )
  return zipSync(files)
}

async function seedOcrRuntimeDirs(root: string): Promise<void> {
  const runtimeDir = path.join(root, 'runtime')
  await mkdir(path.join(runtimeDir, 'ocr', 'native'), { recursive: true })
  await mkdir(path.join(runtimeDir, 'ocr', 'facade'), { recursive: true })
  await mkdir(path.join(runtimeDir, 'ocr', 'runtime'), { recursive: true })
  await mkdir(path.join(runtimeDir, 'ocr', 'bundle'), { recursive: true })
  await mkdir(path.join(root, 'out', 'main'), { recursive: true })
  await writeFile(
    path.join(runtimeDir, 'ocr', 'manifest.json'),
    JSON.stringify({
      schemaVersion: 3,
      supported: true,
      platform: 'darwin',
      arch: 'arm64',
      facadeVersion: '0.5.7',
      runtimeVersion: '0.1.7',
      modelVersion: '0.3.4',
      nativeVersion: '0.5.7',
      pdfSupport: true,
      bundleId: 'ppocrv6-small-native-test',
      nativePayloadEncoding: 'gzip-base64-v1',
      nativePackage: '@arcships/light-ocr-darwin-arm64',
      paths: {
        helper: 'out/main/lightOcrHelper.js',
        facade: 'runtime/ocr/facade',
        runtime: 'runtime/ocr/runtime',
        bundle: 'runtime/ocr/bundle',
        native: 'runtime/ocr/native'
      }
    })
  )
  await writeFile(path.join(runtimeDir, 'ocr', 'native', 'engine.bin'), 'engine')
  await writeFile(path.join(runtimeDir, 'ocr', 'facade', 'index.cjs'), 'facade')
  await writeFile(path.join(runtimeDir, 'ocr', 'runtime', 'index.cjs'), 'runtime')
  await writeFile(
    path.join(runtimeDir, 'ocr', 'package.json'),
    JSON.stringify({ name: '@arcships/light-ocr-model-fixture', version: '0.3.4' })
  )
  await writeFile(path.join(runtimeDir, 'ocr', 'bundle', 'manifest.json'), '{"bundleId":"x"}')
  await writeFile(path.join(root, 'out', 'main', 'lightOcrHelper.js'), 'helper')
}

describe('plugin-catalog.mjs generate', () => {
  it('produces a catalog the app schema accepts, with platform/arch pins', async () => {
    const root = await createTempDir()
    const artifactsDir = path.join(root, 'artifacts')
    await mkdir(artifactsDir, { recursive: true })
    await writeFile(
      path.join(artifactsDir, 'deepchat-plugin-fixture-0.2.3-darwin-arm64.dcplugin'),
      Buffer.from(createPluginPackageBytes('com.deepchat.plugins.fixture'))
    )
    await seedOcrRuntimeDirs(root)
    const catalogPath = path.join(root, 'plugin-catalog.json')

    // Loopback http is allowed so fixture-driven flows work without TLS.
    await execFileAsync('node', [
      'scripts/plugin-catalog.mjs',
      'generate',
      '--artifacts-dir',
      artifactsDir,
      '--runtime-dir',
      path.join(root, 'runtime'),
      '--base-url',
      'https://github.com/ThinkInAIXYZ/deepchat/releases/download/v1.1.2',
      '--mirror',
      'https://mirror.example.com/',
      '--catalog',
      catalogPath,
      '--write'
    ])

    const generated = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as unknown
    // The generated catalog must satisfy the same zod contract the app
    // enforces when loading it.
    const catalog = PluginCatalogSchema.parse(generated)

    expect(catalog.artifacts).toHaveLength(1)
    expect(catalog.artifacts[0].targets[0]).toMatchObject({
      platform: 'darwin',
      arch: 'arm64',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(catalog.runtimeAssets).toHaveLength(1)
    expect(catalog.runtimeAssets?.[0].targets[0]).toMatchObject({
      platform: 'darwin',
      arch: 'arm64'
    })
    // The OCR payload zip is emitted next to the plugin artifacts.
    const packaged = fs.readdirSync(artifactsDir).filter((name) => name.endsWith('.zip'))
    expect(packaged).toEqual(['light-ocr-ppocrv6-small-native-test-darwin-arm64.zip'])
    // The payload carries the full closure the runtime resolver validates:
    // the manifest, the helper, and every package directory the manifest
    // references — not just the runtime/ocr subtree.
    const payloadEntries = Object.keys(
      unzipSync(new Uint8Array(fs.readFileSync(path.join(artifactsDir, packaged[0]))))
    ).sort()
    expect(payloadEntries).toEqual([
      'out/main/lightOcrHelper.js',
      'runtime/ocr/bundle/manifest.json',
      'runtime/ocr/facade/index.cjs',
      'runtime/ocr/manifest.json',
      'runtime/ocr/native/engine.bin',
      'runtime/ocr/package.json',
      'runtime/ocr/runtime/index.cjs'
    ])
  })

  it('rejects plain http base urls for remote hosts', async () => {
    const root = await createTempDir()
    const artifactsDir = path.join(root, 'artifacts')
    await mkdir(artifactsDir, { recursive: true })
    const catalogPath = path.join(root, 'plugin-catalog.json')

    await expect(
      execFileAsync('node', [
        'scripts/plugin-catalog.mjs',
        'generate',
        '--artifacts-dir',
        artifactsDir,
        '--base-url',
        'http://example.com/releases',
        '--catalog',
        catalogPath,
        '--write'
      ])
    ).rejects.toThrow(/https/)
  })
})
