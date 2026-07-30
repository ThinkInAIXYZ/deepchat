import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CuaRuntimeIntegrityVerifier,
  parseCuaRuntimeIntegrityDescriptor,
  type CuaRuntimeIntegrityDescriptor
} from '@/plugin/cuaRuntimeIntegrity'

const tempRoots: string[] = []
const execFileAsync = promisify(execFile)

const sha256 = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')

const collectFileHashes = async (
  directory: string,
  prefix = ''
): Promise<Record<string, string>> => {
  const hashes: Record<string, string> = {}
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      Object.assign(hashes, await collectFileHashes(absolutePath, relativePath))
    } else if (entry.isFile()) {
      hashes[relativePath] = await sha256(absolutePath)
    }
  }
  return hashes
}

const createLinuxFixture = async () => {
  const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-integrity-'))
  tempRoots.push(pluginRoot)
  const runtimeRoot = path.join(pluginRoot, 'runtime', 'linux', 'x64')
  await mkdir(runtimeRoot, { recursive: true })
  const binaryPath = path.join(runtimeRoot, 'cua-driver')
  const catalogPath = path.join(runtimeRoot, 'tool-catalog.json')
  await writeFile(binaryPath, 'verified-driver')
  await chmod(binaryPath, 0o755)
  await writeFile(catalogPath, '{"version":"0.13.1","tools":[]}\n')
  await writeFile(path.join(runtimeRoot, 'integrity.json'), '{}\n')
  const descriptor = parseCuaRuntimeIntegrityDescriptor({
    schemaVersion: 1,
    pluginId: 'com.deepchat.plugins.cua',
    runtimeId: 'cua-driver',
    runtimeVersion: '0.13.1',
    target: 'linux/x64',
    runtimeRoot: 'runtime/linux/x64',
    binaryPath: 'cua-driver',
    catalogPath: 'tool-catalog.json',
    files: {
      'cua-driver': await sha256(binaryPath),
      'tool-catalog.json': await sha256(catalogPath)
    },
    executablePaths: ['cua-driver']
  })
  return { pluginRoot, runtimeRoot, binaryPath, catalogPath, descriptor }
}

