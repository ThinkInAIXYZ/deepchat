import { access, mkdtemp, rm } from 'fs/promises'
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

  it('uses an ad-hoc signature for explicit verification builds', async () => {
    const { signMacHelper } = await loadSigner()

    await expect(
      signMacHelper({
        appPath: path.join(tmpDir, 'DeepChat Computer Use.app'),
        entitlementsPath: path.join(tmpDir, 'entitlements.plist'),
        purpose: 'verification',
        cwd: tmpDir,
        env: {}
      })
    ).resolves.toEqual({
      purpose: 'verification',
      signature: 'ad-hoc'
    })
    const signingCall = childProcessMocks.execFileAsync.mock.calls.find(
      ([command, args]) => command === '/usr/bin/codesign' && args.includes('--sign')
    )
    expect(signingCall?.[1]).toContain('-')
    expect(signingCall?.[1]).toContain('--timestamp=none')
    expect(signingCall?.[1]).not.toContain('--deep')
  })

  it('imports the release certificate and signs the helper before plugin packaging', async () => {
    const { signMacHelper } = await loadSigner()
    const appPath = path.join(tmpDir, 'DeepChat Computer Use.app')
    const entitlementsPath = path.join(tmpDir, 'entitlements.plist')

    await expect(
      signMacHelper({
        appPath,
        entitlementsPath,
        purpose: 'distribution',
        cwd: tmpDir,
        env: {
          build_for_release: '2',
          CSC_LINK: Buffer.from('fake-p12').toString('base64'),
          CSC_KEY_PASSWORD: 'secret'
        }
      })
    ).resolves.toEqual({
      purpose: 'distribution',
      signature: 'developer-id'
    })

    const calls = childProcessMocks.execFileAsync.mock.calls as Array<[string, string[]]>
    expect(
      calls.some(
        ([command, args]) =>
          command === '/usr/bin/security' && args[0] === 'import' && args.includes('-k')
      )
    ).toBe(true)
    const signingCall = calls.find(
      ([command, args]) => command === '/usr/bin/codesign' && args.includes('--sign')
    )
    expect(signingCall?.[1]).not.toContain('--deep')
    expect(signingCall?.[1]).toContain('--timestamp')
    expect(signingCall?.[1]).not.toContain('--timestamp=none')
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

  it('defaults to development signing only outside CI', async () => {
    const { resolveCuaSigningPurpose, signMacHelper } = await loadSigner()

    expect(resolveCuaSigningPurpose(undefined, {})).toBe('development')
    await expect(
      signMacHelper({
        appPath: path.join(tmpDir, 'DeepChat Computer Use.app'),
        entitlementsPath: path.join(tmpDir, 'entitlements.plist'),
        cwd: tmpDir,
        env: { CI: 'true' }
      })
    ).rejects.toThrow(/requires an explicit distribution or verification purpose/)
  })

  it('rejects contradictory package purpose and release mode combinations', async () => {
    const { validateCuaSigningContext } = await loadSigner()

    expect(() =>
      validateCuaSigningContext({
        purpose: 'distribution',
        env: {}
      })
    ).toThrow(/requires build_for_release to enable release notarization/)
    expect(
      validateCuaSigningContext({
        purpose: 'distribution',
        env: { build_for_release: '1' }
      })
    ).toBe('distribution')
    expect(() =>
      validateCuaSigningContext({
        purpose: 'verification',
        env: { build_for_release: '1' }
      })
    ).toThrow(/verification signing must not enable release notarization/)
    expect(() =>
      validateCuaSigningContext({
        purpose: 'unknown',
        env: {}
      })
    ).toThrow(/Unsupported artifact purpose/)
    expect(() =>
      validateCuaSigningContext({
        purpose: 'development',
        env: {}
      })
    ).toThrow(/Unsupported artifact purpose/)
    expect(() =>
      validateCuaSigningContext({
        purpose: 'distribution',
        env: {
          PACKAGE_PURPOSE: 'verification',
          build_for_release: '2'
        }
      })
    ).toThrow(/signing purpose mismatch/)
  })

  it('removes temporary certificate material when keychain setup fails', async () => {
    const { signMacHelper } = await loadSigner()
    childProcessMocks.execFileAsync.mockImplementation(
      async (command: string, args: string[]) => {
        if (command === '/usr/bin/security' && args[0] === 'list-keychains') {
          return { stdout: '"/Users/runner/Library/Keychains/login.keychain-db"\n', stderr: '' }
        }
        if (command === '/usr/bin/security' && args[0] === 'import') {
          throw Object.assign(
            new Error(`Command failed: security import -P ${args.at(-1)}`),
            {
              code: 36,
              stderr: `security: SecKeychainItemImport: MAC verification failed for ${args.at(-1)}`
            }
          )
        }
        return { stdout: '', stderr: '' }
      }
    )

    const signingError = await signMacHelper({
      appPath: path.join(tmpDir, 'DeepChat Computer Use.app'),
      entitlementsPath: path.join(tmpDir, 'entitlements.plist'),
      purpose: 'distribution',
      cwd: tmpDir,
      env: {
        build_for_release: '2',
        CSC_LINK: Buffer.from('fake-p12').toString('base64'),
        CSC_KEY_PASSWORD: 'secret'
      }
    }).catch((error) => error)
    expect(signingError).toBeInstanceOf(Error)
    expect(signingError.message).toContain('Unable to import the CUA signing certificate')
    expect(signingError.message).toContain('code=36')
    expect(signingError.message).toContain('message=Command failed')
    expect(signingError.message).toContain('MAC verification failed')
    expect(signingError.message).toContain('<redacted>')
    expect(signingError.message).not.toContain('secret')

    const createCall = childProcessMocks.execFileAsync.mock.calls.find(
      ([command, args]) => command === '/usr/bin/security' && args[0] === 'create-keychain'
    )
    const keychainPath = createCall?.[1].at(-1)
    expect(keychainPath).toBeTruthy()
    await expect(access(path.dirname(keychainPath!))).rejects.toThrow()
    expect(childProcessMocks.execFileAsync).toHaveBeenCalledWith(
      '/usr/bin/security',
      ['delete-keychain', keychainPath],
      expect.any(Object)
    )
  })

  it('restores an originally empty user keychain search list', async () => {
    const { signMacHelper } = await loadSigner()
    childProcessMocks.execFileAsync.mockImplementation(
      async (command: string, args: string[]) => {
        if (command === '/usr/bin/security' && args[0] === 'list-keychains' && !args.includes('-s')) {
          return { stdout: '', stderr: '' }
        }
        if (command === '/usr/bin/security' && args[0] === 'find-identity') {
          throw new Error('identity lookup failed')
        }
        return { stdout: '', stderr: '' }
      }
    )

    await expect(
      signMacHelper({
        appPath: path.join(tmpDir, 'DeepChat Computer Use.app'),
        entitlementsPath: path.join(tmpDir, 'entitlements.plist'),
        purpose: 'distribution',
        cwd: tmpDir,
        env: {
          build_for_release: '2',
          CSC_LINK: Buffer.from('fake-p12').toString('base64')
        }
      })
    ).rejects.toThrow(/identity lookup failed/)
    expect(childProcessMocks.execFileAsync).toHaveBeenCalledWith(
      '/usr/bin/security',
      ['list-keychains', '-d', 'user', '-s'],
      expect.any(Object)
    )
  })
})
