import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import {
  createNotarizationOptions,
  notarizeReleaseArtifact,
  validateAppleTeamId
} from '../../../scripts/apple-notarization.js'
import {
  finalizeMacDmg,
  verifyDmgDistribution,
  verifyDmgSignature
} from '../../../scripts/notarize-dmg.js'

const dmgPath = '/tmp/DeepChat-1.1.0-mac-arm64.dmg'
const releaseEnvironment = {
  build_for_release: '2',
  DEEPCHAT_APPLE_NOTARY_USERNAME: 'release@example.com',
  DEEPCHAT_APPLE_NOTARY_TEAM_ID: 'Y7P5QLKLYG',
  DEEPCHAT_APPLE_NOTARY_PASSWORD: 'app-specific-password'
}

function createCommandRunner(events: string[] = []) {
  return vi.fn(async (command: string, args: string[]) => {
    events.push(`${command}:${args[0]}`)
    if (command === '/usr/bin/codesign' && args[0] === '--display') {
      return {
        stdout: '',
        stderr:
          'Authority=Developer ID Application: DeepChat (Y7P5QLKLYG)\nTimestamp=Jul 22, 2026 at 20:49:07\n'
      }
    }
    return { stdout: '', stderr: '' }
  })
}

describe('macOS distribution notarization', () => {
  it('builds fail-closed notarization options without exposing credentials', async () => {
    expect(createNotarizationOptions(dmgPath, {})).toBeNull()
    expect(
      createNotarizationOptions(dmgPath, {
        build_for_release: '1'
      })
    ).toEqual({ appPath: dmgPath, keychainProfile: 'DeepChat' })
    expect(createNotarizationOptions(dmgPath, releaseEnvironment)).toEqual({
      appPath: dmgPath,
      appleId: 'release@example.com',
      appleIdPassword: 'app-specific-password',
      teamId: 'Y7P5QLKLYG'
    })
    expect(() =>
      createNotarizationOptions(dmgPath, {
        ...releaseEnvironment,
        DEEPCHAT_APPLE_NOTARY_PASSWORD: ''
      })
    ).toThrow(/DEEPCHAT_APPLE_NOTARY_PASSWORD/)
    expect(() =>
      createNotarizationOptions(dmgPath, {
        ...releaseEnvironment,
        DEEPCHAT_APPLE_NOTARY_TEAM_ID: 'INVALID"00'
      })
    ).toThrow(/10-character Apple team ID/)
    expect(() => validateAppleTeamId(undefined, 'CUA helper Team ID')).toThrow(
      /CUA helper Team ID/
    )

    const notarizeImpl = vi.fn().mockResolvedValue(undefined)
    await expect(
      notarizeReleaseArtifact(dmgPath, { env: releaseEnvironment, notarizeImpl })
    ).resolves.toBe(true)
    expect(notarizeImpl).toHaveBeenCalledWith({
      appPath: dmgPath,
      appleId: 'release@example.com',
      appleIdPassword: 'app-specific-password',
      teamId: 'Y7P5QLKLYG'
    })
  })

  it('skips non-release and non-DMG artifacts without side effects', async () => {
    const runCommand = createCommandRunner()
    const notarizeImpl = vi.fn()
    const logger = { info: vi.fn() }

    await expect(
      finalizeMacDmg(
        { file: dmgPath, target: { name: 'dmg' } },
        { env: {}, notarizeImpl, runCommand, logger }
      )
    ).resolves.toBe(false)
    await expect(
      finalizeMacDmg(
        { file: `${dmgPath}.blockmap`, target: { name: 'dmg' } },
        { env: releaseEnvironment, notarizeImpl, runCommand, logger }
      )
    ).resolves.toBe(false)
    await expect(
      finalizeMacDmg(
        { file: '/tmp/DeepChat.zip', target: { name: 'zip' } },
        { env: releaseEnvironment, notarizeImpl, runCommand, logger }
      )
    ).resolves.toBe(false)

    expect(runCommand).not.toHaveBeenCalled()
    expect(notarizeImpl).not.toHaveBeenCalled()
  })

  it('sign-checks, notarizes, staples and Gatekeeper-assesses the final DMG', async () => {
    const events: string[] = []
    const runCommand = createCommandRunner(events)
    const notarizeImpl = vi.fn(async () => {
      events.push('notarize')
    })

    await expect(
      finalizeMacDmg(
        { file: dmgPath, target: { name: 'dmg' } },
        {
          env: releaseEnvironment,
          notarizeImpl,
          runCommand,
          logger: { info: vi.fn() }
        }
      )
    ).resolves.toBe(true)

    expect(notarizeImpl).toHaveBeenCalledWith({
      appPath: dmgPath,
      appleId: 'release@example.com',
      appleIdPassword: 'app-specific-password',
      teamId: 'Y7P5QLKLYG'
    })
    expect(events).toEqual([
      '/usr/bin/codesign:--verify',
      '/usr/bin/codesign:--display',
      '/usr/bin/codesign:--verify',
      'notarize',
      '/usr/bin/codesign:--verify',
      '/usr/bin/codesign:--display',
      '/usr/bin/codesign:--verify',
      '/usr/bin/hdiutil:verify',
      '/usr/bin/xcrun:stapler',
      '/usr/sbin/spctl:--assess'
    ])

    const flattenedArguments = JSON.stringify(runCommand.mock.calls)
    expect(flattenedArguments).not.toContain('app-specific-password')
    expect(flattenedArguments).toContain('context:primary-signature')
    expect(flattenedArguments).toContain('Y7P5QLKLYG')
  })

  it('rejects an unsigned or untimestamped DMG before notarization', async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === '/usr/bin/codesign' && args[0] === '--display') {
        return { stdout: '', stderr: 'Signature=adhoc\n' }
      }
      return { stdout: '', stderr: '' }
    })
    const notarizeImpl = vi.fn()

    await expect(
      finalizeMacDmg(
        { file: dmgPath, target: { name: 'dmg' } },
        { env: releaseEnvironment, notarizeImpl, runCommand, logger: { info: vi.fn() } }
      )
    ).rejects.toThrow(/Developer ID Application/)
    expect(notarizeImpl).not.toHaveBeenCalled()

    const untimestampedCommand = createCommandRunner()
    untimestampedCommand.mockImplementation(async (command: string, args: string[]) => {
      if (command === '/usr/bin/codesign' && args[0] === '--display') {
        return {
          stdout: '',
          stderr: 'Authority=Developer ID Application: DeepChat (Y7P5QLKLYG)\nTimestamp=none\n'
        }
      }
      return { stdout: '', stderr: '' }
    })
    await expect(
      verifyDmgSignature(dmgPath, {
        teamId: 'Y7P5QLKLYG',
        runCommand: untimestampedCommand
      })
    ).rejects.toThrow(/secure timestamp/)
  })

  it('uses the complete distribution verification command set', async () => {
    const runCommand = createCommandRunner()
    await verifyDmgSignature(dmgPath, { runCommand })
    await verifyDmgDistribution(dmgPath, { teamId: 'Y7P5QLKLYG', runCommand })

    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/codesign',
      ['--verify', '--strict', '--test-requirement', '=anchor apple generic', dmgPath],
      expect.any(Object)
    )
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/codesign',
      [
        '--verify',
        '--strict',
        '--test-requirement',
        '=anchor apple generic and certificate leaf[subject.OU] = "Y7P5QLKLYG"',
        dmgPath
      ],
      expect.any(Object)
    )
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/hdiutil',
      ['verify', dmgPath],
      expect.any(Object)
    )
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      ['stapler', 'validate', '-v', dmgPath],
      expect.any(Object)
    )
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/sbin/spctl',
      [
        '--assess',
        '--type',
        'open',
        '--context',
        'context:primary-signature',
        '--verbose=4',
        dmgPath
      ],
      expect.any(Object)
    )
  })

  it('wires final DMG notarization before publisher emission without stale DMG metadata', async () => {
    const config = parse(await readFile('electron-builder.yml', 'utf8'))

    expect(config.afterSign).toBe('scripts/notarize.js')
    expect(config.artifactBuildCompleted).toBe('scripts/notarize-dmg.js')
    expect(config.dmg).toMatchObject({ sign: true, writeUpdateInfo: false })
    expect(config.mac.target).toEqual([{ target: 'dmg' }, { target: 'zip' }])
  })
})
