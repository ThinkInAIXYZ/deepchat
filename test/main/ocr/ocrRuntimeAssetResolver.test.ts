import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  isPackagedRuntimeManifest,
  OcrRuntimeAssetResolver
} from '../../../src/main/ocr/ocrRuntimeAssetResolver'
import { ToolchainResolutionError } from '../../../src/main/toolchains/errors'

const lightOcrVersion = '0.5.7'
const runtimeVersion = '0.1.7'
const modelVersion = '0.3.4'
const nativeVersion = '0.5.7'
const bundleId = 'ppocrv6-small-native-20260719.1'
const runtimePackage = '@arcships/light-ocr-runtime'
const modelPackage = '@arcships/light-ocr-model-ppocrv6-small'
const nativePackage = '@arcships/light-ocr-darwin-arm64'
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

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(filePath: string, value = '') {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value)
}

async function seedAssetIdentity(root: string) {
  const facadeDir = path.join(root, 'node_modules', '@arcships', 'light-ocr')
  const runtimeDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-runtime')
  const modelDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-model-ppocrv6-small')
  const nativeDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-darwin-arm64')
  await writeJson(path.join(facadeDir, 'package.json'), {
    name: '@arcships/light-ocr',
    version: lightOcrVersion,
    main: 'src/index.cjs',
    dependencies: {
      [runtimePackage]: runtimeVersion,
      [modelPackage]: modelVersion
    }
  })
  await writeText(path.join(facadeDir, 'src', 'index.cjs'))
  await writeJson(path.join(runtimeDir, 'package.json'), {
    name: runtimePackage,
    version: runtimeVersion,
    main: 'src/index.cjs',
    optionalDependencies: { [nativePackage]: nativeVersion }
  })
  await writeText(path.join(runtimeDir, 'src', 'index.cjs'))
  await writeJson(path.join(modelDir, 'package.json'), {
    name: modelPackage,
    version: modelVersion,
    exports: { './bundle/manifest.json': './bundle/manifest.json' }
  })
  await writeJson(path.join(modelDir, 'bundle', 'manifest.json'), { bundleId })
  await writeJson(path.join(nativeDir, 'package.json'), {
    name: nativePackage,
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
  await writeJson(path.join(nativeDir, 'native', 'runtime-descriptor.json'), {})
  await writeText(path.join(nativeDir, 'pdfium', 'fonts', 'NotoSansSC-Regular.otf'))
  await writeText(path.join(nativeDir, 'pdfium', 'fonts', 'OFL.txt'))
  await writeText(path.join(nativeDir, 'pdfium', 'index.cjs'))
  await writeText(path.join(nativeDir, 'pdfium', 'libpdfium.dylib'))
  await writeText(path.join(nativeDir, 'pdfium', 'libpdfium.dylib.gz.b64'))
  await writeText(path.join(nativeDir, 'pdfium', 'pdfium.node'))
  await writeText(path.join(nativeDir, 'pdfium', 'pdfium.node.gz.b64'))
  return { facadeDir, runtimeDir, modelDir, nativeDir }
}

describe('OcrRuntimeAssetResolver', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-assets-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resolves an identity-checked packaged runtime manifest', async () => {
    const appPath = path.join(tempDir, 'resources', 'app.asar')
    const unpackedRoot = path.join(tempDir, 'resources', 'app.asar.unpacked')
    const { facadeDir, runtimeDir, modelDir, nativeDir } = await seedAssetIdentity(unpackedRoot)
    await writeText(path.join(unpackedRoot, 'runtime', 'node', 'bin', 'node'))
    await writeText(path.join(unpackedRoot, 'out', 'main', 'lightOcrHelper.js'))
    await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
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
      nativePackage,
      nativeArtifactInventory: {
        other: nativeArtifactInventory.other,
        pdfiumLoader: nativeArtifactInventory.pdfiumLoader,
        pdfiumCode: nativeArtifactInventory.pdfiumCode,
        nativeCode: nativeArtifactInventory.nativeCode
      },
      paths: {
        node: 'runtime/node/bin/node',
        helper: 'out/main/lightOcrHelper.js',
        facade: path.relative(unpackedRoot, facadeDir),
        runtime: path.relative(unpackedRoot, runtimeDir),
        bundle: path.relative(unpackedRoot, path.join(modelDir, 'bundle')),
        native: path.relative(unpackedRoot, nativeDir)
      }
    })

    const availability = await new OcrRuntimeAssetResolver({
      appPath,
      isPackaged: true,
      platform: 'darwin',
      arch: 'arm64'
    }).resolve()

    expect(availability).toMatchObject({
      status: 'available',
      assets: {
        bundlePath: path.join(modelDir, 'bundle'),
        nativePayloadEncoding: 'gzip-base64-v1',
        nativePackage,
        bundleId
      }
    })

    await rm(path.join(nativeDir, 'pdfium', 'fonts', 'NotoSansSC-Regular.otf'))
    await expect(
      new OcrRuntimeAssetResolver({
        appPath,
        isPackaged: true,
        platform: 'darwin',
        arch: 'arm64'
      }).resolve()
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'assets_missing' })
  })

  it.each(['..', '../../outside'])(
    'rejects %s path traversal in packaged manifests',
    async (bundle) => {
      const appPath = path.join(tempDir, 'resources', 'app.asar')
      const unpackedRoot = path.join(tempDir, 'resources', 'app.asar.unpacked')
      await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
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
        nativePackage,
        nativeArtifactInventory,
        paths: {
          node: 'runtime/node/bin/node',
          helper: 'out/main/lightOcrHelper.js',
          facade: 'node_modules/@arcships/light-ocr',
          runtime: 'node_modules/@arcships/light-ocr-runtime',
          bundle,
          native: 'node_modules/@arcships/light-ocr-darwin-arm64'
        }
      })

      await expect(
        new OcrRuntimeAssetResolver({
          appPath,
          isPackaged: true,
          platform: 'darwin',
          arch: 'arm64'
        }).resolve()
      ).resolves.toMatchObject({ status: 'unavailable', reason: 'runtime_manifest_invalid' })
    }
  )

  it('reports identity drift separately from missing assets', async () => {
    const appPath = path.join(tempDir, 'resources', 'app.asar')
    const unpackedRoot = path.join(tempDir, 'resources', 'app.asar.unpacked')
    const { facadeDir, runtimeDir, modelDir, nativeDir } = await seedAssetIdentity(unpackedRoot)
    await writeJson(path.join(facadeDir, 'package.json'), {
      name: '@arcships/light-ocr',
      version: '0.3.3',
      main: 'src/index.cjs'
    })
    await writeText(path.join(unpackedRoot, 'runtime', 'node', 'bin', 'node'))
    await writeText(path.join(unpackedRoot, 'out', 'main', 'lightOcrHelper.js'))
    await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
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
      nativePackage,
      nativeArtifactInventory,
      paths: {
        node: 'runtime/node/bin/node',
        helper: 'out/main/lightOcrHelper.js',
        facade: path.relative(unpackedRoot, facadeDir),
        runtime: path.relative(unpackedRoot, runtimeDir),
        bundle: path.relative(unpackedRoot, path.join(modelDir, 'bundle')),
        native: path.relative(unpackedRoot, nativeDir)
      }
    })

    await expect(
      new OcrRuntimeAssetResolver({
        appPath,
        isPackaged: true,
        platform: 'darwin',
        arch: 'arm64'
      }).resolve()
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'asset_identity_mismatch' })
  })

  it('resolves a packaged manifest that no longer ships Node', async () => {
    const appPath = path.join(tempDir, 'resources', 'app.asar')
    const unpackedRoot = path.join(tempDir, 'resources', 'app.asar.unpacked')
    const { facadeDir, runtimeDir, modelDir, nativeDir } = await seedAssetIdentity(unpackedRoot)
    await writeText(path.join(unpackedRoot, 'out', 'main', 'lightOcrHelper.js'))
    const manifest = {
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
      nativePackage,
      nativeArtifactInventory,
      paths: {
        helper: 'out/main/lightOcrHelper.js',
        facade: path.relative(unpackedRoot, facadeDir),
        runtime: path.relative(unpackedRoot, runtimeDir),
        bundle: path.relative(unpackedRoot, path.join(modelDir, 'bundle')),
        native: path.relative(unpackedRoot, nativeDir)
      }
    }
    await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), manifest)

    expect(isPackagedRuntimeManifest(manifest)).toBe(true)

    const nodeExecutable = path.join(tempDir, 'managed', 'node')
    await writeText(nodeExecutable)
    const availability = await new OcrRuntimeAssetResolver({
      appPath,
      isPackaged: true,
      platform: 'darwin',
      arch: 'arm64',
      resolveNode: () => ({ executable: nodeExecutable, version: 'v24.18.0' })
    }).resolve()

    expect(availability).toMatchObject({
      status: 'available',
      assets: {
        nodeExecutable,
        nodeVersion: 'v24.18.0',
        bundlePath: path.join(modelDir, 'bundle')
      }
    })
  })

  it('does not flatten toolchain resolution errors to assets_missing', async () => {
    const appPath = path.join(tempDir, 'resources', 'app.asar')
    const unpackedRoot = path.join(tempDir, 'resources', 'app.asar.unpacked')
    const { facadeDir, runtimeDir, modelDir, nativeDir } = await seedAssetIdentity(unpackedRoot)
    await writeText(path.join(unpackedRoot, 'out', 'main', 'lightOcrHelper.js'))
    await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
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
      nativePackage,
      nativeArtifactInventory,
      paths: {
        helper: 'out/main/lightOcrHelper.js',
        facade: path.relative(unpackedRoot, facadeDir),
        runtime: path.relative(unpackedRoot, runtimeDir),
        bundle: path.relative(unpackedRoot, path.join(modelDir, 'bundle')),
        native: path.relative(unpackedRoot, nativeDir)
      }
    })

    await expect(
      new OcrRuntimeAssetResolver({
        appPath,
        isPackaged: true,
        platform: 'darwin',
        arch: 'arm64',
        resolveNode: () => {
          throw new ToolchainResolutionError(
            'node',
            'unconfigured',
            'node toolchain is not configured'
          )
        }
      }).resolve()
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'toolchain_unavailable' })

    await expect(
      new OcrRuntimeAssetResolver({
        appPath,
        isPackaged: true,
        platform: 'darwin',
        arch: 'arm64',
        resolveNode: () => {
          throw new ToolchainResolutionError(
            'node',
            'version_mismatch',
            'Node version is outside the OCR compatibility range'
          )
        }
      }).resolve()
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'version_mismatch' })
  })

  it('classifies malformed manifest shapes as invalid instead of missing assets', async () => {
    const appPath = path.join(tempDir, 'resources', 'app.asar')
    const unpackedRoot = path.join(tempDir, 'resources', 'app.asar.unpacked')
    await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
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
      nativePackage,
      nativeArtifactInventory,
      paths: { node: null }
    })

    await expect(
      new OcrRuntimeAssetResolver({
        appPath,
        isPackaged: true,
        platform: 'darwin',
        arch: 'arm64'
      }).resolve()
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'runtime_manifest_invalid' })
  })

  it('recognizes Windows arm64 as a supported target', async () => {
    await expect(
      new OcrRuntimeAssetResolver({
        appPath: tempDir,
        isPackaged: true,
        platform: 'win32',
        arch: 'arm64'
      }).resolve()
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'assets_missing' })
  })

  it('recognizes Linux arm64 as a supported target', async () => {
    await expect(
      new OcrRuntimeAssetResolver({
        appPath: tempDir,
        isPackaged: true,
        platform: 'linux',
        arch: 'arm64'
      }).resolve()
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'assets_missing' })
  })

  it('resolves pnpm-compatible development package entrypoints', async () => {
    await writeJson(path.join(tempDir, 'package.json'), { name: 'fixture', type: 'module' })
    const { modelDir } = await seedAssetIdentity(tempDir)
    const nodeRuntimePath = path.join(tempDir, 'runtime', 'node')
    await writeText(path.join(nodeRuntimePath, 'bin', 'node'))
    await writeText(path.join(tempDir, 'out', 'main', 'lightOcrHelper.js'))

    const availability = await new OcrRuntimeAssetResolver({
      appPath: tempDir,
      isPackaged: false,
      platform: 'darwin',
      arch: 'arm64',
      nodeRuntimePath
    }).resolve()

    expect(availability).toMatchObject({
      status: 'available',
      assets: { bundlePath: await realpath(path.join(modelDir, 'bundle')) }
    })
  })
})
