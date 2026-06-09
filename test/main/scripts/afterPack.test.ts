import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
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

  it.each([
    ['arm64', 3, 'fff-bin-darwin-arm64'],
    ['x64', 1, 'fff-bin-darwin-x64']
  ])('copies FFF native packages into unpacked mac %s app node_modules', async (_, arch, packageDir) => {
    const afterPack = await loadAfterPack()
    const projectDir = path.join(tmpDir, 'project')
    const sourceDir = path.join(
      projectDir,
      'node_modules',
      '.pnpm',
      'node_modules',
      '@ff-labs',
      packageDir
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
    await mkdir(sourceDir, { recursive: true })
    await mkdir(path.join(nodeModulesDir, '@ff-labs', 'fff-node'), { recursive: true })
    await writeFile(path.join(sourceDir, 'package.json'), `{"name":"@ff-labs/${packageDir}"}`)
    await writeFile(path.join(sourceDir, 'libfff_c.dylib'), 'native')
    await writeFile(path.join(nodeModulesDir, '@ff-labs', 'fff-node', 'package.json'), '{}')

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
      readFile(
        path.join(nodeModulesDir, '@ff-labs', packageDir, 'libfff_c.dylib'),
        'utf8'
      )
    ).resolves.toBe('native')
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
