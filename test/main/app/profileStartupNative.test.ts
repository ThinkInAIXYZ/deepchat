import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { describeIfNativeSqlite } from '../nativeSqliteHarness'
import { initializeCoreProfile } from '@/app/profileStartup'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')
vi.unmock('child_process')
vi.unmock('node:child_process')

describeIfNativeSqlite('Core profile ownership', () => {
  const cleanups: Array<() => void | Promise<void>> = []
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    cleanups.length = 0
  })

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'deepchat-core-profile-'))
    const profile = join(directory, 'profile')
    const home = join(directory, 'home')
    mkdirSync(profile)
    mkdirSync(home)
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const host = {
      setLoggingEnabled: vi.fn(async (_enabled: boolean) => {}),
      showDatabaseUnlockProgress: vi.fn(async () => {}),
      requestDatabaseUnlock: vi.fn(async () => null),
      requestDatabaseRecovery: vi.fn(async () => null),
      quit: vi.fn(async () => {})
    }
    const unavailable = async (): Promise<string> => {
      throw new Error('Unexpected crypto operation')
    }
    return {
      directory,
      options: {
        userDataDirectory: profile,
        homeDirectory: home,
        currentAppVersion: '1.1.4',
        host,
        crypto: {
          isAvailable: async () => false,
          encrypt: unavailable,
          decrypt: unavailable,
          getBackend: async () => undefined
        }
      }
    }
  }

  async function open(options: Parameters<typeof initializeCoreProfile>[0]) {
    const profile = await initializeCoreProfile(options)
    cleanups.push(() => profile.closeProfile())
    return profile
  }

  it('retains ownership through pending startup and maintenance database closure', async () => {
    const { options } = fixture()
    const gate = Promise.withResolvers<void>()
    options.host.setLoggingEnabled.mockImplementationOnce(() => gate.promise)
    const pending = initializeCoreProfile(options)
    try {
      await vi.waitFor(() => expect(options.host.setLoggingEnabled).toHaveBeenCalledOnce())
      const settings = join(options.userDataDirectory, 'app-settings.json')
      const before = readFileSync(settings)
      await expect(initializeCoreProfile(options)).rejects.toMatchObject({
        name: 'CoreProfileOwnershipUnavailableError'
      })
      expect(options.host.setLoggingEnabled).toHaveBeenCalledOnce()
      expect(readFileSync(settings)).toEqual(before)
    } finally {
      gate.resolve()
      const profile = await pending
      cleanups.push(() => profile.closeProfile())
    }
    const profile = await pending
    profile.database.close()
    await expect(initializeCoreProfile(options)).rejects.toMatchObject({
      name: 'CoreProfileOwnershipUnavailableError'
    })
    profile.database.reopen()
    profile.closeProfile()
    await open(options)
  })

  it('retains ownership when primary database close fails', async () => {
    const { options } = fixture()
    const profile = await open(options)
    const close = vi.spyOn(profile.database, 'close').mockImplementationOnce(() => {
      throw new Error('Database close failed')
    })
    expect(() => profile.closeProfile()).toThrow('Database close failed')
    await expect(initializeCoreProfile(options)).rejects.toMatchObject({
      name: 'CoreProfileOwnershipUnavailableError'
    })
    close.mockRestore()
    profile.closeProfile()
    await open(options)
  })

  it('releases ownership after failed initialization', async () => {
    const { options } = fixture()
    const legacy = join(options.userDataDirectory, 'model-config.json')
    writeFileSync(legacy, '{invalid')
    await expect(initializeCoreProfile(options)).rejects.toThrow()
    writeFileSync(legacy, '{}')
    await open(options)
  })

  it('fences delayed credential work before releasing ownership', async () => {
    const { options } = fixture()
    options.crypto.isAvailable = async () => true
    const profile = await open(options)
    const wrapped = Promise.withResolvers<string>()
    const encrypt = vi.spyOn(options.crypto, 'encrypt').mockReturnValueOnce(wrapped.promise)
    const pending = profile.secretStore.wrap('credential-fixture')
    await vi.waitFor(() => expect(encrypt).toHaveBeenCalledOnce())
    profile.closeProfile()
    wrapped.resolve('late-wrapped-fixture')
    await expect(pending).rejects.toThrow('interrupted')
    expect(() => profile.secretStore.setWrapped('cloudSyncSecret', 'late-wrapped-fixture')).toThrow(
      'interrupted'
    )
    encrypt.mockRestore()
    await open(options)
  })

  it('rejects a live process owner and permits recovery only after its exit', async () => {
    const { directory, options } = fixture()
    const script = join(directory, 'owner.cjs')
    const require = createRequire(join(process.cwd(), 'package.json'))
    writeFileSync(
      script,
      `const Database = require(process.argv[2])
const owner = new Database(process.argv[3], { timeout: 0 })
owner.exec('BEGIN EXCLUSIVE')
process.stdout.write('owned\\n')
setInterval(() => {}, 1000)
`
    )
    const child = spawn(
      process.execPath,
      [
        script,
        require.resolve('better-sqlite3-multiple-ciphers'),
        join(options.userDataDirectory, '.core-owner.lock')
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const closed = once(child, 'close')
    cleanups.push(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
    })
    const ready = await Promise.race([
      once(child.stdout, 'data').then(([data]) => data.toString()),
      closed.then(() => {
        throw new Error('Owner process exited before taking ownership')
      })
    ])
    expect(ready).toBe('owned\n')
    await expect(initializeCoreProfile(options)).rejects.toMatchObject({
      name: 'CoreProfileOwnershipUnavailableError'
    })
    expect(options.host.setLoggingEnabled).not.toHaveBeenCalled()
    child.kill('SIGKILL')
    await closed
    await open(options)
  })
})
