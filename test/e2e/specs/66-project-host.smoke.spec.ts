import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('native pickers retire queued requests and close with their app generation @smoke', async ({
  launchApp
}) => {
  test.skip(process.platform !== 'darwin', 'Exercises actual macOS native sheet retirement.')
  for (const kind of ['directory', 'image'] as const) {
    const active = await launchApp()
    await waitForAppReady(active.page)
    await active.electronApp.evaluate(({ dialog }, kind) => {
      const state = { opened: 0, settled: 0 }
      Reflect.set(globalThis, '__nativePickerFixture', state)
      const method = kind === 'directory' ? 'showOpenDialog' : 'showSaveDialog'
      const original = dialog[method]
      Reflect.set(dialog, method, (...args: unknown[]) => {
        state.opened++
        return Reflect.apply(original, dialog, args).finally(() => {
          state.settled++
        })
      })
    }, kind)
    const pending = active.page
      .evaluate(async (kind) => {
        if (kind === 'directory')
          await Promise.all([
            window.deepchat.invoke('project.selectDirectory', {}),
            window.deepchat.invoke('project.selectDirectory', {})
          ])
        else
          await window.deepchat.invoke('file.saveImage', {
            source: 'data:image/png;base64,aW1hZ2U='
          })
      }, kind)
      .catch(() => undefined)
    await expect
      .poll(() =>
        active.electronApp.evaluate(() => {
          const state = Reflect.get(globalThis, '__nativePickerFixture') as {
            opened: number
            settled: number
          }
          return state.opened > 0 && state.settled === 0
        })
      )
      .toBe(true)
    expect(await active.close()).toBe('graceful')
    await pending
  }
})

test('project host preserves workspace, native operations and durable versions @smoke', async ({
  launchApp
}) => {
  let initialWorkspace = ''
  let active = await launchApp({
    prepareUserData: (profile) => {
      initialWorkspace = join(profile, 'initial-workspace')
      mkdirSync(initialWorkspace)
      const settingsFile = join(profile, 'app-settings.json')
      const settings = JSON.parse(readFileSync(settingsFile, 'utf8'))
      settings.defaultProjectPath = initialWorkspace
      writeFileSync(settingsFile, JSON.stringify(settings))
    }
  })
  await waitForAppReady(active.page)
  const profile = active.userDataDir
  const snapshot = () =>
    active.page.evaluate(() => window.deepchat.invoke('project.getSnapshot', {}))
  expect((await snapshot()).defaultProjectPath).toBe(initialWorkspace)

  const managedWorkspace = join(profile, 'workspaces', 'DeepChat')
  await active.page.evaluate(
    (path) => window.deepchat.invoke('config.setDefaultProjectPath', { path }),
    managedWorkspace
  )
  // Other live renderer/bootstrap callers may prepare this directory first.
  const prepared = await active.page.evaluate(() =>
    window.deepchat.invoke('project.ensureChatWorkspace', {})
  )
  expect(prepared.path).toBe(managedWorkspace)
  expect(statSync(managedWorkspace).isDirectory()).toBe(true)
  expect(await snapshot()).toMatchObject({
    version: prepared.version,
    defaultProjectPath: managedWorkspace,
    defaultChatWorkspacePath: managedWorkspace
  })

  const firstPath = join(profile, 'selected-first')
  const secondPath = join(profile, 'selected-second')
  mkdirSync(firstPath)
  mkdirSync(secondPath)
  await active.electronApp.evaluate(
    ({ dialog, shell }, paths) => {
      const selections = [
        { canceled: true, filePaths: [] },
        { canceled: false, filePaths: [paths.firstPath] },
        { canceled: false, filePaths: [paths.secondPath] }
      ]
      const calls: { kind: string; path?: string }[] = []
      Reflect.set(globalThis, '__projectHostCalls', calls)
      dialog.showOpenDialog = (async () => {
        calls.push({ kind: 'selectDirectory' })
        const result = selections.shift()
        if (!result) throw new Error('Unexpected native directory selection')
        return result
      }) as typeof dialog.showOpenDialog
      shell.openPath = async (path) => {
        calls.push({ kind: 'openPath', path })
        return path === paths.secondPath ? 'Fixture native open failed' : ''
      }
    },
    { firstPath, secondPath }
  )

  const canceled = await active.page.evaluate(() =>
    window.deepchat.invoke('project.selectDirectory', {})
  )
  expect(canceled).toEqual({ path: null, version: prepared.version })
  expect((await snapshot()).version).toBe(prepared.version)
  for (const path of [firstPath, secondPath]) {
    const selected = await active.page.evaluate(() =>
      window.deepchat.invoke('project.selectDirectory', {})
    )
    expect(selected.path).toBe(path)
    expect((await snapshot()).version).toBe(selected.version)
  }
  await active.page.evaluate(
    (path) => window.deepchat.invoke('project.openDirectory', { path: ` ${path} ` }),
    firstPath
  )
  await expect(
    active.page.evaluate(
      (path) => window.deepchat.invoke('project.openDirectory', { path }),
      secondPath
    )
  ).rejects.toThrow('Fixture native open failed')
  expect(
    await active.electronApp.evaluate(() => Reflect.get(globalThis, '__projectHostCalls'))
  ).toEqual([
    { kind: 'selectDirectory' },
    { kind: 'selectDirectory' },
    { kind: 'selectDirectory' },
    { kind: 'openPath', path: firstPath },
    { kind: 'openPath', path: secondPath }
  ])

  await active.page.evaluate(
    (paths) => window.deepchat.invoke('project.reorderEnvironments', { paths }),
    [firstPath, secondPath]
  )
  expect((await snapshot()).environments.slice(0, 2).map((item) => item.path)).toEqual([
    firstPath,
    secondPath
  ])
  await active.page.evaluate(
    (path) => window.deepchat.invoke('project.archiveEnvironment', { path }),
    secondPath
  )
  expect((await snapshot()).archivedEnvironments.map((item) => item.path)).toContain(secondPath)
  await active.page.evaluate(
    (path) => window.deepchat.invoke('project.restoreEnvironment', { path }),
    secondPath
  )

  const { session } = await active.page.evaluate(
    (projectDir) =>
      window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        providerId: 'openai',
        modelId: 'gpt-5.6-luna',
        message: '',
        projectDir
      }),
    firstPath
  )
  await active.page.evaluate(
    (path) => window.deepchat.invoke('config.setDefaultProjectPath', { path }),
    firstPath
  )
  const removed = await active.page.evaluate(
    (path) => window.deepchat.invoke('project.removeEnvironment', { path }),
    firstPath
  )
  expect(removed.clearedSessionIds).toContain(session.id)
  const expected = await snapshot()
  expect(expected.defaultProjectPath).toBeNull()
  expect(expected.removedEnvironments.map((item) => item.path)).toContain(firstPath)
  expect(expected.environments.map((item) => item.path)).not.toContain(firstPath)
  expect(existsSync(firstPath)).toBe(true)
  const restored = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    session.id
  )
  expect(restored.session?.projectDir).toBeNull()

  expect(await active.close()).toBe('graceful')
  active = await launchApp()
  await waitForAppReady(active.page)
  expect(active.userDataDir).toBe(profile)
  expect(await snapshot()).toEqual(expected)
  const afterRestart = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    session.id
  )
  expect(afterRestart.session?.projectDir).toBeNull()
  expect(await active.close()).toBe('graceful')
})
