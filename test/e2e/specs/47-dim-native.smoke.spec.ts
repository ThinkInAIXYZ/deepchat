import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { unzipSync } from 'fflate'
import { SyncImportRecovery } from '../../../src/main/sync/importRecovery'
import { DimProfileBackups } from '../../../src/main/agent/dim/profileBackups'
import { captureDimProfile } from '../../../src/main/agent/dim/profileSnapshot'
import type { DimRuntimeSupervisor } from '../../../src/main/agent/dim/runtimeSupervisor'
import { test, expect } from '../fixtures/electronApp'
import {
  getActiveSessionId,
  getAssistantMessages,
  openSessionById,
  selectAgent,
  selectModel,
  sendMessage
} from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

test('desktop chat uses persistent native dim sessions @smoke', async ({ app, launchApp }) => {
  const requests: Array<{ messages?: unknown[]; tools?: Array<{ function: { name: string } }> }> =
    []
  let readSession: { sessionId: string; messageId: string; action: 'messages' | 'message' } | null =
    null
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'dim-desktop-fixture' }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    requests.push(body)
    if (body.stream && readSession) {
      const target = readSession
      const args = {
        sessionId: target.sessionId,
        action: target.action,
        ...(target.action === 'message' ? { messageId: target.messageId } : {})
      }
      readSession = target.action === 'messages' ? { ...target, action: 'message' } : null
      response
        .writeHead(200, { 'Content-Type': 'text/event-stream' })
        .end(
          `data: ${JSON.stringify({ id: 'native-read', object: 'chat.completion.chunk', created: 0, model: 'dim-desktop-fixture', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `desktop-read-${target.action}`, type: 'function', function: { name: 'read_session', arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
        )
      return
    }
    const content = 'NATIVE_DIM_DESKTOP_REPLY'
    if (body.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'dim-desktop', object: 'chat.completion.chunk', created: 0, model: 'dim-desktop-fixture', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`
      )
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'dim-desktop',
          object: 'chat.completion',
          created: 0,
          model: 'dim-desktop-fixture',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
        })
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await waitForAppReady(app.page)
    await app.page.evaluate(() =>
      window.deepchat.invoke('settings.update', {
        changes: [{ key: 'traceDebugEnabled', value: true }]
      })
    )
    const providerId = await app.page.evaluate(
      async (baseUrl) => {
        const id = `custom-${crypto.randomUUID()}`
        await window.deepchat.invoke('providers.add', {
          provider: {
            id,
            name: 'Native dim fixture',
            apiType: 'openai-completions',
            baseUrl,
            apiKey: 'dim-fixture-secret',
            enable: true,
            custom: true
          }
        })
        await window.deepchat.invoke('models.addCustom', {
          providerId: id,
          model: {
            id: 'dim-desktop-fixture',
            name: 'Native dim',
            enabled: true,
            vision: false,
            functionCall: true,
            reasoning: false,
            contextLength: 32000,
            maxTokens: 8000
          }
        })
        await window.deepchat.invoke('models.setStatus', {
          providerId: id,
          modelId: 'dim-desktop-fixture',
          enabled: true
        })
        return id
      },
      `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    )
    await selectAgent(app.page)
    await selectModel(app.page, 'dim-desktop-fixture', providerId)
    const catalog = await app.page.evaluate(() =>
      window.deepchat.invoke('tools.listDefinitions', { chatMode: 'agent' })
    )
    const nativeNames = catalog.tools
      .filter((tool) => tool.server.name === 'dim')
      .map((tool) => tool.function.name)
    expect(nativeNames).toEqual(
      expect.arrayContaining([
        'read',
        'exec',
        'exec_stop',
        'ask_user',
        'skill',
        'agent',
        'schedule'
      ])
    )
    expect(catalog.tools.map((tool) => tool.function.name)).not.toContain('deepchat_question')
    expect(requests).toHaveLength(0)
    const checked = await app.page.evaluate(
      (providerId) =>
        window.deepchat.invoke('providers.testConnection', {
          providerId,
          modelId: 'dim-desktop-fixture'
        }),
      providerId
    )
    expect(checked).toEqual({ isOk: true, errorMsg: null })
    const draft = await app.page.evaluate(
      ({ providerId, baseUrl }) =>
        window.deepchat.invoke('providers.validateDraft', {
          provider: {
            id: providerId,
            name: 'Unsaved Native draft',
            apiType: 'openai-completions',
            enable: false,
            apiKey: 'unsaved-draft-key',
            baseUrl
          },
          loadModels: false
        }),
      { providerId, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }
    )
    expect(draft).toEqual({ isOk: true, errorMsg: null, models: [] })

    const cli = await promisify(execFile)(
      process.execPath,
      [
        path.resolve('out/cli/deepchat.mjs'),
        'model',
        'invoke',
        '--provider',
        providerId,
        '--model',
        'dim-desktop-fixture',
        '--prompt',
        'NATIVE_CLI_INPUT',
        '--jsonl'
      ],
      { env: { ...process.env, DEEPCHAT_E2E_USER_DATA_DIR: app.userDataDir }, timeout: 30_000 }
    )
    expect(cli.stdout).toContain('text_delta')
    expect(cli.stdout).toContain('NATIVE_DIM_DESKTOP_REPLY')
    expect(cli.stdout).toContain('stop')
    await sendMessage(app.page, 'NATIVE_DIM_FIRST_INPUT')
    await expect(getAssistantMessages(app.page)).toHaveCount(1)
    await expect(getAssistantMessages(app.page).last()).toContainText('NATIVE_DIM_DESKTOP_REPLY')
    await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute(
      'data-generating',
      'false'
    )
    const sessionId = await getActiveSessionId(app.page)
    await expect
      .poll(async () =>
        app.page.evaluate(async (id) => {
          const page = await window.deepchat.invoke('sessions.listLightweight', {})
          return page.items.find((session) => session.id === id)?.title
        }, sessionId)
      )
      .toBe('NATIVE_DIM_DESKTOP_REPLY')
    const renamed = await app.page.evaluate(
      (id) =>
        window.deepchat.invoke('sessions.rename', {
          sessionId: id,
          title: 'NATIVE_MANUAL_TITLE'
        }),
      sessionId
    )
    expect(renamed.session.title).toBe('NATIVE_MANUAL_TITLE')
    const firstPage = await app.page.evaluate(
      (id) => window.deepchat.invoke('sessions.listMessagesPage', { sessionId: id }),
      sessionId
    )
    const original = firstPage.messages.map((message) => ({
      id: message.id,
      metadata: JSON.parse(message.metadata)
    }))
    expect(original.length).toBeGreaterThanOrEqual(2)
    expect(original.every((message) => message.metadata.dim?.sessionId)).toBe(true)
    const nativeId = original[0].metadata.dim.sessionId
    const disabled = await app.page.evaluate(async (id) => {
      await window.deepchat.invoke('sessions.updateDisabledAgentTools', {
        sessionId: id,
        disabledAgentTools: ['deepchat_question', 'process', 'cronjob']
      })
      return window.deepchat.invoke('sessions.getDisabledAgentTools', { sessionId: id })
    }, sessionId)
    expect(disabled.disabledAgentTools).toEqual(['ask_user', 'exec_stop', 'schedule'])
    const names = requests.flatMap(
      (request) => request.tools?.map((tool) => tool.function.name) ?? []
    )
    expect(names.length).toBeGreaterThan(0)
    expect(names).not.toContain('run_code')
    expect(names).not.toContain('tool_search')
    const failedImport = await app.page.evaluate(
      async (folderPath) => {
        await window.deepchat.invoke('config.updateSyncSettings', { enabled: false, folderPath })
        return window.deepchat.invoke('sync.import', {
          backupFile: 'backup-0.zip',
          mode: 'increment'
        })
      },
      path.join(app.userDataDir, 'missing-maintenance-backups')
    )
    expect(failedImport.result.success).toBe(false)
    const afterMaintenance = await app.page.evaluate(
      (id) => window.deepchat.invoke('sessions.listMessagesPage', { sessionId: id }),
      sessionId
    )
    expect(afterMaintenance.messages.map((message) => message.id)).toEqual(
      firstPage.messages.map((message) => message.id)
    )
    const captured = await app.page.evaluate(
      async (folderPath) => {
        await window.deepchat.invoke('config.updateSyncSettings', { enabled: true, folderPath })
        return window.deepchat.invoke('sync.startBackup', {})
      },
      path.join(app.userDataDir, 'native-backups')
    )
    expect(captured.backup).not.toBeNull()
    const archive = unzipSync(
      await readFile(path.join(app.userDataDir, 'native-backups', captured.backup!.fileName))
    )
    const manifest = JSON.parse(Buffer.from(archive['manifest.json']).toString('utf8'))
    expect(manifest).toMatchObject({ version: 3, nativeProfile: 'dim/manifest.json' })
    expect(archive['dim/profile/rust/dimcode.sqlite']).toBeDefined()
    expect(archive['dim/profile/deepchat-plugin-rows.json']).toBeUndefined()
    await app.page.evaluate(
      (id) =>
        window.deepchat.invoke('sessions.rename', {
          sessionId: id,
          title: 'AFTER_BACKUP_TITLE'
        }),
      sessionId
    )
    const restoredBackup = await app.page.evaluate(
      (fileName) =>
        window.deepchat.invoke('sync.import', {
          backupFile: fileName,
          mode: 'overwrite'
        }),
      captured.backup!.fileName
    )
    expect(restoredBackup.result.success).toBe(true)
    const restoredMessages = await app.page.evaluate(
      (id) => window.deepchat.invoke('sessions.listMessagesPage', { sessionId: id }),
      sessionId
    )
    expect(restoredMessages.messages.map((message) => message.id)).toEqual(
      firstPage.messages.map((message) => message.id)
    )
    expect(await app.close()).toBe('graceful')
    // Leave an uncommitted import on disk, as if the process exited after the directory swap.
    // Startup must recover it before settings/SQL load; canonical Native bytes stay opaque.
    const lock = JSON.parse(
      await readFile(path.resolve('runtime/dim/plugins/native-host-lock.json'), 'utf8')
    )
    const cold = await captureDimProfile(path.join(app.userDataDir, 'dim'), os.tmpdir(), {
      sourceRevision: lock.sourceRevision,
      bridgeVersion: lock.bridgeVersion,
      storeFormat: lock.storeFormat
    })
    try {
      const prepared = await new DimProfileBackups({
        runtimeRoot: path.resolve('runtime/dim'),
        profileRoot: app.userDataDir,
        temporaryRoot: os.tmpdir(),
        host: {} as DimRuntimeSupervisor,
        readers: () => {
          throw new Error('Offline recovery fixture must not start readers')
        }
      }).prepareRestore(cold.directory, await cold.manifest())
      await SyncImportRecovery.begin(app.userDataDir, prepared.recoveryDirectory)
      await prepared.install()
      await writeFile(path.join(app.userDataDir, 'app_db/agent.db'), 'INTERRUPTED_IMPORT')
      await writeFile(path.join(app.userDataDir, 'app-settings.json'), '{')
    } finally {
      await cold.dispose()
    }
    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    await expect(
      readFile(path.join(app.userDataDir, 'sync-import-recovery.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    const sidebar = reopened.page.getByTestId('window-sidebar-toggle')
    if ((await sidebar.getAttribute('aria-expanded')) === 'false') await sidebar.click()
    await openSessionById(reopened.page, sessionId)
    const restoredTitle = await reopened.page.evaluate(async (id) => {
      const page = await window.deepchat.invoke('sessions.listLightweight', {})
      return page.items.find((session) => session.id === id)?.title
    }, sessionId)
    expect(restoredTitle).toBe('NATIVE_MANUAL_TITLE')
    await expect(getAssistantMessages(reopened.page).last()).toContainText(
      'NATIVE_DIM_DESKTOP_REPLY'
    )
    readSession = {
      sessionId,
      messageId: firstPage.messages.find((message) => message.role === 'user')!.id,
      action: 'messages'
    }
    await sendMessage(reopened.page, 'NATIVE_DIM_AFTER_RESTART')
    await expect(getAssistantMessages(reopened.page)).toHaveCount(2)
    await expect(getAssistantMessages(reopened.page).last()).toContainText(
      'NATIVE_DIM_DESKTOP_REPLY'
    )
    await expect(reopened.page.getByTestId('chat-page-shell')).toHaveAttribute(
      'data-generating',
      'false'
    )
    const restored = await reopened.page.evaluate(
      (id) => window.deepchat.invoke('sessions.listMessagesPage', { sessionId: id }),
      sessionId
    )
    const referenceBlocks = restored.messages
      .filter((message) => message.role === 'assistant')
      .flatMap(
        (message) =>
          JSON.parse(message.content) as Array<{
            status: string
            tool_call?: { id?: string; response?: string }
          }>
      )
    for (const action of ['messages', 'message']) {
      expect(
        referenceBlocks.find((block) => block.tool_call?.id === `desktop-read-${action}`)
      ).toMatchObject({
        status: 'success',
        tool_call: { response: expect.stringContaining('NATIVE_DIM_FIRST_INPUT') }
      })
    }
    expect(restored.messages.filter((message) => message.role === 'user')).toHaveLength(2)
    expect(restored.messages.filter((message) => message.role === 'assistant')).toHaveLength(2)
    expect(restored.messages.every((message) => message.status === 'sent')).toBe(true)
    expect(
      restored.messages.every((message) => JSON.parse(message.metadata).dim?.sessionId === nativeId)
    ).toBe(true)
    const continued = requests.findLast((request) =>
      JSON.stringify(request.messages).includes('NATIVE_DIM_AFTER_RESTART')
    )
    expect(JSON.stringify(continued?.messages)).toContain('NATIVE_DIM_FIRST_INPUT')
    expect(JSON.stringify(continued?.messages)).toContain('NATIVE_DIM_AFTER_RESTART')
    const inspection = await reopened.page.evaluate(async (id) => {
      const facts = await window.deepchat.invoke('sessions.listTapeInspectorPage', {
        sessionId: id,
        mode: 'tail',
        limit: 200
      })
      if (facts.status !== 'ok') throw new Error('Native timeline page unavailable')
      const call = facts.records.find((row) => row.name === 'model/call')!
      const detail = await window.deepchat.invoke('sessions.getTapeInspectorRecordDetail', {
        sessionId: id,
        expectedTapeIncarnationId: facts.tapeIncarnationId,
        entryId: call.entryId
      })
      return { facts, detail }
    }, sessionId)
    expect(inspection.facts.records.every((row) => row.dim?.sessionId === nativeId)).toBe(true)
    expect(inspection.detail.status).toBe('ok')
    await reopened.page.getByTestId('open-tape-inspector-button').click()
    await expect(reopened.page.getByTestId('tape-inspector-panel')).toBeVisible()
    await expect(reopened.page.getByTestId('tape-inspector-panel')).toContainText(
      /timeline events|时间线事件/
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
