import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { OcrRuntimeAssetResolver } from '@/ocr/ocrRuntimeAssetResolver'
import { OcrRuntimeAssetInstaller } from '@/ocr/runtimeAssetInstaller'
import { resetProbeCacheForTests, type FetchLike } from '@/toolchains/downloader'
import type { PluginCatalogTarget, RuntimeCatalogAsset } from '@shared/types/pluginCatalog'

const lightOcrVersion = '0.5.7'
const runtimeVersion = '0.1.7'
const modelVersion = '0.3.4'
const nativeVersion = '0.5.7'
const bundleId = 'ppocrv6-small-native-20260719.1'
const nativeArtifactInventory = {
  nativeCode: ['native/light_ocr_node.node'],
  pdfiumCode: ['pdfium/libpdfium.dylib', 'pdfium/pdfium.node'],
  pdfiumLoader: ['pdfium/index.cjs'],
  other: [
    'native/runtime-descriptor.json',
    'pdfium/fonts/NotoSansSC-Regular.otf',
    'pdfium/fonts/OFL.txt'
  ]
}

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-runtime-install-'))
  tempDirs.push(dir)
  return dir
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
  resetProbeCacheForTests()
})

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(filePath: string, value = '') {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value)
}

/** Seeds a valid packaged OCR runtime root (the unpacked-app-root layout). */
async function seedRuntimeRoot(root: string): Promise<void> {
  const facadeDir = path.join(root, 'node_modules', '@arcships', 'light-ocr')
  const runtimeDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-runtime')
  const modelDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-model-ppocrv6-small')
  const nativeDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-darwin-arm64')
  await writeJson(path.join(facadeDir, 'package.json'), {
    name: '@arcships/light-ocr',
    version: lightOcrVersion,
    main: 'src/index.cjs',
    dependencies: {
      '@arcships/light-ocr-runtime': runtimeVersion,
      '@arcships/light-ocr-model-ppocrv6-small': modelVersion
    }
  })
  await writeText(path.join(facadeDir, 'src', 'index.cjs'))
  await writeJson(path.join(runtimeDir, 'package.json'), {
    name: '@arcships/light-ocr-runtime',
    version: runtimeVersion,
    main: 'src/index.cjs',
    optionalDependencies: { '@arcships/light-ocr-darwin-arm64': nativeVersion }
  })
  await writeText(path.join(runtimeDir, 'src', 'index.cjs'))
  await writeJson(path.join(modelDir, 'package.json'), {
    name: '@arcships/light-ocr-model-ppocrv6-small',
    version: modelVersion,
    exports: { './bundle/manifest.json': './bundle/manifest.json' }
  })
  await writeJson(path.join(modelDir, 'bundle', 'manifest.json'), { bundleId })
  await writeJson(path.join(nativeDir, 'package.json'), {
    name: '@arcships/light-ocr-darwin-arm64',
    version: nativeVersion,
    main: 'native/light_ocr_node.node'
  })
  await writeJson(path.join(nativeDir, 'artifact-hashes.json'), {
    files: [
      { path: 'native/light_ocr_node.node' },
      { path: 'native/runtime-descriptor.json' },
      { path: 'pdfium/fonts/NotoSansSC-Regular.otf' },
      { path: 'pdfium/fonts/OFL.txt' },
      { path: 'pdfium/index.cjs' },
      { path: 'pdfium/libpdfium.dylib' },
      { path: 'pdfium/pdfium.node' }
    ]
  })
  await writeText(path.join(nativeDir, 'native', 'light_ocr_node.node'))
  await writeText(path.join(nativeDir, 'native', 'runtime-descriptor.json'), '{}')
  await writeText(path.join(nativeDir, 'pdfium', 'fonts', 'NotoSansSC-Regular.otf'))
  await writeText(path.join(nativeDir, 'pdfium', 'fonts', 'OFL.txt'))
  await writeText(path.join(nativeDir, 'pdfium', 'index.cjs'))
  await writeText(path.join(nativeDir, 'pdfium', 'libpdfium.dylib'))
  await writeText(path.join(nativeDir, 'pdfium', 'libpdfium.dylib.gz.b64'))
  await writeText(path.join(nativeDir, 'pdfium', 'pdfium.node'))
  await writeText(path.join(nativeDir, 'pdfium', 'pdfium.node.gz.b64'))
  await writeText(path.join(root, 'out', 'main', 'lightOcrHelper.js'))
  await writeText(path.join(root, 'runtime', 'node', 'bin', 'node'))
  await writeJson(path.join(root, 'runtime', 'ocr', 'manifest.json'), {
    schemaVersion: 3,
    supported: true,
    platform: 'darwin',
    arch: 'arm64',
    facadeVersion: lightOcrVersion,
    runtimeVersion,
    modelVersion,
    nativeVersion,
    pdfSupport: true,
    bundleId,
    nativePayloadEncoding: 'gzip-base64-v1',
    nativePackage: '@arcships/light-ocr-darwin-arm64',
    nativeArtifactInventory,
    paths: {
      node: 'runtime/node/bin/node',
      helper: 'out/main/lightOcrHelper.js',
      facade: 'node_modules/@arcships/light-ocr',
      runtime: 'node_modules/@arcships/light-ocr-runtime',
      bundle: 'node_modules/@arcships/light-ocr-model-ppocrv6-small/bundle',
      native: 'node_modules/@arcships/light-ocr-darwin-arm64'
    }
  })
}

