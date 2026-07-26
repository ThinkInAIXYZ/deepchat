import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertCuaDeveloperIdMetadata,
  assertCuaEntitlements,
  assertCuaMachOLoadPaths,
  extractCuaEntitlements,
  inspectCuaHelperBundle,
  verifyCuaMacHelperDistribution
} from '../../../scripts/ci/verify-cua-macos-helper.mjs'
import {
  CUA_DARWIN_ALLOWED_ENTITLEMENTS,
  CUA_DARWIN_HELPER_APP_NAME,
  CUA_DARWIN_HELPER_EXECUTABLE_NAME
} from '../../../scripts/cua-macos-contract.mjs'

const validMetadata = {
  stdout: '',
  stderr: [
    'Identifier=com.deepchat.computeruse.helper',
    'CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+1 location=embedded',
    'Authority=Developer ID Application: ThinkInAIXYZ (Y7P5QLKLYG)',
    'TeamIdentifier=Y7P5QLKLYG',
    'Timestamp=Jul 26, 2026 at 12:00:00'
  ].join('\n')
}

describe('verify-cua-macos-helper', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-verify-test-'))
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('requires Developer ID, timestamp, hardened runtime, and the managed bundle ID', () => {
    expect(() => assertCuaDeveloperIdMetadata(validMetadata)).not.toThrow()
    for (const invalid of [
      validMetadata.stderr.replace(
        'Authority=Developer ID Application: ThinkInAIXYZ (Y7P5QLKLYG)',
        'Signature=adhoc'
      ),
      validMetadata.stderr.replace('Timestamp=Jul 26, 2026 at 12:00:00', 'Timestamp=none'),
      validMetadata.stderr.replace('(runtime)', '()'),
      validMetadata.stderr.replace(
        'Identifier=com.deepchat.computeruse.helper',
        'Identifier=com.trycua.driver'
      )
    ]) {
      expect(() => assertCuaDeveloperIdMetadata({ stdout: '', stderr: invalid })).toThrow()
    }
  })

  it('compares helper entitlements as an exact allowlist', () => {
    expect(() => assertCuaEntitlements({ ...CUA_DARWIN_ALLOWED_ENTITLEMENTS })).not.toThrow()
    expect(() =>
      assertCuaEntitlements({
        ...CUA_DARWIN_ALLOWED_ENTITLEMENTS,
        'com.apple.security.cs.disable-library-validation': true
      })
    ).toThrow(/must exactly match/)
    expect(() =>
      assertCuaEntitlements({
        'com.apple.security.automation.apple-events': false
      })
    ).toThrow(/must exactly match/)
    expect(() => assertCuaEntitlements({})).toThrow(/must exactly match/)
  })

  it('rejects disallowed RPATHs and linked libraries in any Mach-O', () => {
    expect(() =>
      assertCuaMachOLoadPaths([
        {
          filePath: '/tmp/helper',
          rpaths: ['/usr/lib/swift'],
          linkedLibraries: ['/System/Library/Frameworks/AppKit.framework/AppKit']
        }
      ])
    ).not.toThrow()
    expect(() =>
      assertCuaMachOLoadPaths([
        {
          filePath: '/tmp/helper',
          rpaths: ['/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx'],
          linkedLibraries: ['/usr/lib/libSystem.B.dylib']
        }
      ])
    ).toThrow(/non-system RPATHs/)
    expect(() =>
      assertCuaMachOLoadPaths([
        {
          filePath: '/tmp/helper',
          rpaths: ['/usr/lib/swift'],
          linkedLibraries: ['/Users/runner/build/libInjected.dylib']
        }
      ])
    ).toThrow(/non-system linked libraries/)
  })

  it('recursively inspects regular Mach-O files and requires the managed executable', async () => {
    const helperAppPath = path.join(tempRoot, CUA_DARWIN_HELPER_APP_NAME)
    const executablePath = path.join(
      helperAppPath,
      'Contents',
      'MacOS',
      CUA_DARWIN_HELPER_EXECUTABLE_NAME
    )
    const resourcePath = path.join(helperAppPath, 'Contents', 'Resources', 'AppIcon.icns')
    await mkdir(path.dirname(executablePath), { recursive: true })
    await mkdir(path.dirname(resourcePath), { recursive: true })
    await writeFile(executablePath, Buffer.from('cffaedfe00000000', 'hex'))
    await writeFile(resourcePath, 'icon')

    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === '/usr/bin/file') {
        return {
          stdout: args[1] === executablePath ? 'Mach-O universal binary\n' : 'data\n',
          stderr: ''
        }
      }
      if (command === '/usr/bin/otool' && args[0] === '-l') {
        return {
          stdout: '          cmd LC_RPATH\n      cmdsize 32\n         path /usr/lib/swift (offset 12)\n',
          stderr: ''
        }
      }
      if (command === '/usr/bin/otool' && args[0] === '-L') {
        return {
          stdout:
            `${executablePath}:\n` +
            '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\n',
          stderr: ''
        }
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
    })

    await expect(
      inspectCuaHelperBundle(helperAppPath, {
        runCommand,
        readEntitlements: async () => ({ ...CUA_DARWIN_ALLOWED_ENTITLEMENTS })
      })
    ).resolves.toMatchObject({
      entitlements: CUA_DARWIN_ALLOWED_ENTITLEMENTS,
      inspections: [
        {
          filePath: executablePath,
          rpaths: ['/usr/lib/swift'],
          linkedLibraries: ['/usr/lib/libSystem.B.dylib']
        }
      ]
    })
    expect(
      runCommand.mock.calls.filter(
        ([command]: [string, string[]]) => command === '/usr/bin/file'
      )
    ).toHaveLength(1)
  })

  it('reports a missing entitlement payload before invoking plutil', async () => {
    const runCommand = vi.fn(async () => ({ stdout: '', stderr: '' }))

    await expect(
      extractCuaEntitlements(path.join(tempRoot, CUA_DARWIN_HELPER_APP_NAME), {
        runCommand
      })
    ).rejects.toThrow(/does not contain entitlements/)
    expect(
      runCommand.mock.calls.some(
        ([command]: [string, string[]]) => command === '/usr/bin/plutil'
      )
    ).toBe(false)
  })

  it('rejects symbolic links that escape the helper bundle', async () => {
    const helperAppPath = path.join(tempRoot, CUA_DARWIN_HELPER_APP_NAME)
    const executablePath = path.join(
      helperAppPath,
      'Contents',
      'MacOS',
      CUA_DARWIN_HELPER_EXECUTABLE_NAME
    )
    const resourcesPath = path.join(helperAppPath, 'Contents', 'Resources')
    const outsidePath = path.join(tempRoot, 'outside')
    await Promise.all([
      mkdir(path.dirname(executablePath), { recursive: true }),
      mkdir(resourcesPath, { recursive: true }),
      mkdir(outsidePath)
    ])
    await writeFile(executablePath, Buffer.from('cffaedfe00000000', 'hex'))
    await symlink(outsidePath, path.join(resourcesPath, 'External.framework'))

    await expect(
      inspectCuaHelperBundle(helperAppPath, {
        runCommand: async () => ({ stdout: 'data\n', stderr: '' }),
        readEntitlements: async () => ({ ...CUA_DARWIN_ALLOWED_ENTITLEMENTS })
      })
    ).rejects.toThrow(/symbolic link escapes the bundle/)
  })

  it('verifies the helper and every nested Mach-O identity before accepting the app', async () => {
    const appPath = path.join(tempRoot, 'DeepChat.app')
    const helperAppPath = path.join(
      appPath,
      'Contents',
      'Helpers',
      CUA_DARWIN_HELPER_APP_NAME
    )
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === '/usr/bin/codesign' && args[0] === '--display') {
        return validMetadata
      }
      return { stdout: '', stderr: '' }
    })
    const helperExecutablePath = path.join(
      helperAppPath,
      'Contents',
      'MacOS',
      CUA_DARWIN_HELPER_EXECUTABLE_NAME
    )
    const nestedMachOPath = path.join(
      helperAppPath,
      'Contents',
      'Frameworks',
      'Nested.framework',
      'Nested'
    )
    const inspectBundle = vi.fn(async () => ({
      entitlements: { ...CUA_DARWIN_ALLOWED_ENTITLEMENTS },
      inspections: [
        {
          filePath: helperExecutablePath,
          rpaths: ['/usr/lib/swift'],
          linkedLibraries: ['/usr/lib/libSystem.B.dylib']
        },
        {
          filePath: nestedMachOPath,
          rpaths: ['/usr/lib/swift'],
          linkedLibraries: ['/usr/lib/libSystem.B.dylib']
        }
      ]
    }))

    await expect(
      verifyCuaMacHelperDistribution(appPath, {
        teamId: 'Y7P5QLKLYG',
        runCommand,
        inspectBundle
      })
    ).resolves.toEqual({
      helperAppPath,
      inspectedMachOCount: 2
    })
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', helperAppPath],
      expect.any(Object)
    )
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/codesign',
      [
        '--verify',
        '--strict',
        '--test-requirement',
        '=anchor apple generic and certificate leaf[subject.OU] = "Y7P5QLKLYG"',
        helperAppPath
      ],
      expect.any(Object)
    )
    for (const filePath of [helperExecutablePath, nestedMachOPath]) {
      expect(runCommand).toHaveBeenCalledWith(
        '/usr/bin/codesign',
        [
          '--verify',
          '--strict',
          '--test-requirement',
          '=anchor apple generic and certificate leaf[subject.OU] = "Y7P5QLKLYG"',
          filePath
        ],
        expect.any(Object)
      )
    }
    expect(inspectBundle).toHaveBeenCalledWith(helperAppPath, { runCommand })
  })
})
