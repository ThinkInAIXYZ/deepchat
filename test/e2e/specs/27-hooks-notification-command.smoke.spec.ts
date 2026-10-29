import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  HookEventPayload,
  HooksNotificationsSettings
} from '../../../src/shared/hooksNotifications'
import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

const prepareHookProfile = (profile: string): void => {
  const workspace = join(profile, 'hook-workspace')
  mkdirSync(workspace)
  const file = join(profile, 'app-settings.json')
  const settings = JSON.parse(readFileSync(file, 'utf8'))
  settings.defaultProjectPath = workspace
  writeFileSync(file, JSON.stringify(settings))
}

test('notification hooks can save test command and restore config @smoke', async ({
  launchApp
}) => {
  let app = await launchApp({ prepareUserData: prepareHookProfile })
  await waitForAppReady(app.page)
  const expectedVersion = await app.electronApp.evaluate(({ app }) => app.getVersion())

  let settingsPage = await openSettings(app)
  const hookId = `deepchat-e2e-hook-${Date.now()}`
  let originalConfig: HooksNotificationsSettings | null = null

  try {
    originalConfig = await settingsPage.evaluate(async () => {
      const result = (await window.deepchat.invoke('config.getHooksNotifications', {})) as {
        config: HooksNotificationsSettings
      }
      return result.config
    })

    const tempConfig: HooksNotificationsSettings = {
      hooks: [
        ...(originalConfig?.hooks ?? []).filter((hook) => hook.id !== hookId),
        {
          id: hookId,
          name: 'DeepChat E2E Hook',
          enabled: true,
          command:
            "node -e \"let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>console.log('deepchat-hook-e2e-ok '+JSON.parse(raw).app.version))\"",
          events: ['SessionStart']
        }
      ]
    }

    const savedConfig = (await settingsPage.evaluate(
      async ({ config }) => {
        return await window.deepchat.invoke('config.setHooksNotifications', { config })
      },
      { config: tempConfig }
    )) as {
      config?: HooksNotificationsSettings
    }
    expect(savedConfig.config?.hooks.some((hook) => hook.id === hookId)).toBe(true)

    await openSettingsTab(settingsPage, 'settings-tab-notifications-hooks')
    await expect(settingsPage.getByTestId('settings-notifications-hooks-page')).toBeVisible({
      timeout: 30_000
    })
    await expect(settingsPage.getByTestId(`notifications-hook-${hookId}`)).toBeVisible({
      timeout: 30_000
    })

    const testResult = (await settingsPage.evaluate(
      async ({ hookId }) => {
        return await window.deepchat.invoke('config.testHookCommand', { hookId })
      },
      { hookId }
    )) as {
      result?: {
        durationMs?: unknown
        exitCode?: unknown
        stdout?: unknown
        success?: unknown
      }
    }

    expect(testResult.result?.success).toBe(true)
    expect(testResult.result?.exitCode).toBe(0)
    expect(typeof testResult.result?.durationMs).toBe('number')
    expect(String(testResult.result?.stdout ?? '')).toContain(
      `deepchat-hook-e2e-ok ${expectedVersion}`
    )
    expect(await app.close()).toBe('graceful')
    app = await launchApp()
    await waitForAppReady(app.page)
    expect(
      await app.page.evaluate(() => window.deepchat.invoke('config.getHooksNotifications', {}))
    ).toEqual({ config: tempConfig })
    settingsPage = await openSettings(app)
  } finally {
    if (originalConfig) {
      await settingsPage
        .evaluate(
          async ({ config }) => {
            await window.deepchat.invoke('config.setHooksNotifications', { config })
          },
          { config: originalConfig }
        )
        .catch(() => undefined)
    }
  }
})

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

