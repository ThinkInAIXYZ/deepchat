import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import {
  test,
  expect,
  resolvePackagedExecutable,
  waitForMainAppWindow
} from '../fixtures/electronApp'
import { _electron, type ElectronApplication } from '@playwright/test'
import { waitForAppReady } from '../helpers/wait'
import { openSettings } from '../helpers/settings'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

type JsonObject = Record<string, unknown>

const readJsonl = (path: string): { content: string; records: JsonObject[] } => {
  if (!existsSync(path)) throw new Error(`JSONL file does not exist: ${path}`)
  const content = readFileSync(path, 'utf8')
  if (!content.endsWith('\n')) throw new Error(`JSONL file is not LF-terminated: ${path}`)
  const records = content
    .split('\n')
    .slice(0, -1)
    .map((line, index) => {
      try {
        const value: unknown = JSON.parse(line)
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('record is not an object')
        }
        return value as JsonObject
      } catch (error) {
        throw new Error(`Invalid JSONL record at ${path}:${index + 1}`, { cause: error })
      }
    })
  return { content, records }
}

const LIFECYCLE_EVENTS = new Set([
  'app.startup.started',
  'app.startup.terminal',
  'app.shutdown.started',
  'app.shutdown.terminal'
])

test('quit cancels a pending database unlock and preserves the profile @smoke', async ({
  launchApp
}, testInfo) => {
  const password = 'disposable-startup-quit-password'
  const first = await launchApp()
  expect(first.ownsUserDataDir).toBe(true)
  await waitForAppReady(first.page)
  await first.page.evaluate(() =>
    window.deepchat.invoke('settings.update', {
      changes: [
        { key: 'copyWithCotEnabled', value: false },
        { key: 'privacyModeEnabled', value: true }
      ]
    })
  )
  await first.page.evaluate(
    (password) => window.deepchat.invoke('databaseSecurity.enable', { password }),
    password
  )
  expect(await first.close()).toBe('graceful')
  const metadataFile = join(first.userDataDir, 'database-security.json')
  const state = JSON.parse(readFileSync(metadataFile, 'utf8'))
  state.metadata.passwordStorage = 'manual'
  delete state.metadata.wrappedPassword
  writeFileSync(metadataFile, JSON.stringify(state))
  const errorsFile = join(first.userDataDir, 'startup-error-dialogs.json')
  writeFileSync(errorsFile, '[]')
  const owned: { app: ElectronApplication; child: ChildProcess }[] = []
  const launch = async () => {
    const app = await _electron.launch({
      ...(process.env.DEEPCHAT_E2E_APP_MODE === 'packaged'
        ? { executablePath: resolvePackagedExecutable(), args: [] }
        : { args: ['.'] }),
      cwd: process.cwd(),
      env: { ...process.env, DEEPCHAT_E2E_USER_DATA_DIR: first.userDataDir }
    })
    owned.push({ app, child: app.process() })
    await app.evaluate(({ dialog }, file) => {
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      dialog.showErrorBox = (title) => {
        const calls = JSON.parse(fs.readFileSync(file, 'utf8'))
        fs.writeFileSync(file, JSON.stringify([...calls, title]))
      }
    }, errorsFile)
    const findSplash = () => app.windows().find((page) => page.url().includes('/splash/'))
    await expect.poll(() => Boolean(findSplash())).toBe(true)
    return { app, splash: findSplash()! }
  }
  try {
    const { app: waiting, splash } = await launch()
    await expect(splash.locator('input[type="password"]')).toBeVisible()
    const child = waiting.process()
    const quitAt = Date.now()
    await waiting.evaluate(({ app }) => app.quit())
    await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
    expect(child.exitCode).toBe(0)
    await testInfo.attach('pending-unlock-quit', {
      body: JSON.stringify({ quitMs: Date.now() - quitAt, exitCode: child.exitCode }),
      contentType: 'application/json'
    })

    const { app: reopened, splash: unlock } = await launch()
    await unlock.locator('input[type="password"]').fill(password)
    await unlock.getByRole('button', { name: 'Unlock', exact: true }).click()
    const page = await waitForMainAppWindow(reopened)
    await waitForAppReady(page)
    const snapshot = await page.evaluate(() =>
      window.deepchat.invoke('settings.getSnapshot', { keys: ['copyWithCotEnabled'] })
    )
    expect(snapshot.values.copyWithCotEnabled).toBe(false)
    const reopenedChild = reopened.process()
    await reopened.evaluate(({ app }) => app.quit())
    await expect.poll(() => reopenedChild.exitCode, { timeout: 10_000 }).not.toBeNull()
    expect(reopenedChild.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(errorsFile, 'utf8'))).toEqual([])
  } finally {
    for (const { app, child } of owned.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      const splash = app.windows().find((page) => page.url().includes('/splash/'))
      await splash
        ?.getByRole('button', { name: 'Quit', exact: true })
        .click({ timeout: 1000 })
        .catch(() => {})
      const closed = app.close().catch(() => {})
      await Promise.race([closed, delay(1000)])
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }
})

test('Core owner failure ends the app generation and permits profile reopen @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const appProcess = active.electronApp.process()
  const settings = await openSettings(active)
  await active.electronApp.evaluate(({ webContents }, url) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!target) throw new Error('Owned settings renderer is missing')
    const original = webContents.fromId
    webContents.fromId = (id) => {
      if (id === target.id) throw new Error('Native renderer registration was refused')
      return original.call(webContents, id)
    }
  }, settings.url())
  const pending = settings
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
  await pending

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const sessions = await reopened.page.evaluate(() =>
    window.deepchat.invoke('sessions.listLightweight', { limit: 10 })
  )
  expect(sessions.items.length).toBeLessThanOrEqual(1)
  expect(await reopened.close()).toBe('graceful')
})

