import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
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
      mkdir(path.join(nativePackageDir, 'pdfium'), { recursive: true }),
      mkdir(path.join(nativePackageDir, 'pdfium', 'fonts'), { recursive: true }),
      mkdir(runtimeTempRoot, { mode: 0o700 })
    ])
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function seedEncodedPackage() {
    const addon = Buffer.from('qualified-addon')
    const runtime = Buffer.from('qualified-runtime')
    const pdfiumLoader = Buffer.from('module.exports = require("./pdfium.node")')
    const pdfiumAddon = Buffer.from('qualified-pdfium-addon')
    const pdfiumLibrary = Buffer.from('qualified-pdfium-library')
    const fallbackFont = Buffer.from('qualified-font')
    const fontLicense = Buffer.from('font-license')
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
    const pdfiumLoaderArtifact = {
      path: 'pdfium/index.cjs',
      bytes: pdfiumLoader.byteLength,
      sha256: sha256(pdfiumLoader)
    }
    const pdfiumAddonArtifact = {
      path: 'pdfium/pdfium.node',
      bytes: pdfiumAddon.byteLength,
      sha256: sha256(pdfiumAddon)
    }
    const pdfiumLibraryArtifact = {
      path: 'pdfium/libpdfium.dylib',
      bytes: pdfiumLibrary.byteLength,
      sha256: sha256(pdfiumLibrary)
    }
    const fallbackFontArtifact = {
      path: 'pdfium/fonts/NotoSansSC-Regular.otf',
      bytes: fallbackFont.byteLength,
      sha256: sha256(fallbackFont)
    }
    const fontLicenseArtifact = {
      path: 'pdfium/fonts/OFL.txt',
      bytes: fontLicense.byteLength,
      sha256: sha256(fontLicense)
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
      writeFile(
        path.join(nativePackageDir, `${pdfiumAddonArtifact.path}.gz.b64`),
        gzipSync(pdfiumAddon).toString('base64')
      ),
      writeFile(
        path.join(nativePackageDir, `${pdfiumLibraryArtifact.path}.gz.b64`),
        gzipSync(pdfiumLibrary).toString('base64')
      ),
      writeFile(path.join(nativePackageDir, fallbackFontArtifact.path), fallbackFont),
      writeFile(path.join(nativePackageDir, fontLicenseArtifact.path), fontLicense),
      writeFile(path.join(nativePackageDir, descriptorArtifact.path), descriptor),
      writeFile(path.join(nativePackageDir, pdfiumLoaderArtifact.path), pdfiumLoader),
      writeFile(
        path.join(nativePackageDir, 'artifact-hashes.json'),
        JSON.stringify({
          files: [
            addonArtifact,
            runtimeArtifact,
            descriptorArtifact,
            pdfiumLoaderArtifact,
            pdfiumAddonArtifact,
            pdfiumLibraryArtifact,
            fallbackFontArtifact,
            fontLicenseArtifact
          ]
        })
      )
    ])
    return {
      addon,
      runtime,
      pdfiumLoader,
      pdfiumAddon,
      pdfiumLibrary,
      fallbackFont,
      fontLicense,
      addonArtifact,
      runtimeArtifact,
      fallbackFontArtifact
    }
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
    await expect(readFile(override.pdfiumModulePath)).resolves.toEqual(seeded.pdfiumLoader)
    await expect(
      readFile(path.join(path.dirname(override.pdfiumModulePath), 'pdfium.node'))
    ).resolves.toEqual(seeded.pdfiumAddon)
    await expect(
      readFile(path.join(path.dirname(override.pdfiumModulePath), 'libpdfium.dylib'))
    ).resolves.toEqual(seeded.pdfiumLibrary)
    await expect(
      readFile(
        path.join(path.dirname(override.pdfiumModulePath), 'fonts', 'NotoSansSC-Regular.otf')
      )
    ).resolves.toEqual(seeded.fallbackFont)
    await expect(
      readFile(path.join(path.dirname(override.pdfiumModulePath), 'fonts', 'OFL.txt'))
    ).resolves.toEqual(seeded.fontLicense)
    expect(path.dirname(override.pdfiumModulePath)).toContain(`${path.sep}pdfium`)
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

  it('rejects corrupt PDFium fallback font bytes', async () => {
    const seeded = await seedEncodedPackage()
    await writeFile(
      path.join(nativePackageDir, seeded.fallbackFontArtifact.path),
      Buffer.alloc(seeded.fallbackFont.byteLength, 0x78)
    )

    await expect(
      materializeLightOcrNativePayload({ nativePackageDir, tempRoot: runtimeTempRoot })
    ).rejects.toThrow(/integrity mismatch/)
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked PDFium fallback font', async () => {
    const seeded = await seedEncodedPackage()
    const fallbackFontPath = path.join(nativePackageDir, seeded.fallbackFontArtifact.path)
    const symlinkTarget = path.join(tempDir, 'fallback-font.otf')
    await writeFile(symlinkTarget, seeded.fallbackFont)
    await rm(fallbackFontPath)
    await symlink(symlinkTarget, fallbackFontPath)

    await expect(
      materializeLightOcrNativePayload({ nativePackageDir, tempRoot: runtimeTempRoot })
    ).rejects.toThrow(/not a bounded regular file/)
  })

  it('rejects PDFium resources above the aggregate materialization limit', async () => {
    await seedEncodedPackage()
    const manifestPath = path.join(nativePackageDir, 'artifact-hashes.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      files: Array<{ path: string; bytes: number }>
    }
    const fallbackFont = manifest.files.find(
      (entry) => entry.path === 'pdfium/fonts/NotoSansSC-Regular.otf'
    )
    expect(fallbackFont).toBeDefined()
    fallbackFont!.bytes = 16 * 1024 * 1024
    await writeFile(manifestPath, JSON.stringify(manifest))

    await expect(
      materializeLightOcrNativePayload({ nativePackageDir, tempRoot: runtimeTempRoot })
    ).rejects.toThrow(/PDFium resources exceed their materialized size limit/)
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

  it('rejects an incomplete PDFium inventory before materializing code', async () => {
    await seedEncodedPackage()
    await rm(path.join(nativePackageDir, 'pdfium', 'libpdfium.dylib.gz.b64'))
    const manifestPath = path.join(nativePackageDir, 'artifact-hashes.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      files: Array<{ path: string }>
    }
    manifest.files = manifest.files.filter((entry) => entry.path !== 'pdfium/libpdfium.dylib')
    await writeFile(manifestPath, JSON.stringify(manifest))

    await expect(
      materializeLightOcrNativePayload({ nativePackageDir, tempRoot: runtimeTempRoot })
    ).rejects.toThrow(/PDFium artifact inventory/)
  })
})