describe('CuaRuntimeIntegrityVerifier', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('rejects unsafe paths and descriptors that do not bind the binary to the file set', () => {
    const base = {
      schemaVersion: 1,
      pluginId: 'com.deepchat.plugins.cua',
      runtimeId: 'cua-driver',
      runtimeVersion: '0.13.1',
      target: 'linux/x64',
      runtimeRoot: 'runtime/linux/x64',
      binaryPath: 'cua-driver',
      catalogPath: 'tool-catalog.json',
      files: {
        'cua-driver': 'a'.repeat(64),
        'tool-catalog.json': 'b'.repeat(64)
      },
      executablePaths: ['cua-driver']
    }

    expect(() =>
      parseCuaRuntimeIntegrityDescriptor({
        ...base,
        runtimeRoot: '../runtime'
      })
    ).toThrow(/unsafe/)
    expect(() =>
      parseCuaRuntimeIntegrityDescriptor({
        ...base,
        executablePaths: ['other']
      })
    ).toThrow(/absent from the file set/)
  })

  it('verifies the complete Linux file set and returns a stable runtime fingerprint', async () => {
    const fixture = await createLinuxFixture()
    const verifier = new CuaRuntimeIntegrityVerifier({
      pluginRoot: fixture.pluginRoot,
      binaryPath: fixture.binaryPath,
      platform: 'linux',
      arch: 'x64',
      runtimeVersion: '0.13.1',
      descriptor: fixture.descriptor
    })

    const first = await verifier.verify()
    const second = await verifier.verify()

    await expect(verifier.verifyCatalog(fixture.catalogPath)).resolves.toBe(
      '{"version":"0.13.1","tools":[]}\n'
    )
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      pluginId: 'com.deepchat.plugins.cua',
      runtimeId: 'cua-driver',
      target: 'linux/x64',
      binarySha256: await sha256(fixture.binaryPath)
    })
    expect(first.value).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a mismatched descriptor before exposing its tool catalog', async () => {
    const fixture = await createLinuxFixture()
    const descriptor = parseCuaRuntimeIntegrityDescriptor({
      ...fixture.descriptor,
      target: 'linux/arm64'
    })
    const verifier = new CuaRuntimeIntegrityVerifier({
      pluginRoot: fixture.pluginRoot,
      binaryPath: fixture.binaryPath,
      platform: 'linux',
      arch: 'x64',
      runtimeVersion: '0.13.1',
      descriptor
    })

    await expect(verifier.verifyCatalog(fixture.catalogPath)).rejects.toThrow(
      /target mismatch: expected linux\/x64, received linux\/arm64/
    )
  })

  it('hard-blocks modified, linked, and unexpected executable artifacts', async () => {
    const modified = await createLinuxFixture()
    const modifiedVerifier = new CuaRuntimeIntegrityVerifier({
      pluginRoot: modified.pluginRoot,
      binaryPath: modified.binaryPath,
      platform: 'linux',
      arch: 'x64',
      runtimeVersion: '0.13.1',
      descriptor: modified.descriptor
    })
    await writeFile(modified.binaryPath, 'replaced-driver')
    await expect(modifiedVerifier.verify()).rejects.toThrow(/integrity mismatch/)
    await writeFile(modified.catalogPath, '{"tampered":true}\n')
    await expect(modifiedVerifier.verifyCatalog(modified.catalogPath)).rejects.toThrow(
      /tool catalog integrity mismatch/
    )

    const linked = await createLinuxFixture()
    await rm(linked.catalogPath)
    await symlink('/dev/null', linked.catalogPath)
    const linkedVerifier = new CuaRuntimeIntegrityVerifier({
      pluginRoot: linked.pluginRoot,
      binaryPath: linked.binaryPath,
      platform: 'linux',
      arch: 'x64',
      runtimeVersion: '0.13.1',
      descriptor: linked.descriptor
    })
    await expect(linkedVerifier.verify()).rejects.toThrow(/rejects symbolic links/)

    const linkedRoot = await createLinuxFixture()
    const movedRuntimeRoot = `${linkedRoot.runtimeRoot}-real`
    await rename(linkedRoot.runtimeRoot, movedRuntimeRoot)
    await symlink(movedRuntimeRoot, linkedRoot.runtimeRoot, 'dir')
    const linkedRootVerifier = new CuaRuntimeIntegrityVerifier({
      pluginRoot: linkedRoot.pluginRoot,
      binaryPath: path.join(linkedRoot.runtimeRoot, 'cua-driver'),
      platform: 'linux',
      arch: 'x64',
      runtimeVersion: '0.13.1',
      descriptor: linkedRoot.descriptor
    })
    await expect(linkedRootVerifier.verify()).rejects.toThrow(/directory must not be linked/)

    const unexpected = await createLinuxFixture()
    const extraExecutable = path.join(unexpected.runtimeRoot, 'extra-helper')
    await writeFile(extraExecutable, 'extra')
    await chmod(extraExecutable, 0o755)
    const unexpectedVerifier = new CuaRuntimeIntegrityVerifier({
      pluginRoot: unexpected.pluginRoot,
      binaryPath: unexpected.binaryPath,
      platform: 'linux',
      arch: 'x64',
      runtimeVersion: '0.13.1',
      descriptor: unexpected.descriptor
    })
    await expect(unexpectedVerifier.verify()).rejects.toThrow(/file set mismatch/)
  })

  it('maps the packaged macOS descriptor onto the exact app helper launch path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-macos-integrity-'))
    tempRoots.push(root)
    const pluginRoot = path.join(root, 'plugin')
    const runtimeRoot = path.join(pluginRoot, 'runtime', 'darwin', 'arm64')
    const externalApp = path.join(
      root,
      'DeepChat.app',
      'Contents',
      'Helpers',
      'DeepChat Computer Use.app'
    )
    const externalBinary = path.join(externalApp, 'Contents', 'MacOS', 'deepchat-cua-driver')
    const infoPlist = path.join(externalApp, 'Contents', 'Info.plist')
    const catalogPath = path.join(runtimeRoot, 'tool-catalog.json')
    await mkdir(path.dirname(externalBinary), { recursive: true })
    await mkdir(runtimeRoot, { recursive: true })
    await writeFile(externalBinary, 'signed-driver')
    await chmod(externalBinary, 0o755)
    await writeFile(infoPlist, '<plist/>')
    await writeFile(catalogPath, '{"version":"0.13.1","tools":[]}\n')
    await writeFile(path.join(runtimeRoot, 'integrity.json'), '{}\n')

    const descriptor = parseCuaRuntimeIntegrityDescriptor({
      schemaVersion: 1,
      pluginId: 'com.deepchat.plugins.cua',
      runtimeId: 'cua-driver',
      runtimeVersion: '0.13.1',
      target: 'darwin/arm64',
      runtimeRoot: 'runtime/darwin/arm64',
      binaryPath: 'DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
      catalogPath: 'tool-catalog.json',
      files: {
        'DeepChat Computer Use.app/Contents/Info.plist': await sha256(infoPlist),
        'DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver':
          await sha256(externalBinary),
        'tool-catalog.json': await sha256(catalogPath)
      },
      executablePaths: ['DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver'],
      macos: {
        bundlePath: 'DeepChat Computer Use.app',
        bundleIdentifier: 'com.deepchat.computeruse.helper',
        signatureType: 'developer-id',
        teamId: 'Y7P5QLKLYG',
        hardenedRuntime: true,
        entitlements: {
          'com.apple.security.automation.apple-events': true,
          'com.apple.security.device.screen-capture': true
        }
      }
    }) as CuaRuntimeIntegrityDescriptor
    const verifyMacSignature = vi.fn().mockResolvedValue(undefined)
    const verifier = new CuaRuntimeIntegrityVerifier(
      {
        pluginRoot,
        binaryPath: externalBinary,
        externalBinaryPath: externalBinary,
        platform: 'darwin',
        arch: 'arm64',
        runtimeVersion: '0.13.1',
        descriptor
      },
      { verifyMacSignature }
    )

    await expect(verifier.verify()).resolves.toMatchObject({
      binarySha256: await sha256(externalBinary)
    })
    expect(verifyMacSignature).toHaveBeenCalledWith(
      externalApp,
      descriptor.macos,
      expect.any(Function)
    )
  })

  it.skipIf(process.platform !== 'darwin')(
    'verifies a real ad-hoc hardened signature and exact entitlement contract',
    async () => {
      const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-signed-integrity-'))
      tempRoots.push(pluginRoot)
      const runtimeRoot = path.join(pluginRoot, 'runtime', 'darwin', process.arch)
      const helperApp = path.join(runtimeRoot, 'DeepChat Computer Use.app')
      const helperBinary = path.join(helperApp, 'Contents', 'MacOS', 'deepchat-cua-driver')
      const catalogPath = path.join(runtimeRoot, 'tool-catalog.json')
      await mkdir(path.dirname(helperBinary), { recursive: true })
      await copyFile('/usr/bin/true', helperBinary)
      await chmod(helperBinary, 0o755)
      await writeFile(
        path.join(helperApp, 'Contents', 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.deepchat.computeruse.helper</string>
<key>CFBundleExecutable</key><string>deepchat-cua-driver</string>
</dict></plist>
`
      )
      await writeFile(catalogPath, '{"version":"0.13.1","tools":[]}\n')
      await execFileAsync(
        '/usr/bin/codesign',
        [
          '--force',
          '--sign',
          '-',
          '--entitlements',
          path.resolve('plugins/cua/build/entitlements.plist'),
          '--options',
          'runtime',
          '--timestamp=none',
          helperApp
        ],
        { encoding: 'utf8' }
      )
      const files = {
        ...(await collectFileHashes(helperApp, 'DeepChat Computer Use.app')),
        'tool-catalog.json': await sha256(catalogPath)
      }
      const descriptor = parseCuaRuntimeIntegrityDescriptor({
        schemaVersion: 1,
        pluginId: 'com.deepchat.plugins.cua',
        runtimeId: 'cua-driver',
        runtimeVersion: '0.13.1',
        target: `darwin/${process.arch}`,
        runtimeRoot: `runtime/darwin/${process.arch}`,
        binaryPath: 'DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
        catalogPath: 'tool-catalog.json',
        files,
        executablePaths: ['DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver'],
        macos: {
          bundlePath: 'DeepChat Computer Use.app',
          bundleIdentifier: 'com.deepchat.computeruse.helper',
          signatureType: 'ad-hoc',
          teamId: null,
          hardenedRuntime: true,
          entitlements: {
            'com.apple.security.automation.apple-events': true,
            'com.apple.security.device.screen-capture': true
          }
        }
      })
      const verifier = new CuaRuntimeIntegrityVerifier({
        pluginRoot,
        binaryPath: helperBinary,
        platform: 'darwin',
        arch: process.arch,
        runtimeVersion: '0.13.1',
        descriptor
      })

      await expect(verifier.verify()).resolves.toMatchObject({
        binarySha256: await sha256(helperBinary)
      })
    }
  )
})