test('hook shutdown retains native child lifetime until stdio closes @smoke', async ({
  launchApp
}) => {
  let active = await launchApp({ prepareUserData: prepareHookProfile })
  await waitForAppReady(active.page)
  const profile = active.userDataDir
  const releaseFile = join(profile, 'hook-release')
  const pidFile = join(profile, 'hook-child.json')
  const payloadFile = join(profile, 'hook-payload.json')
  writeFileSync(
    join(profile, 'hook-lifecycle.cjs'),
    `
const fs = require('node:fs')
const path = require('node:path')
let raw = ''
process.stdin.on('data', chunk => { raw += chunk })
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(__dirname, 'hook-payload.json'), raw)
  fs.writeFileSync(path.join(__dirname, 'hook-child.json'), JSON.stringify({ pid: process.pid, parent: process.ppid }))
  setInterval(() => {
    if (fs.existsSync(path.join(__dirname, 'hook-release'))) process.exit(0)
  }, 25)
})
`
  )
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    const result = { id: 'hook-fixture', model: 'hook-fixture', created: 1 }
    if (!JSON.parse(body).stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          ...result,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hook fixture' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    response
      .writeHead(200, { 'Content-Type': 'text/event-stream' })
      .end(
        `data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'HOOK_COMPLETE' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  let childPid: number | undefined
  let closing: Promise<'graceful' | 'forced'> | undefined
  try {
    const sessionId = await active.page.evaluate(
      async ({ baseUrl, projectDir }) => {
        const providerId = `custom-${crypto.randomUUID()}`
        await window.deepchat.invoke('providers.add', {
          provider: {
            id: providerId,
            name: 'Hook fixture',
            apiType: 'openai-completions',
            baseUrl,
            apiKey: 'fixture-key',
            enable: true,
            custom: true
          }
        })
        await window.deepchat.invoke('models.addCustom', {
          providerId,
          model: {
            id: 'hook-fixture',
            name: 'Hook fixture',
            enabled: true,
            vision: false,
            functionCall: false,
            reasoning: false,
            contextLength: 32000,
            maxTokens: 8000
          }
        })
        await window.deepchat.invoke('models.setStatus', {
          providerId,
          modelId: 'hook-fixture',
          enabled: true
        })
        const { config } = await window.deepchat.invoke('config.resolveDeepChatAgentConfig', {
          agentId: 'deepchat'
        })
        await window.deepchat.invoke('config.updateDeepChatAgent', {
          agentId: 'deepchat',
          updates: {
            config: {
              ...config,
              memoryEnabled: false,
              enabledMcpServerIds: [],
              enabledSkillNames: []
            }
          }
        })
        await window.deepchat.invoke('config.setHooksNotifications', {
          config: {
            hooks: [
              {
                id: 'held-hook',
                name: 'Held hook',
                enabled: true,
                command: 'node hook-lifecycle.cjs && node -e "process.exit(0)"',
                events: ['SessionStart']
              }
            ]
          }
        })
        const { session } = await window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          providerId,
          modelId: 'hook-fixture',
          message: 'Run the owned hook.',
          projectDir
        })
        return session.id
      },
      { baseUrl: `http://127.0.0.1:${port}/v1`, projectDir: profile }
    )
    await expect.poll(() => existsSync(pidFile)).toBe(true)
    const child = JSON.parse(readFileSync(pidFile, 'utf8')) as { pid: number; parent: number }
    childPid = child.pid
    expect(child.pid).toBeGreaterThan(0)
    expect(child.parent).toBeGreaterThan(0)
    await expect
      .poll(async () =>
        JSON.stringify(
          await active.page.evaluate(
            (sessionId) =>
              window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
            sessionId
          )
        )
      )
      .toContain('HOOK_COMPLETE')
    const savedPayload = readFileSync(payloadFile, 'utf8')
    const payload = JSON.parse(savedPayload) as HookEventPayload
    const version = await active.electronApp.evaluate(({ app }) => app.getVersion())
    expect(payload).toMatchObject({
      payloadVersion: 1,
      event: 'SessionStart',
      isTest: false,
      app: { version, platform: process.platform },
      session: { conversationId: sessionId, workdir: profile }
    })

    let closed = false
    closing = active.close().then((outcome) => {
      closed = true
      return outcome
    })
    await expect
      .poll(() => processIsAlive(child.parent), { timeout: 5000, intervals: [25, 50, 100] })
      .toBe(false)
    expect(processIsAlive(child.pid)).toBe(true)
    expect(closed).toBe(false)
    expect(active.electronApp.process().exitCode).toBeNull()
    writeFileSync(releaseFile, 'release')
    expect(await closing).toBe('graceful')
    await expect.poll(() => processIsAlive(child.pid)).toBe(false)

    active = await launchApp()
    await waitForAppReady(active.page)
    expect(readFileSync(payloadFile, 'utf8')).toBe(savedPayload)
    expect(await active.close()).toBe('graceful')
  } finally {
    writeFileSync(releaseFile, 'release')
    let cleanupError: unknown
    if (childPid !== undefined && processIsAlive(childPid)) {
      try {
        await expect.poll(() => processIsAlive(childPid!), { timeout: 5000 }).toBe(false)
      } catch (error) {
        process.kill(childPid, 'SIGKILL')
        cleanupError = error
      }
    }
    if (closing) await closing
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (cleanupError) throw cleanupError
  }
})
