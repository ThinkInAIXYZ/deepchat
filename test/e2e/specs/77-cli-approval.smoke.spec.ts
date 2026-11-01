import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { LocalControlRpcResponseSchema } from '../../../src/shared/contracts/localControl'
import { settingsGetSnapshotRoute } from '../../../src/shared/contracts/routes/settings.routes'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import { openSettings } from '../helpers/settings'

const execute = promisify(execFile)
test.use({ privacyModeEnabled: true })

test('CLI security changes require renderer approval and persist across reopen @smoke', async ({
  launchApp
}) => {
  let active = await launchApp()
  const invoke = async (...args: string[]) => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DEEPCHAT_E2E_USER_DATA_DIR: active.userDataDir
    }
    delete environment.DEEPCHAT_CLI_AGENT_TOKEN
    let stdout: string
    try {
      const result = await execute(
        process.execPath,
        [resolve('out/cli/deepchat.mjs'), ...args, '--json'],
        { env: environment, timeout: 60_000 }
      )
      stdout = result.stdout
    } catch (error) {
      if (!error || typeof error !== 'object' || !('stdout' in error)) throw error
      if (typeof error.stdout !== 'string') throw error
      stdout = error.stdout
    }
    return LocalControlRpcResponseSchema.parse(JSON.parse(stdout))
  }
  const readLogging = async () => {
    const reply = await invoke('settings', 'get', '--keys', 'loggingEnabled')
    expect(reply.ok).toBe(true)
    if (!reply.ok) throw new Error(reply.error.message)
    return settingsGetSnapshotRoute.output.parse(reply.result).values.loggingEnabled
  }

  await waitForAppReady(active.page)
  await expect.poll(async () => await invoke('system', 'version')).toMatchObject({ ok: true })
  const initial = await readLogging()
  expect(typeof initial).toBe('boolean')
  const change = (value = !initial) => {
    const pending = invoke('settings', 'set', '--key', 'loggingEnabled', '--value', String(value))
    void pending.catch(() => undefined)
    return pending
  }
  const dialog = active.page.getByRole('dialog').filter({ hasText: 'settings.updatePublic' })

  const denied = change()
  await dialog.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(denied).resolves.toMatchObject({ ok: false, error: { code: 'approval_denied' } })
  expect(await readLogging()).toBe(initial)

  const approved = change()
  await dialog.getByRole('button', { name: 'Allow Once', exact: true }).click()
  await expect(approved).resolves.toMatchObject({ ok: true })
  expect(await readLogging()).toBe(!initial)
  expect(await active.close()).toBe('graceful')

  active = await launchApp()
  await waitForAppReady(active.page)
  await expect.poll(async () => await invoke('system', 'version')).toMatchObject({ ok: true })
  expect(await readLogging()).toBe(!initial)

  const settings = await openSettings(active)
  const interrupted = change(initial).then(
    (result) => result.ok,
    () => false
  )
  const approval = active.page.getByRole('dialog').filter({ hasText: 'settings.updatePublic' })
  await expect(approval).toBeVisible()
  const appProcess = active.electronApp.process()
  await active.electronApp.evaluate(({ webContents }, url) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!target) throw new Error('Owned settings renderer is missing')
    const original = webContents.fromId
    webContents.fromId = (id) => {
      if (id === target.id) throw new Error('Native renderer registration was refused')
      return original.call(webContents, id)
    }
  }, settings.url())
  const creation = settings
    .evaluate(() =>
      window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
        message: ''
      })
    )
    .catch(() => undefined)
  await expect.poll(() => appProcess.exitCode).toBe(1)
  await creation
  expect(await interrupted).toBe(false)

  active = await launchApp()
  await waitForAppReady(active.page)
  await expect.poll(async () => await invoke('system', 'version')).toMatchObject({ ok: true })
  expect(await readLogging()).toBe(!initial)
  expect(await active.close()).toBe('graceful')
})
