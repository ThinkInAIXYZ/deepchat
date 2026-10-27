import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@playwright/test'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

async function runCli(userDataDir: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, DEEPCHAT_E2E_USER_DATA_DIR: userDataDir }
  delete env.DEEPCHAT_CLI_AGENT_TOKEN
  return await promisify(execFile)(
    process.execPath,
    [resolve('out/cli/deepchat.mjs'), ...args, '--json'],
    { env, timeout: 30_000 }
  )
}

async function holdEncryption(
  app: ElectronApplication,
  heldValue: string,
  maintenancePassword: string
) {
  await app.evaluate(
    ({ safeStorage }, { heldValue, maintenancePassword }) => {
      const encrypt = safeStorage.encryptStringAsync
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const fixture = {
        entered: false,
        events: [] as string[],
        release,
        restore: () => {
          safeStorage.encryptStringAsync = encrypt
        }
      }
      Object.assign(globalThis, { __maintenanceFixture: fixture })
      safeStorage.encryptStringAsync = async (value) => {
        if (value === heldValue) {
          fixture.entered = true
          await gate
          fixture.events.push('pending-request-released')
        } else if (value === maintenancePassword) fixture.events.push('maintenance-dispatched')
        return encrypt.call(safeStorage, value)
      }
    },
    { heldValue, maintenancePassword }
  )
}

async function releaseEncryption(app: ElectronApplication) {
  await app.evaluate(() => {
    const fixture = (
      globalThis as unknown as {
        __maintenanceFixture: { release(): void; restore(): void }
      }
    ).__maintenanceFixture
    fixture.restore()
    fixture.release()
  })
}

test('database maintenance restores sessions through incremental and overwrite imports @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const listProviders = async () => {
    const { stdout } = await runCli(active.userDataDir, ['provider', 'list'])
    const response = JSON.parse(stdout)
    expect(response).toMatchObject({ ok: true, result: { providers: expect.any(Array) } })
    return response.result.providers.map((provider: { id: string }) => provider.id)
  }
  const providers = await listProviders()
  await active.page.evaluate(
    (folderPath) =>
      window.deepchat.invoke('config.updateSyncSettings', { enabled: true, folderPath }),
    join(active.userDataDir, 'maintenance-backups')
  )
  const created = await active.page.evaluate(() =>
    window.deepchat.invoke('sessions.create', {
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      message: '',
      projectDir: null
    })
  )
  const sessionId = created.session.id
  const before = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    sessionId
  )
  expect(before.session?.id).toBe(sessionId)
  const { backup } = await active.page.evaluate(() =>
    window.deepchat.invoke('sync.startBackup', {})
  )
  expect(backup).not.toBeNull()
  await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.delete', { sessionId }),
    sessionId
  )
  const missing = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    sessionId
  )
  expect(missing.session).toBeNull()
  const invalid = await active.page.evaluate(() =>
    window.deepchat.invoke('sync.import', { backupFile: '../not-a-backup.zip', mode: 'increment' })
  )
  expect(invalid.result.success).toBe(false)
  const restored = await active.page.evaluate(
    (backupFile) => window.deepchat.invoke('sync.import', { backupFile, mode: 'increment' }),
    backup!.fileName
  )
  expect(restored.result.success).toBe(true)
  const increment = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    sessionId
  )
  expect(increment.session?.id).toBe(sessionId)
  expect(increment.session?.providerId).toBe(before.session?.providerId)
  const extra = await active.page.evaluate(() =>
    window.deepchat.invoke('sessions.create', {
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      message: '',
      projectDir: null
    })
  )
  const overwritten = await active.page.evaluate(
    (backupFile) => window.deepchat.invoke('sync.import', { backupFile, mode: 'overwrite' }),
    backup!.fileName
  )
  expect(overwritten.result.success).toBe(true)
  const removed = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    extra.session.id
  )
  expect(removed.session).toBeNull()
  const { report } = await active.page.evaluate(() =>
    window.deepchat.invoke('databaseSecurity.repairSchema', {})
  )
  expect(report.remainingIssues).toEqual([])
  expect(await active.close()).toBe('graceful')

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const persisted = await reopened.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    sessionId
  )
  expect(persisted.session?.id).toBe(sessionId)
  expect(persisted.session?.providerId).toBe(before.session?.providerId)
  expect(await listProviders()).toEqual(providers)
  expect(await reopened.close()).toBe('graceful')
})

