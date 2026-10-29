import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('sync folders and Knowledge databases retain their owned paths across relaunch @smoke', async ({
  launchApp
}) => {
  const require = createRequire(import.meta.url)
  let sourceBytes!: Buffer
  let active = await launchApp({
    prepareUserData(profile) {
      mkdirSync(join(profile, 'app_db'), { recursive: true })
      const source = join(profile, 'app_db', 'chat.db')
      execFileSync(
        require('electron'),
        [
          '-e',
          `
        const Database = require(process.argv[1])
        const db = new Database(process.argv[2])
        db.exec("CREATE TABLE conversations (conv_id TEXT PRIMARY KEY, title TEXT); INSERT INTO conversations VALUES ('storage-root-fixture', 'Imported storage fixture')")
        db.close()
      `,
          require.resolve('better-sqlite3-multiple-ciphers'),
          source
        ],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          timeout: 30_000
        }
      )
      sourceBytes = readFileSync(source)
    }
  })
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const profile = active.userDataDir
  const legacySessionId = 'legacy-session-storage-root-fixture'
  await expect
    .poll(
      async () =>
        (
          await active.page.evaluate(
            (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
            legacySessionId
          )
        ).session?.title
    )
    .toBe('Imported storage fixture')
  const backupDirectory = join(profile, 'storage-backups')
  await active.page.evaluate(
    (folderPath) =>
      window.deepchat.invoke('config.updateSyncSettings', { enabled: true, folderPath }),
    backupDirectory
  )
  await active.electronApp.evaluate(({ shell }) => {
    const openPath = shell.openPath
    Object.assign(globalThis, {
      storageFolderFixture: {
        opened: [] as string[],
        restore: () => {
          shell.openPath = openPath
        }
      }
    })
    shell.openPath = async (path) => {
      ;(
        globalThis as typeof globalThis & { storageFolderFixture: { opened: string[] } }
      ).storageFolderFixture.opened.push(path)
      return ''
    }
  })
  try {
    expect(await active.page.evaluate(() => window.deepchat.invoke('sync.openFolder', {}))).toEqual(
      {
        opened: true
      }
    )
    expect(existsSync(backupDirectory)).toBe(true)
    expect(
      await active.electronApp.evaluate(
        () =>
          (globalThis as typeof globalThis & { storageFolderFixture: { opened: string[] } })
            .storageFolderFixture.opened
      )
    ).toEqual([backupDirectory])
  } finally {
    await active.electronApp.evaluate(() => {
      ;(
        globalThis as typeof globalThis & { storageFolderFixture: { restore(): void } }
      ).storageFolderFixture.restore()
    })
  }

  const supported = await active.page.evaluate(() =>
    window.deepchat.invoke('knowledge.isSupported', {})
  )
  const knowledgeBaseId = 'storage-root-fixture'
  if (supported.supported) {
    await active.page.evaluate(
      (id) =>
        window.deepchat.invoke('config.setKnowledgeConfigs', {
          configs: [
            {
              id,
              description: 'Storage root fixture',
              embedding: { providerId: 'openai', modelId: 'text-embedding-3-small' },
              dimensions: 3,
              normalized: false,
              fragmentsNumber: 2,
              enabled: true
            }
          ]
        }),
      knowledgeBaseId
    )
    expect(
      await active.page.evaluate(
        (knowledgeBaseId) => window.deepchat.invoke('knowledge.listFiles', { knowledgeBaseId }),
        knowledgeBaseId
      )
    ).toEqual({ files: [] })
    expect(existsSync(join(profile, 'app_db', 'KnowledgeBase', knowledgeBaseId))).toBe(true)
  }
  expect(await active.close()).toBe('graceful')
  expect(readFileSync(join(profile, 'app_db', 'chat.db'))).toEqual(sourceBytes)
  active = await launchApp()
  await waitForAppReady(active.page)
  expect(
    (
      await active.page.evaluate(
        (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
        legacySessionId
      )
    ).session?.title
  ).toBe('Imported storage fixture')
  expect(
    await active.page.evaluate(() => window.deepchat.invoke('config.getSyncSettings', {}))
  ).toMatchObject({ enabled: true, folderPath: backupDirectory })
  if (supported.supported) {
    expect(
      await active.page.evaluate(
        (knowledgeBaseId) => window.deepchat.invoke('knowledge.listFiles', { knowledgeBaseId }),
        knowledgeBaseId
      )
    ).toEqual({ files: [] })
  }
  expect(await active.close()).toBe('graceful')
})