test('启动应用 @smoke', async ({ app }, testInfo) => {
  test.skip(
    !app.ownsUserDataDir,
    'The JSONL contract requires the fixture-owned, known-enabled profile.'
  )

  await waitForAppReady(app.page)

  await expect(app.page.getByTestId('app-main')).toBeVisible()
  await expect(app.page.getByTestId('window-sidebar')).toBeVisible()

  await app.page.screenshot({
    path: testInfo.outputPath('launch.png'),
    fullPage: true
  })
  expect(await app.close()).toBe('graceful')

  const mainJsonlPath = join(app.userDataDir, 'logs', 'main.jsonl')
  const { content, records } = readJsonl(mainJsonlPath)
  const startupRecords = records.filter((record) => record.event === 'app.startup.started')
  expect(startupRecords).toHaveLength(1)
  const processInstanceId = startupRecords[0].processInstanceId
  expect(typeof processInstanceId).toBe('string')
  expect(records.every((record) => record.processInstanceId === processInstanceId)).toBe(true)
  expect(
    records
      .filter((record) => LIFECYCLE_EVENTS.has(record.event as string))
      .map((record) => record.event)
  ).toEqual([
    'app.startup.started',
    'app.startup.terminal',
    'app.shutdown.started',
    'app.shutdown.terminal'
  ])

  expect(content.endsWith('\n')).toBe(true)
  expect(records.length).toBeGreaterThan(0)
  let previousSequence = 0
  for (const record of records) {
    expect(record).toEqual(
      expect.objectContaining({
        v: 1,
        ts: expect.any(String),
        seq: expect.any(Number),
        level: expect.stringMatching(/^(error|warn|info)$/),
        event: expect.any(String),
        process: 'main',
        processInstanceId: expect.any(String),
        appVersion: expect.any(String)
      })
    )
    expect(Number.isSafeInteger(record.seq) && (record.seq as number) > 0).toBe(true)
    expect(record.seq as number).toBeGreaterThan(previousSequence)
    previousSequence = record.seq as number
    expect(new Date(record.ts as string).toISOString()).toBe(record.ts)
    expect(
      typeof record.context === 'object' &&
        record.context !== null &&
        !Array.isArray(record.context)
    ).toBe(true)
  }
  expect(existsSync(join(app.userDataDir, 'logs', 'main.log'))).toBe(false)
})

test('starts and repairs an obsolete installed Nowledge manifest @smoke', async ({ launchApp }) => {
  const first = await launchApp()
  test.skip(!first.ownsUserDataDir, 'Requires an isolated fixture-owned profile.')
  await waitForAppReady(first.page)
  const pluginId = 'com.deepchat.plugins.nowledge-mem'
  expect(
    await first.page.evaluate(
      async (id) => (await window.deepchat.invoke('plugins.enable', { pluginId: id })).result.ok,
      pluginId
    )
  ).toBe(true)
  await first.close()
  const manifestPath = join(first.userDataDir, 'plugins', pluginId, 'plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.mcpServers = [
    { id: 'nowledge-mem-local', transport: 'http', connectionProfile: 'local' }
  ]
  await writeFile(manifestPath, JSON.stringify(manifest))
  const brokenRoot = join(first.userDataDir, 'plugins', 'broken')
  await mkdir(brokenRoot, { recursive: true })
  await writeFile(join(brokenRoot, 'plugin.json'), '{broken')

  const restarted = await launchApp()
  await waitForAppReady(restarted.page)
  await expect(restarted.page.getByTestId('app-main')).toBeVisible()
  const plugin = await restarted.page.evaluate(
    async (id) => (await window.deepchat.invoke('plugins.get', { pluginId: id })).plugin,
    pluginId
  )
  expect(plugin?.enabled).toBe(true)
  expect(plugin?.activationError).toBeUndefined()
  expect(JSON.parse(await readFile(manifestPath, 'utf8')).mcpServers[0].id).toBe(
    'nowledge-mem-connection'
  )
  expect(await restarted.close()).toBe('graceful')
  const { records } = readJsonl(join(first.userDataDir, 'logs', 'main.jsonl'))
  expect(
    records
      .filter((record) => record.event === 'app.startup.terminal')
      .every((record) => (record.context as JsonObject).outcome === 'completed')
  ).toBe(true)
})

test('keeps the main window usable when plugin host initialization fails @smoke', async ({
  launchApp
}) => {
  const first = await launchApp()
  test.skip(!first.ownsUserDataDir, 'Requires an isolated fixture-owned profile.')
  await waitForAppReady(first.page)
  await first.close()
  const pluginRoot = join(first.userDataDir, 'plugins')
  await rm(pluginRoot, { recursive: true, force: true })
  await writeFile(pluginRoot, 'invalid plugin directory')

  const restarted = await launchApp()
  await waitForAppReady(restarted.page)
  await expect(restarted.page.getByTestId('app-main')).toBeVisible()
  await expect(restarted.page.getByTestId('window-sidebar-toggle')).toBeEnabled()
  expect(await restarted.close()).toBe('graceful')
  const { records } = readJsonl(join(first.userDataDir, 'logs', 'main.jsonl'))
  const terminals = records.filter((record) => record.event === 'app.startup.terminal')
  expect(terminals).toHaveLength(2)
  expect(terminals.every((record) => (record.context as JsonObject).outcome === 'completed')).toBe(
    true
  )
})
