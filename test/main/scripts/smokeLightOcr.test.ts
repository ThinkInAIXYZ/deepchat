import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, default: actual }
})

import {
  assertFixtureRecognized,
  normalizeArch,
  normalizePlatform,
  parseArgs,
  resolvePackagedOcrLayout
} from '../../../scripts/smoke-light-ocr.js'

const runtimeVersions = {
  node: 'v24.14.1',
  lightOcr: {
    version: '0.3.0',
    bundleId: 'ppocrv6-small-native-20260719.1',
    modelPackage: '@arcships/light-ocr-model-ppocrv6-small',
    nativePackages: {
      'darwin-arm64': '@arcships/light-ocr-darwin-arm64',
      'darwin-x64': '@arcships/light-ocr-darwin-x64',
      'linux-x64': '@arcships/light-ocr-linux-x64-gnu',
      'win32-x64': '@arcships/light-ocr-win32-x64'
    }
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

async function writeTree(root: string, files: Record<string, string>) {
  for (const [relativePath, body] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, body)
  }
}

describe('smoke-light-ocr', () => {
  let tempDir: string
  let resourcesPath: string
  let unpackedRoot: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-smoke-test-'))
    resourcesPath = path.join(tempDir, 'resources')
    unpackedRoot = path.join(resourcesPath, 'app.asar.unpacked')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('parses strict target and threshold arguments', () => {
    expect(
      parseArgs([
        '--resources-path',
        '/app/resources',
        '--platform=macos',
        '--arch',
        'aarch64',
        '--require-execution'
      ])
    ).toEqual({
      'resources-path': '/app/resources',
      platform: 'macos',
      arch: 'aarch64',
      'require-execution': true
    })
    expect(normalizePlatform('macos')).toBe('darwin')
    expect(normalizeArch('amd64')).toBe('x64')
    expect(() => parseArgs(['--resources-path'])).toThrow(/Missing value/)
    expect(() => parseArgs(['--unknown', 'value'])).toThrow(/Unknown/)
  })

  it('validates identities and checksums for a supported packaged target', async () => {
    const facadeDir = path.join(unpackedRoot, 'node_modules/@arcships/light-ocr')
    const modelDir = path.join(
      unpackedRoot,
      'node_modules/@arcships/light-ocr-model-ppocrv6-small'
    )
    const nativeDir = path.join(unpackedRoot, 'node_modules/@arcships/light-ocr-darwin-arm64')
    const modelManifest = JSON.stringify({ bundleId: runtimeVersions.lightOcr.bundleId })
    const modelPayload = 'model-payload'
    const nativePayload = 'native-payload'
    const nativeDescriptor = '{}'

    await writeTree(unpackedRoot, {
      'runtime/node/bin/node': 'node',
      'out/main/lightOcrHelper.js': 'helper',
      'node_modules/@arcships/light-ocr/package.json': JSON.stringify({
        name: '@arcships/light-ocr',
        version: '0.3.0'
      }),
      'node_modules/@arcships/light-ocr/js/index.cjs': 'module.exports = {}',
      'node_modules/@arcships/light-ocr-model-ppocrv6-small/package.json': JSON.stringify({
        name: runtimeVersions.lightOcr.modelPackage,
        version: '0.3.0'
      }),
      'node_modules/@arcships/light-ocr-model-ppocrv6-small/bundle/manifest.json': modelManifest,
      'node_modules/@arcships/light-ocr-model-ppocrv6-small/bundle/model.bin': modelPayload,
      'node_modules/@arcships/light-ocr-model-ppocrv6-small/bundle/SHA256SUMS': [
        `${sha256(modelManifest)}  manifest.json`,
        `${sha256(modelPayload)}  model.bin`
      ].join('\n'),
      'node_modules/@arcships/light-ocr-darwin-arm64/package.json': JSON.stringify({
        name: '@arcships/light-ocr-darwin-arm64',
        version: '0.3.0'
      }),
      'node_modules/@arcships/light-ocr-darwin-arm64/native/addon.node': nativePayload,
      'node_modules/@arcships/light-ocr-darwin-arm64/native/runtime-descriptor.json':
        nativeDescriptor,
      'node_modules/@arcships/light-ocr-darwin-arm64/artifact-hashes.json': JSON.stringify({
        files: [
          {
            path: 'native/addon.node',
            bytes: Buffer.byteLength(nativePayload),
            sha256: sha256(nativePayload)
          },
          {
            path: 'native/runtime-descriptor.json',
            bytes: Buffer.byteLength(nativeDescriptor),
            sha256: sha256(nativeDescriptor)
          }
        ]
      }),
      'runtime/ocr/manifest.json': JSON.stringify({
        schemaVersion: 1,
        supported: true,
        platform: 'darwin',
        arch: 'arm64',
        lightOcrVersion: '0.3.0',
        bundleId: runtimeVersions.lightOcr.bundleId,
        nativePackage: '@arcships/light-ocr-darwin-arm64',
        paths: {
          node: 'runtime/node/bin/node',
          helper: 'out/main/lightOcrHelper.js',
          facade: 'node_modules/@arcships/light-ocr',
          bundle: 'node_modules/@arcships/light-ocr-model-ppocrv6-small/bundle',
          native: 'node_modules/@arcships/light-ocr-darwin-arm64'
        }
      })
    })

    const layout = await resolvePackagedOcrLayout({
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
      runtimeVersions
    })

    expect(layout).toMatchObject({
      supported: true,
      facadeDir,
      modelPackageDir: modelDir,
      nativePackageDir: nativeDir,
      nativePackage: '@arcships/light-ocr-darwin-arm64'
    })
  })

  it('rejects a manifest path that escapes the packaged app root', async () => {
    await writeTree(unpackedRoot, {
      'runtime/ocr/manifest.json': JSON.stringify({
        schemaVersion: 1,
        supported: true,
        platform: 'darwin',
        arch: 'arm64',
        lightOcrVersion: '0.3.0',
        bundleId: runtimeVersions.lightOcr.bundleId,
        nativePackage: '@arcships/light-ocr-darwin-arm64',
        paths: {
          node: '../node',
          helper: 'out/main/lightOcrHelper.js',
          facade: 'node_modules/@arcships/light-ocr',
          bundle: 'node_modules/@arcships/light-ocr-model-ppocrv6-small/bundle',
          native: 'node_modules/@arcships/light-ocr-darwin-arm64'
        }
      })
    })

    await expect(
      resolvePackagedOcrLayout({
        resourcesPath,
        platform: 'darwin',
        arch: 'arm64',
        runtimeVersions
      })
    ).rejects.toThrow(/escapes/)
  })

  it('accepts unsupported targets only when OCR executable assets are absent', async () => {
    await writeTree(unpackedRoot, {
      'runtime/ocr/manifest.json': JSON.stringify({
        schemaVersion: 1,
        supported: false,
        reason: 'unsupported_platform',
        platform: 'win32',
        arch: 'arm64',
        lightOcrVersion: '0.3.0',
        bundleId: runtimeVersions.lightOcr.bundleId
      })
    })

    await expect(
      resolvePackagedOcrLayout({
        resourcesPath,
        platform: 'win32',
        arch: 'arm64',
        runtimeVersions
      })
    ).resolves.toMatchObject({ supported: false })

    await writeTree(unpackedRoot, { 'out/main/lightOcrHelper.js': 'helper' })
    await expect(
      resolvePackagedOcrLayout({
        resourcesPath,
        platform: 'win32',
        arch: 'arm64',
        runtimeVersions
      })
    ).rejects.toThrow(/still contains the helper/)
  })

  it('requires stable fixture anchors without exposing recognized text', () => {
    expect(() =>
      assertFixtureRecognized({ lines: [{ text: 'DeepChat' }, { text: 'OCR TEST 2026' }] })
    ).not.toThrow()
    expect(() => assertFixtureRecognized({ lines: [{ text: 'unrelated' }] })).toThrow(
      /did not recognize/
    )
  })
})
