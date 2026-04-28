import { mkdtemp, mkdir, rm, stat, writeFile } from 'fs/promises'
import { execFileSync } from 'child_process'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({
  execFileSync: vi.fn()
}))

const execFileSyncMock = vi.mocked(execFileSync)

const loadAfterPack = async () => {
  return (await import('../../../scripts/afterPack.js')).default as (context: {
    targets: Array<{ name: string }>
    appOutDir: string
    electronPlatformName: string
    arch?: string | number
  }) => Promise<void>
}

async function createPackagedMacHelper(appOutDir: string) {
  const helperAppPath = path.join(
    appOutDir,
    'DeepChat.app',
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'runtime',
    'computer-use',
    'cua-driver',
    'current',
    'DeepChat Computer Use.app'
  )
  const helperBinaryPath = path.join(helperAppPath, 'Contents', 'MacOS', 'cua-driver')
  await mkdir(path.dirname(helperBinaryPath), { recursive: true })
  await writeFile(helperBinaryPath, 'helper')
  return { helperAppPath, helperBinaryPath }
}

describe('afterPack Computer Use isolation', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    execFileSyncMock.mockReset()
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-after-pack-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    delete process.env.build_for_release
    delete process.env.CSC_LINK
    delete process.env.CSC_KEY_PASSWORD
    delete process.env.CSC_NAME
  })

  it('removes Computer Use runtime from Windows packages', async () => {
    const afterPack = await loadAfterPack()
    const computerUsePath = path.join(
      tmpDir,
      'resources',
      'app.asar.unpacked',
      'runtime',
      'computer-use'
    )
    const computerUseSkillPath = path.join(
      tmpDir,
      'resources',
      'app.asar.unpacked',
      'resources',
      'skills',
      'cua-driver'
    )
    await mkdir(computerUsePath, { recursive: true })
    await mkdir(computerUseSkillPath, { recursive: true })
    await writeFile(path.join(computerUsePath, 'helper.txt'), 'helper')
    await writeFile(path.join(computerUseSkillPath, 'SKILL.md'), 'skill')

    await afterPack({
      targets: [],
      appOutDir: tmpDir,
      electronPlatformName: 'win32'
    })

    await expect(stat(computerUsePath)).rejects.toThrow()
    await expect(stat(computerUseSkillPath)).rejects.toThrow()
  })

  it('removes Computer Use runtime and keeps the Linux no-sandbox wrapper', async () => {
    const afterPack = await loadAfterPack()
    const computerUsePath = path.join(
      tmpDir,
      'resources',
      'app.asar.unpacked',
      'runtime',
      'computer-use'
    )
    const computerUseSkillPath = path.join(
      tmpDir,
      'resources',
      'app.asar.unpacked',
      'resources',
      'skills',
      'cua-driver'
    )
    await mkdir(computerUsePath, { recursive: true })
    await mkdir(computerUseSkillPath, { recursive: true })
    await writeFile(path.join(computerUsePath, 'helper.txt'), 'helper')
    await writeFile(path.join(computerUseSkillPath, 'SKILL.md'), 'skill')
    await writeFile(path.join(tmpDir, 'deepchat'), '#!/bin/bash\n')

    await afterPack({
      targets: [{ name: 'AppImage' }],
      appOutDir: tmpDir,
      electronPlatformName: 'linux'
    })

    await expect(stat(computerUsePath)).rejects.toThrow()
    await expect(stat(computerUseSkillPath)).rejects.toThrow()
    await expect(stat(path.join(tmpDir, 'deepchat.bin'))).resolves.toBeTruthy()
    await expect(stat(path.join(tmpDir, 'deepchat'))).resolves.toBeTruthy()
  })

  it('fails release macOS packaging when the helper is missing', async () => {
    process.env.build_for_release = '2'
    const afterPack = await loadAfterPack()

    await expect(
      afterPack({
        targets: [],
        appOutDir: tmpDir,
        electronPlatformName: 'darwin',
        arch: 'arm64'
      })
    ).rejects.toThrow('Computer Use helper is missing')
  })

  it('warns and skips non-release macOS packaging when the helper is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const afterPack = await loadAfterPack()

      await expect(
        afterPack({
          targets: [],
          appOutDir: tmpDir,
          electronPlatformName: 'darwin',
          arch: 'arm64'
        })
      ).resolves.toBeUndefined()

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Computer Use helper is missing'))
      expect(execFileSyncMock).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('fails macOS packaging when the helper architecture does not match', async () => {
    execFileSyncMock.mockImplementation((command) => {
      if (command === '/usr/bin/lipo') {
        return 'x86_64'
      }
      return ''
    })
    await createPackagedMacHelper(tmpDir)
    const afterPack = await loadAfterPack()

    await expect(
      afterPack({
        targets: [],
        appOutDir: tmpDir,
        electronPlatformName: 'darwin',
        arch: 'arm64'
      })
    ).rejects.toThrow('Computer Use helper arch mismatch')
  })

  it('fails release helper signing when no Developer ID identity is available', async () => {
    process.env.build_for_release = '2'
    execFileSyncMock.mockImplementation((command) => {
      if (command === '/usr/bin/lipo') {
        return 'arm64'
      }
      if (command === 'security') {
        return ''
      }
      return ''
    })
    await createPackagedMacHelper(tmpDir)
    const afterPack = await loadAfterPack()

    await expect(
      afterPack({
        targets: [],
        appOutDir: tmpDir,
        electronPlatformName: 'darwin',
        arch: 'arm64'
      })
    ).rejects.toThrow('Developer ID Application identity is required for release helper signing')
  })

  it('imports CSC_LINK before release signing the macOS helper', async () => {
    process.env.build_for_release = '2'
    process.env.CSC_LINK = Buffer.from('fake-p12').toString('base64')
    process.env.CSC_KEY_PASSWORD = 'secret'

    execFileSyncMock.mockImplementation((command, args) => {
      const commandArgs = Array.isArray(args) ? args.map(String) : []
      if (command === '/usr/bin/lipo') {
        return 'arm64'
      }
      if (command === 'security' && commandArgs[0] === 'find-identity') {
        if (commandArgs.some((arg) => arg.endsWith('codesign.keychain-db'))) {
          return '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: DeepChat (TEAMID)"\n'
        }
        return ''
      }
      if (command === 'security' && commandArgs[0] === 'list-keychains') {
        return '"/Users/test/Library/Keychains/login.keychain-db"\n'
      }
      return ''
    })

    await createPackagedMacHelper(tmpDir)

    const afterPack = await loadAfterPack()
    await afterPack({
      targets: [],
      appOutDir: tmpDir,
      electronPlatformName: 'darwin',
      arch: 3
    })

    expect(execFileSyncMock).toHaveBeenCalledWith(
      'security',
      expect.arrayContaining(['import', expect.any(String), '-P', 'secret']),
      expect.any(Object)
    )
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'security',
      expect.arrayContaining(['set-key-partition-list']),
      expect.any(Object)
    )
    const signCall = execFileSyncMock.mock.calls.find(
      ([command, args]) =>
        command === 'codesign' &&
        Array.isArray(args) &&
        args.includes('--sign') &&
        args.includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    )
    expect(signCall?.[1]).toEqual(
      expect.arrayContaining(['--keychain', expect.stringContaining('codesign.keychain-db')])
    )
  })
})
