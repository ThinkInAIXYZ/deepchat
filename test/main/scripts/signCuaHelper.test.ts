import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childProcessMocks = vi.hoisted(() => {
  const execFileAsync = vi.fn()
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & {
    [key: symbol]: ReturnType<typeof vi.fn>
  }
  const customPromisify = Symbol.for('nodejs.util.promisify.custom')
  execFile[customPromisify] = execFileAsync
  return { execFile, execFileAsync }
})

vi.mock('node:child_process', () => ({
  execFile: childProcessMocks.execFile
}))

const loadSigner = async () => {
  return await import('../../../scripts/sign-cua-helper.mjs')
}

describe('sign-cua-helper', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    childProcessMocks.execFileAsync.mockReset()
    childProcessMocks.execFileAsync.mockImplementation(async (command: string, args: string[]) => {
      if (command === '/usr/bin/security' && args[0] === 'list-keychains') {
        return { stdout: '"/Users/runner/Library/Keychains/login.keychain-db"\n', stderr: '' }
      }
      if (command === '/usr/bin/security' && args[0] === 'find-identity') {
        return {
          stdout:
            '  1) ABCDEF1234567890ABCDEF1234567890ABCDEF12 "Developer ID Application: ThinkInAIXYZ (TEAMID)"\n',
          stderr: ''
        }
      }
      if (command === '/usr/bin/codesign' && args.includes('-dv')) {
        return {
          stdout: '',
          stderr:
            'Authority=Developer ID Application: ThinkInAIXYZ (TEAMID)\nTimestamp=May 1, 2026 at 12:00:00\n'
        }
      }
      return { stdout: '', stderr: '' }
    })
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-sign-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('skips signing outside release builds', async () => {
    const { signMacHelperForRelease } = await loadSigner()

    await expect(
      signMacHelperForRelease({
        appPath: path.join(tmpDir, 'DeepChat Computer Use.app'),
        entitlementsPath: path.join(tmpDir, 'entitlements.plist'),
        cwd: tmpDir,
        env: {}
      })
    ).resolves.toBe(false)
    expect(childProcessMocks.execFileAsync).not.toHaveBeenCalled()
  })

  it('imports the release certificate and signs the helper before plugin packaging', async () => {
    const { signMacHelperForRelease } = await loadSigner()
    const appPath = path.join(tmpDir, 'DeepChat Computer Use.app')
    const entitlementsPath = path.join(tmpDir, 'entitlements.plist')

    await expect(
      signMacHelperForRelease({
        appPath,
        entitlementsPath,
        cwd: tmpDir,
        env: {
          build_for_release: '2',
          CSC_LINK: Buffer.from('fake-p12').toString('base64'),
          CSC_KEY_PASSWORD: 'secret'
        }
      })
    ).resolves.toBe(true)

    const calls = childProcessMocks.execFileAsync.mock.calls as Array<[string, string[]]>
    expect(
      calls.some(
        ([command, args]) =>
          command === '/usr/bin/security' && args[0] === 'import' && args.includes('-k')
      )
    ).toBe(true)
    expect(
      calls.some(
        ([command, args]) =>
          command === '/usr/bin/codesign' &&
          args.includes('--sign') &&
          args.includes('ABCDEF1234567890ABCDEF1234567890ABCDEF12')
      )
    ).toBe(true)
    expect(
      calls.some(
        ([command, args]) => command === '/usr/bin/codesign' && args.includes('--timestamp')
      )
    ).toBe(true)
    expect(
      calls.some(
        ([command, args]) => command === '/usr/bin/security' && args[0] === 'delete-keychain'
      )
    ).toBe(true)
  })
})
