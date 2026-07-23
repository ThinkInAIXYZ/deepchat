import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { materializeLightOcrNativePayload } from '../../../src/main/ocr/lightOcrNativePayload'

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

describe('Light OCR encoded native payload', () => {
  let tempDir: string
  let nativePackageDir: string
  let runtimeTempRoot: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-native-payload-test-'))
    nativePackageDir = path.join(tempDir, 'package')
    runtimeTempRoot = path.join(tempDir, 'runtime')
    await Promise.all([
      mkdir(path.join(nativePackageDir, 'native'), { recursive: true }),
      mkdir(runtimeTempRoot, { mode: 0o700 })
    ])
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function seedEncodedPackage() {
    const addon = Buffer.from('qualified-addon')
    const runtime = Buffer.from('qualified-runtime')
    const addonArtifact = {
      path: 'native/light_ocr_node.node',
      bytes: addon.byteLength,
      sha256: sha256(addon)
    }
    const runtimeArtifact = {
      path: 'native/libonnxruntime.1.22.0.dylib',
      bytes: runtime.byteLength,
      sha256: sha256(runtime)
    }
    const descriptor = Buffer.from(
      JSON.stringify({ addon: addonArtifact, runtime: { artifacts: [runtimeArtifact] } })
    )
    const descriptorArtifact = {
      path: 'native/runtime-descriptor.json',
      bytes: descriptor.byteLength,
      sha256: sha256(descriptor)
    }
    await Promise.all([
      writeFile(
        path.join(nativePackageDir, `${addonArtifact.path}.gz.b64`),
        gzipSync(addon).toString('base64')
      ),
      writeFile(
        path.join(nativePackageDir, `${runtimeArtifact.path}.gz.b64`),
        gzipSync(runtime).toString('base64')
      ),
      writeFile(path.join(nativePackageDir, descriptorArtifact.path), descriptor),
      writeFile(
        path.join(nativePackageDir, 'artifact-hashes.json'),
        JSON.stringify({ files: [addonArtifact, runtimeArtifact, descriptorArtifact] })
      )
    ])
    return { addon, runtime, addonArtifact, runtimeArtifact }
  }

  it('restores exact qualified bytes into a private runtime directory', async () => {
    const seeded = await seedEncodedPackage()

    const override = await materializeLightOcrNativePayload({
      nativePackageDir,
      tempRoot: runtimeTempRoot
    })

    await expect(readFile(override.nodeBinaryPath)).resolves.toEqual(seeded.addon)
    await expect(
      readFile(path.join(path.dirname(override.nodeBinaryPath), 'libonnxruntime.1.22.0.dylib'))
    ).resolves.toEqual(seeded.runtime)
    if (process.platform !== 'win32') {
      expect((await stat(override.nodeBinaryPath)).mode & 0o777).toBe(0o600)
    }
    expect(path.dirname(override.runtimeDescriptorPath)).toBe(path.dirname(override.nodeBinaryPath))
  })

  it('rejects corrupt encoded bytes before writing executable payloads', async () => {
    const seeded = await seedEncodedPackage()
    await writeFile(path.join(nativePackageDir, `${seeded.addonArtifact.path}.gz.b64`), 'invalid')

    await expect(
      materializeLightOcrNativePayload({ nativePackageDir, tempRoot: runtimeTempRoot })
    ).rejects.toThrow(/canonical base64/)
  })

  it('rejects ambiguous packages that still contain raw native code', async () => {
    const seeded = await seedEncodedPackage()
    await writeFile(path.join(nativePackageDir, seeded.addonArtifact.path), seeded.addon)

    await expect(
      materializeLightOcrNativePayload({ nativePackageDir, tempRoot: runtimeTempRoot })
    ).rejects.toThrow(/still contains raw native code/)
  })

  it('rejects artifact paths that escape the native package', async () => {
    const invalidArtifact = {
      path: 'native/../escape.node',
      bytes: 1,
      sha256: sha256('x')
    }
    await writeFile(
      path.join(nativePackageDir, 'artifact-hashes.json'),
      JSON.stringify({ files: [invalidArtifact] })
    )

    await expect(
      materializeLightOcrNativePayload({ nativePackageDir, tempRoot: runtimeTempRoot })
    ).rejects.toThrow(/Invalid Light OCR native artifact path/)
  })
})