async function collectFiles(dir: string, base = dir): Promise<Record<string, Uint8Array>> {
  const entries: Record<string, Uint8Array> = {}
  for (const name of await readdir(dir)) {
    const absolute = path.join(dir, name)
    if ((await stat(absolute)).isDirectory()) {
      Object.assign(entries, await collectFiles(absolute, base))
      continue
    }
    const relative = path.relative(base, absolute).split(path.sep).join('/')
    entries[relative] = new Uint8Array(fs.readFileSync(absolute))
  }
  return entries
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function createAssetAndTarget(
  payload: Uint8Array,
  overrides: { sha256?: string } = {}
): { asset: RuntimeCatalogAsset; target: PluginCatalogTarget } {
  const target: PluginCatalogTarget = {
    platform: 'darwin',
    arch: 'arm64',
    url: 'https://example.com/ocr-runtime.zip',
    sha256: overrides.sha256 ?? sha256(payload),
    size: payload.length,
    mirrors: []
  }
  const asset: RuntimeCatalogAsset = {
    id: 'light-ocr',
    version: bundleId,
    channel: 'stable',
    displayName: 'LightOCR Runtime',
    targets: [target]
  }
  return { asset, target }
}

function fetchServingContent(content: Uint8Array): FetchLike {
  return async () => new Response(new Uint8Array(content), { status: 200 })
}

describe('OcrRuntimeAssetInstaller', () => {
  it('downloads, validates and materializes a runtime payload the resolver accepts', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const payload = zipSync(await collectFiles(payloadRoot))

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      fetchImpl: fetchServingContent(payload),
      probeTimeoutMs: 250
    })
    const { asset, target } = createAssetAndTarget(payload)

    const result = await installer.install(asset, target)

    expect(result.ok).toBe(true)
    expect(installer.listInstalledRoots()).toEqual([path.join(installRoot, bundleId)])
    // Staging is cleaned up after success (only the empty staging root remains).
    expect(fs.readdirSync(path.join(installRoot, '.staging'))).toEqual([])

    // The installed root passes the resolver's full identity verification.
    const availability = await new OcrRuntimeAssetResolver({
      appPath: path.join(dir, 'resources', 'app.asar'),
      isPackaged: true,
      platform: 'darwin',
      arch: 'arm64',
      installedRuntimeRoots: () => installer.listInstalledRoots()
    }).resolve()
    expect(availability).toMatchObject({ status: 'available' })
  })

  it('rejects a payload whose bytes do not match the pinned sha256', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const payload = zipSync(await collectFiles(payloadRoot))

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      fetchImpl: fetchServingContent(payload),
      probeTimeoutMs: 250
    })
    const { asset, target } = createAssetAndTarget(payload, { sha256: '0'.repeat(64) })

    const result = await installer.install(asset, target)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('checksum_mismatch')
    expect(installer.listInstalledRoots()).toEqual([])
  })

  it('rejects a payload without a packaged runtime manifest', async () => {
    const dir = await createTempDir()
    const payload = zipSync({ 'readme.txt': new TextEncoder().encode('not a runtime') })

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      fetchImpl: fetchServingContent(payload),
      probeTimeoutMs: 250
    })
    const { asset, target } = createAssetAndTarget(payload)

    const result = await installer.install(asset, target)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('manifest')
    expect(installer.listInstalledRoots()).toEqual([])
  })

  it('rejects a payload whose decompressed size exceeds the cap', async () => {
    const dir = await createTempDir()
    // 260 MiB of zeros deflates to a few hundred KB but declares an
    // originalSize above the 256 MiB floor; the filter must reject the entry
    // before fflate allocates the decompressed buffer.
    const bomb = new Uint8Array(260 * 1024 * 1024)
    const payload = zipSync({ 'runtime/ocr/native/engine.bin': bomb })
    expect(payload.length).toBeLessThan(4 * 1024 * 1024)

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      fetchImpl: fetchServingContent(payload),
      probeTimeoutMs: 250
    })
    const { asset, target } = createAssetAndTarget(payload)

    const result = await installer.install(asset, target)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('decompressed size cap')
    expect(installer.listInstalledRoots()).toEqual([])
  })

  it('rejects a payload that declares a helper entry it does not contain', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const files = await collectFiles(payloadRoot)
    delete files['out/main/lightOcrHelper.js']
    const payload = zipSync(files)

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      fetchImpl: fetchServingContent(payload),
      probeTimeoutMs: 250
    })
    const { asset, target } = createAssetAndTarget(payload)

    const result = await installer.install(asset, target)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('helper')
    expect(installer.listInstalledRoots()).toEqual([])
  })

  it('rejects zip entries that escape the payload root', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const files = await collectFiles(payloadRoot)
    files['../outside/evil.txt'] = new TextEncoder().encode('evil')
    const payload = zipSync(files)

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      fetchImpl: fetchServingContent(payload),
      probeTimeoutMs: 250
    })
    const { asset, target } = createAssetAndTarget(payload)

    const result = await installer.install(asset, target)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unsafe')
    expect(fs.existsSync(path.join(dir, 'outside'))).toBe(false)
  })

  it('replaces an existing install of the same version', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const payload = zipSync(await collectFiles(payloadRoot))

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      fetchImpl: fetchServingContent(payload),
      probeTimeoutMs: 250
    })
    const { asset, target } = createAssetAndTarget(payload)

    await installer.install(asset, target)
    const second = await installer.install(asset, target)

    expect(second.ok).toBe(true)
    expect(installer.listInstalledRoots()).toEqual([path.join(installRoot, bundleId)])
  })

  it('unzipped payload files match the archive contents', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const payload = zipSync(await collectFiles(payloadRoot))

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      fetchImpl: fetchServingContent(payload),
      probeTimeoutMs: 250
    })
    const { asset, target } = createAssetAndTarget(payload)
    await installer.install(asset, target)

    const materialized = await collectFiles(path.join(installRoot, bundleId))
    const archived = unzipSync(payload)
    expect(Object.keys(materialized).sort()).toEqual(Object.keys(archived).sort())
  })

  it('installs a manually selected payload file without a catalog entry', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const payload = zipSync(await collectFiles(payloadRoot))
    const archivePath = path.join(dir, 'manual-payload.zip')
    fs.writeFileSync(archivePath, Buffer.from(payload))

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      platform: 'darwin',
      arch: 'arm64'
    })

    const result = await installer.installFromFile(archivePath)

    expect(result.ok).toBe(true)
    expect(result.version).toBe(bundleId)
    expect(installer.listInstalledVersions()).toEqual([bundleId])

    // The manually installed payload passes the resolver's identity checks.
    const availability = await new OcrRuntimeAssetResolver({
      appPath: path.join(dir, 'resources', 'app.asar'),
      isPackaged: true,
      platform: 'darwin',
      arch: 'arm64',
      installedRuntimeRoots: () => installer.listInstalledRoots()
    }).resolve()
    expect(availability).toMatchObject({ status: 'available' })
  })

  it('rejects a manually selected payload built for another platform', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const files = await collectFiles(payloadRoot)
    const manifest = JSON.parse(Buffer.from(files['runtime/ocr/manifest.json']).toString('utf8'))
    manifest.platform = 'win32'
    files['runtime/ocr/manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const payload = zipSync(files)
    const archivePath = path.join(dir, 'foreign-payload.zip')
    fs.writeFileSync(archivePath, Buffer.from(payload))

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      platform: 'darwin',
      arch: 'arm64'
    })

    const result = await installer.installFromFile(archivePath)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('win32')
    expect(installer.listInstalledRoots()).toEqual([])
  })

  it('removes downloaded runtime versions on uninstall', async () => {
    const dir = await createTempDir()
    const payloadRoot = path.join(dir, 'payload-root')
    await seedRuntimeRoot(payloadRoot)
    const payload = zipSync(await collectFiles(payloadRoot))
    const archivePath = path.join(dir, 'manual-payload.zip')
    fs.writeFileSync(archivePath, Buffer.from(payload))

    const installRoot = path.join(dir, 'runtimes', 'ocr')
    const installer = new OcrRuntimeAssetInstaller({
      installRoot: () => installRoot,
      stagingRoot: () => path.join(installRoot, '.staging'),
      platform: 'darwin',
      arch: 'arm64'
    })
    await installer.installFromFile(archivePath)
    expect(installer.listInstalledVersions()).toEqual([bundleId])

    const removed = installer.removeInstalled()

    expect(removed).toBe(1)
    expect(installer.listInstalledRoots()).toEqual([])
  })
})
