import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { OcrRuntimeAssetResolver } from '../../../src/main/ocr/ocrRuntimeAssetResolver'

const lightOcrVersion = '0.3.4'
const bundleId = 'ppocrv6-small-native-20260719.1'
const modelPackage = '@arcships/light-ocr-model-ppocrv6-small'
const nativePackage = '@arcships/light-ocr-darwin-arm64'

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
  const modelDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-model-ppocrv6-small')
  const nativeDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-darwin-arm64')
  await writeJson(path.join(facadeDir, 'package.json'), {
    name: '@arcships/light-ocr',
    version: lightOcrVersion,
    main: 'js/index.cjs'
  })
  await writeText(path.join(facadeDir, 'js', 'index.cjs'))
  await writeJson(path.join(modelDir, 'package.json'), {
    name: modelPackage,
    version: lightOcrVersion,
    exports: { './bundle/manifest.json': './bundle/manifest.json' }
  })
  await writeJson(path.join(modelDir, 'bundle', 'manifest.json'), { bundleId })
  await writeJson(path.join(nativeDir, 'package.json'), {
    name: nativePackage,
    version: lightOcrVersion,
    main: 'native/light_ocr_node.node'
  })
  await writeJson(path.join(nativeDir, 'artifact-hashes.json'), { files: [] })
  await writeText(path.join(nativeDir, 'native', 'light_ocr_node.node'))
  await writeJson(path.join(nativeDir, 'native', 'runtime-descriptor.json'), {})
  return { facadeDir, modelDir, nativeDir }
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
    const { facadeDir, modelDir, nativeDir } = await seedAssetIdentity(unpackedRoot)
    await writeText(path.join(unpackedRoot, 'runtime', 'node', 'bin', 'node'))
    await writeText(path.join(unpackedRoot, 'out', 'main', 'lightOcrHelper.js'))
    await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
      schemaVersion: 2,
      supported: true,
      platform: 'darwin',
      arch: 'arm64',
      lightOcrVersion,
      bundleId,
      nativePayloadEncoding: 'gzip-base64-v1',
      nativePackage,
      paths: {
        node: 'runtime/node/bin/node',
        helper: 'out/main/lightOcrHelper.js',
        facade: path.relative(unpackedRoot, facadeDir),
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
  })

  it.each(['..', '../../outside'])(
    'rejects %s path traversal in packaged manifests',
    async (bundle) => {
      const appPath = path.join(tempDir, 'resources', 'app.asar')
      const unpackedRoot = path.join(tempDir, 'resources', 'app.asar.unpacked')
      await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
        schemaVersion: 2,
        supported: true,
        platform: 'darwin',
        arch: 'arm64',
        lightOcrVersion,
        bundleId,
        nativePayloadEncoding: 'gzip-base64-v1',
        nativePackage,
        paths: {
          node: 'runtime/node/bin/node',
          helper: 'out/main/lightOcrHelper.js',
          facade: 'node_modules/@arcships/light-ocr',
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
    const { facadeDir, modelDir, nativeDir } = await seedAssetIdentity(unpackedRoot)
    await writeJson(path.join(facadeDir, 'package.json'), {
      name: '@arcships/light-ocr',
      version: '0.3.3',
      main: 'js/index.cjs'
    })
    await writeText(path.join(unpackedRoot, 'runtime', 'node', 'bin', 'node'))
    await writeText(path.join(unpackedRoot, 'out', 'main', 'lightOcrHelper.js'))
    await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
      schemaVersion: 2,
      supported: true,
      platform: 'darwin',
      arch: 'arm64',
      lightOcrVersion,
      bundleId,
      nativePayloadEncoding: 'gzip-base64-v1',
      nativePackage,
      paths: {
        node: 'runtime/node/bin/node',
        helper: 'out/main/lightOcrHelper.js',
        facade: path.relative(unpackedRoot, facadeDir),
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

  it('classifies malformed manifest shapes as invalid instead of missing assets', async () => {
    const appPath = path.join(tempDir, 'resources', 'app.asar')
    const unpackedRoot = path.join(tempDir, 'resources', 'app.asar.unpacked')
    await writeJson(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), {
      schemaVersion: 2,
      supported: true,
      platform: 'darwin',
      arch: 'arm64',
      lightOcrVersion,
      bundleId,
      nativePayloadEncoding: 'gzip-base64-v1',
      nativePackage,
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
