import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { gunzipSync } from 'zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, default: actual }
})

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

const loadPackageLightOcrAssets = async () => {
  return (await import('../../../scripts/afterPack.js')).packageLightOcrAssets as (context: {
    appOutDir: string
    electronPlatformName: string
    arch?: number | string
    packager?: {
      projectDir?: string
      appInfo?: { productFilename?: string }
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

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const testRuntimeVersions = {
  schemaVersion: 2,
  node: 'v24.14.1',
  nodeArtifacts: Object.fromEntries(
    [
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64'
    ].map((target) => [
      target,
      {
        executableSha256: sha256('node')
      }
    ])
  ),
  lightOcr: {
    version: '0.3.4',
    modelPackage: '@arcships/light-ocr-model-ppocrv6-small',
    bundleId: 'ppocrv6-small-native-20260719.1',
    nativePackages: {
      'darwin-arm64': '@arcships/light-ocr-darwin-arm64',
      'darwin-x64': '@arcships/light-ocr-darwin-x64',
      'linux-arm64': '@arcships/light-ocr-linux-arm64-gnu',
      'linux-x64': '@arcships/light-ocr-linux-x64-gnu',
      'win32-arm64': '@arcships/light-ocr-win32-arm64',
      'win32-x64': '@arcships/light-ocr-win32-x64'
    }
  }
}

const writeTestRuntimeVersions = async (projectDir: string) => {
  await mkdir(path.join(projectDir, 'resources'), { recursive: true })
  await writeFile(
    path.join(projectDir, 'resources', 'runtime-versions.json'),
    JSON.stringify(testRuntimeVersions)
  )
}

const lightOcrNativePackage = (platform: string, arch: string) => {
  if (platform === 'darwin') return `@arcships/light-ocr-darwin-${arch}`
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    return `@arcships/light-ocr-linux-${arch}-gnu`
  }
  if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) {
    return `@arcships/light-ocr-win32-${arch}`
  }
  throw new Error(`Unsupported test OCR target: ${platform}/${arch}`)
}

const seedLightOcrPrerequisites = async (
  projectDir: string,
  nodeModulesDir: string,
  platform: string,
  arch: string
) => {
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ dependencies: { '@arcships/light-ocr': '0.3.4' } })
  )
  await writeTestRuntimeVersions(projectDir)
  const virtualNodeModules = path.join(projectDir, 'node_modules', '.pnpm', 'node_modules')
  const modelPackage = '@arcships/light-ocr-model-ppocrv6-small'
  const nativePackage = lightOcrNativePackage(platform, arch)
  const bundleManifest = `${JSON.stringify({ bundleId: 'ppocrv6-small-native-20260719.1' })}\n`
  const modelPayload = 'model-payload'
  const modelNotice = 'model notice'
  const checksums = [
    `${sha256(bundleManifest)}  manifest.json`,
    `${sha256(modelPayload)}  payload.bin`,
    `${sha256(modelNotice)}  LICENSES/MODEL-NOTICE.md`
  ].join('\n')
  const nativePayload = 'native-payload'
  const nativeDescriptor = '{}'
  const nativePackageJson = `${JSON.stringify({ name: nativePackage, version: '0.3.4' })}`

  await writeVirtualPackage(projectDir, '@arcships/light-ocr', {
    'package.json': JSON.stringify({ name: '@arcships/light-ocr', version: '0.3.4' }),
    LICENSE: 'facade license',
    NOTICE: 'facade notice',
    'js/index.cjs': 'module.exports = {}'
  })
  await writeVirtualPackage(projectDir, modelPackage, {
    'package.json': JSON.stringify({ name: modelPackage, version: '0.3.4' }),
    LICENSE: 'model license',
    NOTICE: 'model package notice',
    'bundle/manifest.json': bundleManifest,
    'bundle/payload.bin': modelPayload,
    'bundle/SHA256SUMS': `${checksums}\n`,
    'bundle/LICENSES/MODEL-NOTICE.md': modelNotice,
    'bundle/LICENSES/PaddleOCR-Apache-2.0.txt': 'model license'
  })
  await writeVirtualPackage(projectDir, nativePackage, {
    'package.json': nativePackageJson,
    LICENSE: 'native license',
    NOTICE: 'native notice',
    'licenses/dependency.txt': 'dependency license',
    'native/addon.node': nativePayload,
    'native/runtime-descriptor.json': nativeDescriptor,
    'artifact-hashes.json': JSON.stringify({
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
    })
  })

  const unpackedRoot = path.dirname(nodeModulesDir)
  const nodePath =
    platform === 'win32'
      ? path.join(unpackedRoot, 'runtime', 'node', 'node.exe')
      : path.join(unpackedRoot, 'runtime', 'node', 'bin', 'node')
  await mkdir(path.dirname(nodePath), { recursive: true })
  await writeFile(nodePath, 'node')
  await mkdir(path.join(projectDir, 'out', 'main'), { recursive: true })
  await writeFile(path.join(projectDir, 'out', 'main', 'lightOcrHelper.js'), 'helper')

  return {
    modelSourceDir: packageDir(virtualNodeModules, modelPackage),
    nativeSourceDir: packageDir(virtualNodeModules, nativePackage),
    nativePackage
  }
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
  await seedLightOcrPrerequisites(projectDir, nodeModulesDir, 'darwin', archName)

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
  await seedLightOcrPrerequisites(projectDir, nodeModulesDir, 'linux', 'x64')
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
    await expect(
      readFile(path.join(nodeModulesDir, '@arcships', 'light-ocr', 'NOTICE'), 'utf8')
    ).resolves.toBe('facade notice')
    const manifest = JSON.parse(
      await readFile(
        path.join(
          tmpDir,
          'DeepChat.app',
          'Contents',
          'Resources',
          'app.asar.unpacked',
          'runtime',
          'ocr',
          'manifest.json'
        ),
        'utf8'
      )
    )
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      supported: true,
      nodeVersion: 'v24.14.1',
      nodeSha256: sha256('node'),
      nativePayloadEncoding: 'gzip-base64-v1'
    })
    const lightOcrNativeDir = path.join(nodeModulesDir, '@arcships', `light-ocr-darwin-${archName}`)
    const rawAddonPath = path.join(lightOcrNativeDir, 'native', 'addon.node')
    await expect(stat(rawAddonPath)).rejects.toThrow()
    const encodedAddon = await readFile(`${rawAddonPath}.gz.b64`, 'utf8')
    expect(gunzipSync(Buffer.from(encodedAddon, 'base64')).toString('utf8')).toBe('native-payload')
    if (process.platform !== 'win32') {
      expect((await stat(`${rawAddonPath}.gz.b64`)).mode & 0o777).toBe(0o644)
    }
    await expect(
      readFile(path.join(lightOcrNativeDir, 'native', 'runtime-descriptor.json'), 'utf8')
    ).resolves.toBe('{}')
  })

  it('copies the standalone OCR helper relative import closure', async () => {
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
    await seedDarwinNativePrerequisites(projectDir, nodeModulesDir, 'arm64')
    await mkdir(path.join(projectDir, 'out', 'main', 'chunks'), { recursive: true })
    await writeFile(
      path.join(projectDir, 'out', 'main', 'lightOcrHelper.js'),
      `import { protocol } from './chunks/protocol.js'\nconsole.log(protocol)\n`
    )
    await writeFile(
      path.join(projectDir, 'out', 'main', 'chunks', 'protocol.js'),
      `export { protocol } from './value.js'\n`
    )
    await writeFile(
      path.join(projectDir, 'out', 'main', 'chunks', 'value.js'),
      `export const protocol = 1\n`
    )

    await afterPack({
      targets: [],
      appOutDir: tmpDir,
      electronPlatformName: 'darwin',
      arch: 3,
      packager: {
        projectDir,
        appInfo: { productFilename: 'DeepChat' }
      }
    })

    const unpackedMain = path.join(
      tmpDir,
      'DeepChat.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'out',
      'main'
    )
    await expect(readFile(path.join(unpackedMain, 'lightOcrHelper.js'), 'utf8')).resolves.toContain(
      './chunks/protocol.js'
    )
    await expect(readFile(path.join(unpackedMain, 'chunks', 'protocol.js'), 'utf8')).resolves.toContain(
      './value.js'
    )
    await expect(readFile(path.join(unpackedMain, 'chunks', 'value.js'), 'utf8')).resolves.toContain(
      'protocol = 1'
    )
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
    await expect(
      readFile(
        path.join(nodeModulesDir, '@arcships', 'light-ocr-linux-x64-gnu', 'native', 'addon.node'),
        'utf8'
      )
    ).resolves.toBe('native-payload')
    const manifest = JSON.parse(
      await readFile(
        path.join(tmpDir, 'resources', 'app.asar.unpacked', 'runtime', 'ocr', 'manifest.json'),
        'utf8'
      )
    )
    expect(manifest).toMatchObject({ schemaVersion: 2, nativePayloadEncoding: 'direct' })
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
    ).rejects.toThrow('Unable to find installed package: @opendal/lib-linux-x64-gnu')
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

  it('packages OCR assets for Windows arm64', async () => {
    const packageLightOcrAssets = await loadPackageLightOcrAssets()
    const projectDir = path.join(tmpDir, 'project')
    const unpackedRoot = path.join(tmpDir, 'resources', 'app.asar.unpacked')
    const nodeModulesDir = path.join(unpackedRoot, 'node_modules')
    await seedLightOcrPrerequisites(projectDir, nodeModulesDir, 'win32', 'arm64')

    await packageLightOcrAssets({
      appOutDir: tmpDir,
      electronPlatformName: 'win32',
      arch: 'arm64',
      packager: { projectDir }
    })

    await expect(
      readFile(
        path.join(
          nodeModulesDir,
          '@arcships',
          'light-ocr-win32-arm64',
          'native',
          'addon.node'
        ),
        'utf8'
      )
    ).resolves.toBe('native-payload')
    await expect(
      readFile(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), 'utf8')
    ).resolves.toContain('"nativePackage": "@arcships/light-ocr-win32-arm64"')
  })

  it('packages OCR assets for Linux arm64', async () => {
    const packageLightOcrAssets = await loadPackageLightOcrAssets()
    const projectDir = path.join(tmpDir, 'project')
    const unpackedRoot = path.join(tmpDir, 'resources', 'app.asar.unpacked')
    const nodeModulesDir = path.join(unpackedRoot, 'node_modules')
    await seedLightOcrPrerequisites(projectDir, nodeModulesDir, 'linux', 'arm64')

    await packageLightOcrAssets({
      appOutDir: tmpDir,
      electronPlatformName: 'linux',
      arch: 'arm64',
      packager: { projectDir }
    })

    await expect(
      readFile(
        path.join(
          nodeModulesDir,
          '@arcships',
          'light-ocr-linux-arm64-gnu',
          'native',
          'addon.node'
        ),
        'utf8'
      )
    ).resolves.toBe('native-payload')
    await expect(
      readFile(path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json'), 'utf8')
    ).resolves.toContain('"nativePackage": "@arcships/light-ocr-linux-arm64-gnu"')
  })

  it('removes heavyweight OCR assets from unsupported targets', async () => {
    const packageLightOcrAssets = await loadPackageLightOcrAssets()
    const projectDir = path.join(tmpDir, 'project')
    const nodeModulesDir = path.join(tmpDir, 'resources', 'app.asar.unpacked', 'node_modules')
    const facadeDir = path.join(nodeModulesDir, '@arcships', 'light-ocr')
    const helperPath = path.join(
      tmpDir,
      'resources',
      'app.asar.unpacked',
      'out',
      'main',
      'lightOcrHelper.js'
    )
    await writeUnpackedPackage(nodeModulesDir, '@arcships/light-ocr', {
      'bundle/large-model.bin': 'heavy'
    })
    await mkdir(path.dirname(helperPath), { recursive: true })
    await writeFile(helperPath, 'helper')
    await writeTestRuntimeVersions(projectDir)

    await packageLightOcrAssets({
      appOutDir: tmpDir,
      electronPlatformName: 'linux',
      arch: 'ia32',
      packager: { projectDir }
    })

    await expect(stat(facadeDir)).rejects.toThrow()
    await expect(stat(helperPath)).rejects.toThrow()
    await expect(
      readFile(
        path.join(tmpDir, 'resources', 'app.asar.unpacked', 'runtime', 'ocr', 'manifest.json'),
        'utf8'
      )
    ).resolves.toContain('"reason": "unsupported_platform"')
  })

  it('fails packaging when the copied OCR model checksum is invalid', async () => {
    const packageLightOcrAssets = await loadPackageLightOcrAssets()
    const projectDir = path.join(tmpDir, 'project')
    const nodeModulesDir = path.join(tmpDir, 'resources', 'app.asar.unpacked', 'node_modules')
    const { modelSourceDir } = await seedLightOcrPrerequisites(
      projectDir,
      nodeModulesDir,
      'linux',
      'x64'
    )
    await writeFile(path.join(modelSourceDir, 'bundle', 'payload.bin'), 'tampered')

    await expect(
      packageLightOcrAssets({
        appOutDir: tmpDir,
        electronPlatformName: 'linux',
        arch: 'x64',
        packager: { projectDir }
      })
    ).rejects.toThrow('OCR model checksum mismatch for payload.bin')
  })

  it('fails packaging when bundled Node does not match the pinned target hash', async () => {
    const packageLightOcrAssets = await loadPackageLightOcrAssets()
    const projectDir = path.join(tmpDir, 'project')
    const unpackedRoot = path.join(tmpDir, 'resources', 'app.asar.unpacked')
    const nodeModulesDir = path.join(unpackedRoot, 'node_modules')
    await seedLightOcrPrerequisites(projectDir, nodeModulesDir, 'linux', 'x64')
    await writeFile(path.join(unpackedRoot, 'runtime', 'node', 'bin', 'node'), 'tampered')

    await expect(
      packageLightOcrAssets({
        appOutDir: tmpDir,
        electronPlatformName: 'linux',
        arch: 'x64',
        packager: { projectDir }
      })
    ).rejects.toThrow('Bundled Node checksum mismatch for linux-x64')
  })

  it('fails packaging when a copied OCR native artifact is invalid', async () => {
    const packageLightOcrAssets = await loadPackageLightOcrAssets()
    const projectDir = path.join(tmpDir, 'project')
    const nodeModulesDir = path.join(tmpDir, 'resources', 'app.asar.unpacked', 'node_modules')
    const { nativeSourceDir } = await seedLightOcrPrerequisites(
      projectDir,
      nodeModulesDir,
      'linux',
      'x64'
    )
    await writeFile(path.join(nativeSourceDir, 'native', 'addon.node'), 'tampered')

    await expect(
      packageLightOcrAssets({
        appOutDir: tmpDir,
        electronPlatformName: 'linux',
        arch: 'x64',
        packager: { projectDir }
      })
    ).rejects.toThrow('OCR native artifact size mismatch for native/addon.node')
  })

  it('fails packaging when the facade dependency is not exactly pinned', async () => {
    const packageLightOcrAssets = await loadPackageLightOcrAssets()
    const projectDir = path.join(tmpDir, 'project')
    const nodeModulesDir = path.join(tmpDir, 'resources', 'app.asar.unpacked', 'node_modules')
    await seedLightOcrPrerequisites(projectDir, nodeModulesDir, 'linux', 'x64')
    await writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ dependencies: { '@arcships/light-ocr': '^0.3.4' } })
    )

    await expect(
      packageLightOcrAssets({
        appOutDir: tmpDir,
        electronPlatformName: 'linux',
        arch: 'x64',
        packager: { projectDir }
      })
    ).rejects.toThrow('DeepChat must depend on exactly @arcships/light-ocr@0.3.4')
  })
})