test('database repair and import cannot enter while encryption is preparing @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const password = 'disposable-maintenance-password'
  await holdEncryption(active.electronApp, password, password)
  const enabled = active.page.evaluate(
    (password) => window.deepchat.invoke('databaseSecurity.enable', { password }),
    password
  )
  void enabled.catch(() => undefined)
  try {
    await expect
      .poll(() =>
        active.electronApp.evaluate(
          () =>
            (globalThis as unknown as { __maintenanceFixture: { entered: boolean } })
              .__maintenanceFixture.entered
        )
      )
      .toBe(true)
    await expect(
      active.page.evaluate(() => window.deepchat.invoke('databaseSecurity.repairSchema', {}))
    ).rejects.toThrow('App database maintenance is maintenance')
    await expect(
      active.page.evaluate(() =>
        window.deepchat.invoke('sync.import', { backupFile: 'unavailable.zip', mode: 'increment' })
      )
    ).rejects.toThrow('App database maintenance is maintenance')
    await expect(
      active.page.evaluate(() => window.deepchat.invoke('config.setCustomPrompts', { prompts: [] }))
    ).rejects.toThrow('App database maintenance is maintenance')
    await expect(
      active.page.evaluate(() =>
        window.deepchat.invoke('providers.add', {
          provider: {
            id: 'custom-maintenance-blocked',
            name: 'Blocked',
            apiType: 'openai-completions',
            apiKey: 'must-not-persist',
            baseUrl: 'http://127.0.0.1:1/v1',
            enable: false,
            custom: true
          }
        })
      )
    ).rejects.toThrow('App database maintenance is maintenance')
    expect(
      (await active.page.evaluate(() => window.deepchat.invoke('window.getCurrentState', {}))).state
        .exists
    ).toBe(true)
    expect(
      (await active.page.evaluate(() => window.deepchat.invoke('databaseSecurity.getStatus', {})))
        .status.migrationInProgress
    ).toBe(true)
    expect(
      JSON.parse((await runCli(active.userDataDir, ['system', 'status'])).stdout)
    ).toMatchObject({ ok: true, result: { running: true } })
    await expect(runCli(active.userDataDir, ['provider', 'list'])).rejects.toMatchObject({
      stdout: expect.stringMatching(/"ok"\s*:\s*false/)
    })
  } finally {
    await releaseEncryption(active.electronApp)
  }
  expect((await enabled).status.enabled).toBe(true)
  expect(
    (await active.page.evaluate(() => window.deepchat.invoke('databaseSecurity.repairSchema', {})))
      .report.remainingIssues
  ).toEqual([])
  expect(await active.close()).toBe('graceful')
})

test('maintenance drains a credential request delayed in native encryption @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const secret = 'disposable-pending-cloud-secret'
  const password = 'disposable-request-drain-password'
  await holdEncryption(active.electronApp, secret, password)
  const saving = active.page.evaluate(
    (secretAccessKey) =>
      window.deepchat.invoke('sync.setCloudConfig', {
        config: {
          enabled: false,
          endpoint: 'http://127.0.0.1:1',
          bucket: 'fixture',
          accessKeyId: 'fixture',
          secretAccessKey
        }
      }),
    secret
  )
  const rejected = expect(saving).rejects.toThrow()
  await expect
    .poll(() =>
      active.electronApp.evaluate(
        () =>
          (globalThis as unknown as { __maintenanceFixture: { entered: boolean } })
            .__maintenanceFixture.entered
      )
    )
    .toBe(true)
  const enabled = active.page.evaluate(
    (password) => window.deepchat.invoke('databaseSecurity.enable', { password }),
    password
  )
  void enabled.catch(() => undefined)
  try {
    await expect
      .poll(async () =>
        active.page.evaluate(async () => {
          try {
            await window.deepchat.invoke('config.listCustomPrompts', {})
            return false
          } catch (error) {
            return String(error).includes('App database maintenance is maintenance')
          }
        })
      )
      .toBe(true)
  } finally {
    // Release the request first; keep the observer installed until maintenance dispatches.
    await active.electronApp.evaluate(() =>
      (
        globalThis as unknown as { __maintenanceFixture: { release(): void } }
      ).__maintenanceFixture.release()
    )
  }
  await rejected
  try {
    expect((await enabled).status.enabled).toBe(true)
    expect(
      await active.electronApp.evaluate(
        () =>
          (globalThis as unknown as { __maintenanceFixture: { events: string[] } })
            .__maintenanceFixture.events
      )
    ).toEqual(['pending-request-released', 'maintenance-dispatched'])
    expect(
      (await active.page.evaluate(() => window.deepchat.invoke('sync.getCloudConfig', {}))).config
        .hasSecret
    ).toBe(false)
  } finally {
    await releaseEncryption(active.electronApp)
  }
  expect(await active.close()).toBe('graceful')
})

for (const kind of ['credential', 'maintenance'] as const) {
  test(`shutdown drains pending native ${kind} work before closing the database @smoke`, async ({
    launchApp
  }) => {
    const active = await launchApp()
    const appProcess = active.electronApp.process()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    const value = `disposable-shutdown-${kind}`
    await holdEncryption(active.electronApp, value, value)
    const pending = active.page
      .evaluate(
        async ({ kind, value }) => {
          if (kind === 'maintenance') {
            await window.deepchat.invoke('databaseSecurity.enable', { password: value })
          } else {
            await window.deepchat.invoke('sync.setCloudConfig', {
              config: {
                enabled: false,
                endpoint: 'http://127.0.0.1:1',
                bucket: 'fixture',
                accessKeyId: 'fixture',
                secretAccessKey: value
              }
            })
          }
        },
        { kind, value }
      )
      .then(
        () => true,
        () => false
      )
    try {
      await expect
        .poll(() =>
          active.electronApp.evaluate(
            () =>
              (globalThis as unknown as { __maintenanceFixture: { entered: boolean } })
                .__maintenanceFixture.entered
          )
        )
        .toBe(true)
      const windowClosed = active.page.waitForEvent('close')
      await active.electronApp.evaluate(({ app }) => {
        setImmediate(() => app.quit())
      })
      await windowClosed
      await releaseEncryption(active.electronApp)
      await expect.poll(() => appProcess.exitCode).toBe(0)
      expect(await active.close()).toBe('graceful')
      expect(await pending).toBe(false)
    } finally {
      await releaseEncryption(active.electronApp).catch(() => undefined)
    }

    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    expect(
      (await reopened.page.evaluate(() => window.deepchat.invoke('databaseSecurity.getStatus', {})))
        .status.enabled
    ).toBe(false)
    expect(
      (await reopened.page.evaluate(() => window.deepchat.invoke('sync.getCloudConfig', {}))).config
        .hasSecret
    ).toBe(false)
    expect(await reopened.close()).toBe('graceful')
  })
}
