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

const packageDir = (nodeModulesDir: string, packageName: string) =>
  path.join(nodeModulesDir, ...packageName.split('/'))

const writePackage = async (
  nodeModulesDir: string,
  packageName: string,
  files: Record<string, string> = {}
) => {
  const dir = packageDir(nodeModulesDir, packageName)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'package.json'), `{"name":"${packageName}"}`)
  for (const [relativePath, body] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, body)
  }
}

const writeVirtualPackage = async (
  projectDir: string,
  packageName: string,
  files: Record<string, string> = {}
) => {
  await writePackage(path.join(projectDir, 'node_modules', '.pnpm', 'node_modules'), packageName, files)
}

const writeUnpackedPackage = async (
  nodeModulesDir: string,
  packageName: string,
  files: Record<string, string> = {}
) => {
  await writePackage(nodeModulesDir, packageName, files)
}

const seedDarwinNativePrerequisites = async (
  projectDir: string,
  nodeModulesDir: string,
  archName: 'arm64' | 'x64'
) => {
  const fffPackageDir = `fff-bin-darwin-${archName}`
  const parcelPackageDir = `watcher-darwin-${archName}`
  const opendalPackageDir = `lib-darwin-${archName}`

  await writeVirtualPackage(projectDir, `@ff-labs/${fffPackageDir}`, {
    'libfff_c.dylib': 'native'
  })
  await writeVirtualPackage(projectDir, `@parcel/${parcelPackageDir}`, {
    'watcher.node': 'parcel-native'
  })
  await writeVirtualPackage(projectDir, `@opendal/${opendalPackageDir}`, {
    [`opendal.darwin-${archName}.node`]: 'opendal-native'
  })
  await writeUnpackedPackage(nodeModulesDir, '@ff-labs/fff-node')
  await writeUnpackedPackage(nodeModulesDir, '@parcel/watcher')
  await writeUnpackedPackage(nodeModulesDir, 'opendal', {
    'index.cjs': 'module.exports = {}'
  })

  return { fffPackageDir, parcelPackageDir, opendalPackageDir }
}

const seedLinuxNativePrerequisites = async (projectDir: string, nodeModulesDir: string) => {
  await writeVirtualPackage(projectDir, '@ff-labs/fff-bin-linux-x64-gnu', {
    'libfff_c.so': 'native'
  })
  await writeVirtualPackage(projectDir, '@parcel/watcher-linux-x64-glibc', {
    'watcher.node': 'parcel-native'
  })
  await writeUnpackedPackage(nodeModulesDir, '@ff-labs/fff-node')
  await writeUnpackedPackage(nodeModulesDir, '@parcel/watcher')
  await writeUnpackedPackage(nodeModulesDir, 'opendal', {
    'index.cjs': 'module.exports = {}'
  })
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
    ['arm64', 3],
    ['x64', 1]
  ] as const)('copies native packages into unpacked mac %s app node_modules', async (archName, arch) => {
    const afterPack = await loadAfterPack()
    const projectDir = path.join(tmpDir, 'project')
    const nodeModulesDir = path.join(
      tmpDir,
      'DeepChat.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules'
    )
    const { fffPackageDir, parcelPackageDir, opendalPackageDir } =
      await seedDarwinNativePrerequisites(projectDir, nodeModulesDir, archName)

    await writeFile(path.join(tmpDir, 'DeepChat'), 'launcher')

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
    await expect(
      readFile(
        path.join(nodeModulesDir, '@opendal', opendalPackageDir, `opendal.darwin-${archName}.node`),
        'utf8'
      )
    ).resolves.toBe('opendal-native')
  })

  it('copies OpenDAL Linux x64 native package into unpacked app node_modules', async () => {
    const afterPack = await loadAfterPack()
    const projectDir = path.join(tmpDir, 'project')
    const nodeModulesDir = path.join(tmpDir, 'resources', 'app.asar.unpacked', 'node_modules')

    await seedLinuxNativePrerequisites(projectDir, nodeModulesDir)
    await writeVirtualPackage(projectDir, '@opendal/lib-linux-x64-gnu', {
      'opendal.linux-x64-gnu.node': 'opendal-native'
    })

    await afterPack({
      targets: [],
      appOutDir: tmpDir,
      electronPlatformName: 'linux',
      arch: 'x64',
      packager: {
        projectDir
      }
    })

    await expect(
      readFile(
        path.join(nodeModulesDir, '@opendal', 'lib-linux-x64-gnu', 'opendal.linux-x64-gnu.node'),
        'utf8'
      )
    ).resolves.toBe('opendal-native')
  })

  it('fails fast when the target OpenDAL native package is missing', async () => {
    const afterPack = await loadAfterPack()
    const projectDir = path.join(tmpDir, 'project')
    const nodeModulesDir = path.join(tmpDir, 'resources', 'app.asar.unpacked', 'node_modules')

    await seedLinuxNativePrerequisites(projectDir, nodeModulesDir)

    await expect(
      afterPack({
        targets: [],
        appOutDir: tmpDir,
        electronPlatformName: 'linux',
        arch: 'x64',
        packager: {
          projectDir
        }
      })
    ).rejects.toThrow('Unable to find installed native package: @opendal/lib-linux-x64-gnu')
  })

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
