import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  await expect(restarted.page.getByTestId('app-settings-button')).toBeEnabled()
  expect(await restarted.close()).toBe('graceful')
  const { records } = readJsonl(join(first.userDataDir, 'logs', 'main.jsonl'))
  const terminals = records.filter((record) => record.event === 'app.startup.terminal')
  expect(terminals).toHaveLength(2)
  expect(terminals.every((record) => (record.context as JsonObject).outcome === 'completed')).toBe(true)
})
