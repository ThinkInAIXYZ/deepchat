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
