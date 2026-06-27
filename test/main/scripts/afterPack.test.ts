import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { gunzipSync } from 'zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadAfterPack = async () => {
  return (await import('../../../scripts/afterPack.js')).default as (context: {
    targets: Array<{ name: string }>
    appOutDir: string
    electronPlatformName: string
    arch?: number | string
    packager?: {
      projectDir?: string
      appInfo?: {
        productFilename?: string
      }
    }
  }) => Promise<void>
}

describe('afterPack', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-after-pack-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('keeps non-Linux packages unchanged', async () => {
    const afterPack = await loadAfterPack()
    const launcherPath = path.join(tmpDir, 'DeepChat')
    await writeFile(launcherPath, 'launcher')

    await afterPack({
      targets: [],
      appOutDir: tmpDir,
      electronPlatformName: 'darwin'
    })

    await expect(stat(launcherPath)).resolves.toBeTruthy()
    await expect(readFile(launcherPath, 'utf8')).resolves.toBe('launcher')
  })

  it('adds the Linux no-sandbox wrapper for AppImage builds', async () => {
    const afterPack = await loadAfterPack()
    const launcherPath = path.join(tmpDir, 'deepchat')
    await writeFile(launcherPath, '#!/bin/bash\n')

    await afterPack({
      targets: [{ name: 'AppImage' }],
      appOutDir: tmpDir,
      electronPlatformName: 'linux'
    })

    await expect(stat(path.join(tmpDir, 'deepchat.bin'))).resolves.toBeTruthy()
    await expect(readFile(launcherPath, 'utf8')).resolves.toContain('--no-sandbox')
  })

  it('encodes macOS DuckDB VSS into a non-executable packaged asset', async () => {
    const afterPack = await loadAfterPack()
    const extensionPath = path.join(
      tmpDir,
      'DeepChat.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'runtime',
      'duckdb',
      'extensions',
      'vss.duckdb_extension'
    )
    const extensionBody = Buffer.from('duckdb extension with footer')
    await mkdir(path.dirname(extensionPath), { recursive: true })
    await writeFile(extensionPath, extensionBody)

    await afterPack({
      targets: [],
      appOutDir: tmpDir,
      electronPlatformName: 'darwin',
      packager: {
        appInfo: {
          productFilename: 'DeepChat'
        }
      }
    })

    await expect(stat(extensionPath)).rejects.toThrow()
    const asset = await readFile(`${extensionPath}.b64`)
    expect(asset.subarray(0, 2)).not.toEqual(Buffer.from([0x1f, 0x8b]))
    expect(asset.subarray(0, 4)).not.toEqual(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))
    expect(asset.subarray(0, 4)).not.toEqual(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
    const compressed = Buffer.from(asset.toString('utf8'), 'base64')
    expect(gunzipSync(compressed)).toEqual(extensionBody)
  })

  it.each([
    ['arm64', 3, 'fff-bin-darwin-arm64', 'watcher-darwin-arm64'],
    ['x64', 1, 'fff-bin-darwin-x64', 'watcher-darwin-x64']
  ])(
    'copies native packages into unpacked mac %s app node_modules',
    async (_, arch, fffPackageDir, parcelPackageDir) => {
      const afterPack = await loadAfterPack()
      const projectDir = path.join(tmpDir, 'project')
      const fffSourceDir = path.join(
        projectDir,
        'node_modules',
        '.pnpm',
        'node_modules',
        '@ff-labs',
        fffPackageDir
      )
      const parcelSourceDir = path.join(
        projectDir,
        'node_modules',
        '.pnpm',
        'node_modules',
        '@parcel',
        parcelPackageDir
      )
      const nodeModulesDir = path.join(
        tmpDir,
        'DeepChat.app',
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules'
      )

      await writeFile(path.join(tmpDir, 'DeepChat'), 'launcher')
      await mkdir(fffSourceDir, { recursive: true })
      await mkdir(parcelSourceDir, { recursive: true })
      await mkdir(path.join(nodeModulesDir, '@ff-labs', 'fff-node'), { recursive: true })
      await mkdir(path.join(nodeModulesDir, '@parcel', 'watcher'), { recursive: true })
      await writeFile(
        path.join(fffSourceDir, 'package.json'),
        `{"name":"@ff-labs/${fffPackageDir}"}`
      )
      await writeFile(
        path.join(parcelSourceDir, 'package.json'),
        `{"name":"@parcel/${parcelPackageDir}"}`
      )
      await writeFile(path.join(fffSourceDir, 'libfff_c.dylib'), 'native')
      await writeFile(path.join(parcelSourceDir, 'watcher.node'), 'parcel-native')
      await writeFile(path.join(nodeModulesDir, '@ff-labs', 'fff-node', 'package.json'), '{}')
      await writeFile(path.join(nodeModulesDir, '@parcel', 'watcher', 'package.json'), '{}')

      await afterPack({
        targets: [],
        appOutDir: tmpDir,
        electronPlatformName: 'darwin',
        arch,
        packager: {
          projectDir,
          appInfo: {
            productFilename: 'DeepChat'
          }
        }
      })

      await expect(
        readFile(path.join(nodeModulesDir, '@ff-labs', fffPackageDir, 'libfff_c.dylib'), 'utf8')
      ).resolves.toBe('native')
      await expect(
        readFile(path.join(nodeModulesDir, '@parcel', parcelPackageDir, 'watcher.node'), 'utf8')
      ).resolves.toBe('parcel-native')
    }
  )

  it('fails fast when FFF node output is missing for supported packages', async () => {
    const afterPack = await loadAfterPack()
    const expectedFffNodeDir = path.join(
      tmpDir,
      'DeepChat.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      '@ff-labs',
      'fff-node'
    )

    await expect(
      afterPack({
        targets: [],
        appOutDir: tmpDir,
        electronPlatformName: 'darwin',
        arch: 3,
        packager: {
          projectDir: path.join(tmpDir, 'project'),
          appInfo: {
            productFilename: 'DeepChat'
          }
        }
      })
    ).rejects.toThrow(`Missing unpacked @ff-labs/fff-node at ${expectedFffNodeDir}`)
  })
})
