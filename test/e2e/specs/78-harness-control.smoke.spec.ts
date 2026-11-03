import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Page } from '@playwright/test'
import type { AssistantMessageBlock } from '../../../src/shared/types/agent-interface'
import { test, expect, type ElectronAppInstance } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

const MODEL = 'harness-control-fixture'
const PROVIDER = 'custom-harness-control-fixture'
const QUESTIONS = 'HARNESS_CONTROL_QUESTIONS'
const ACTIVE = 'HARNESS_CONTROL_ACTIVE'
const PROMOTED = 'HARNESS_CONTROL_PROMOTED'
const TAIL = 'HARNESS_CONTROL_TAIL'
const RESTORED_A = 'HARNESS_CONTROL_RESTORED_A'
const RESTORED_B = 'HARNESS_CONTROL_RESTORED_B'
const BARRIER = 'HARNESS_CONTROL_BARRIER'
const FIRST = 'control-question-first'
const SECOND = 'control-question-second'

async function startModel() {
  const requests: Array<{ marker: string; toolIds: string[]; toolText: string }> = []
  const cancelled = new Set<string>()
  const errors: string[] = []
  const gates = new Map([
    [ACTIVE, Promise.withResolvers<void>()],
    [TAIL, Promise.withResolvers<void>()]
  ])
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/v1/models') {
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ data: [{ id: MODEL }] }))
        return
      }
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      let source = ''
      for await (const chunk of request) source += chunk
      const body = JSON.parse(source) as {
        stream?: boolean
        messages: Array<{ role: string; content: unknown; tool_call_id?: string }>
      }
      if (!body.stream) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            id: 'control-title',
            object: 'chat.completion',
            created: 1,
            model: MODEL,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Harness control' },
                finish_reason: 'stop'
              }
            ]
          })
        )
        return
      }
      const lastUser = JSON.stringify(
        body.messages.filter((message) => message.role === 'user').at(-1)?.content
      )
      const marker = [QUESTIONS, ACTIVE, PROMOTED, TAIL, RESTORED_A, RESTORED_B, BARRIER].find(
        (value) => lastUser?.includes(value)
      )
      if (!marker) throw new Error(`Unexpected fixture request: ${lastUser}`)
      const toolResults = body.messages.filter((message) => message.role === 'tool')
      requests.push({
        marker,
        toolIds: toolResults.map((message) => message.tool_call_id ?? ''),
        toolText: JSON.stringify(toolResults.map((message) => message.content))
      })
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const emit = (delta: unknown, finishReason: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({
            id: `control-${marker}`,
            object: 'chat.completion.chunk',
            created: 1,
            model: MODEL,
            choices: [{ index: 0, delta, finish_reason: finishReason }]
          })}\n\n`
        )
      if (marker === QUESTIONS && toolResults.length === 0) {
        emit(
          {
            role: 'assistant',
            tool_calls: [FIRST, SECOND].map((id, index) => ({
              index,
              id,
              type: 'function',
              function: {
                name: 'deepchat_question',
                arguments: JSON.stringify({
                  question: index === 0 ? 'Choose the first answer.' : 'Choose the second answer.',
                  options: [{ label: index === 0 ? 'FIRST_ANSWER' : 'SECOND_ANSWER' }],
                  custom: false
                })
              }
            }))
          },
          'tool_calls'
        )
      } else {
        emit({ role: 'assistant', content: `${marker}_STARTED` })
        const gate = gates.get(marker)
        if (gate) {
          response.once('close', () => {
            if (!response.writableEnded) cancelled.add(marker)
            gate.resolve()
          })
          await gate.promise
        }
        if (response.destroyed) return
        emit({ content: ` ${marker}_DONE` }, 'stop')
      }
      response.end('data: [DONE]\n\n')
    } catch (error) {
      errors.push(String(error))
      if (!response.destroyed) {
        if (!response.headersSent) response.writeHead(500)
        response.end()
      }
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const release = () => {
    for (const gate of gates.values()) gate.resolve()
  }
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    cancelled,
    errors,
    release,
    async close() {
      release()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

async function configure(app: ElectronAppInstance, baseUrl: string) {
  expect(app.ownsUserDataDir).toBe(true)
  await waitForAppReady(app.page)
  await app.page.evaluate(
    async ({ baseUrl, providerId, modelId }) => {
      await window.deepchat.invoke('providers.add', {
        provider: {
          id: providerId,
          name: 'Harness control fixture',
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
          id: modelId,
          name: 'Harness control fixture',
          enabled: true,
          vision: false,
          functionCall: true,
          reasoning: false,
          contextLength: 32000,
          maxTokens: 8000
        }
      })
      await window.deepchat.invoke('models.setStatus', { providerId, modelId, enabled: true })
      const { config } = await window.deepchat.invoke('config.resolveDeepChatAgentConfig', {
        agentId: 'deepchat'
      })
      await window.deepchat.invoke('config.updateDeepChatAgent', {
        agentId: 'deepchat',
        updates: {
          config: {
            ...config,
            memoryEnabled: false,
            subagentEnabled: false,
            permissionMode: 'full_access',
            enabledSkillNames: [],
            disabledAgentTools: []
          }
        }
      })
    },
    { baseUrl, providerId: PROVIDER, modelId: MODEL }
  )
}

async function createSession(app: ElectronAppInstance, message: string) {
  return await app.page.evaluate(
    async ({ message, projectDir, providerId, modelId }) => {
      const { session } = await window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        message,
        projectDir,
        providerId,
        modelId,
        permissionMode: 'full_access',
        toolModeOverride: 'agent'
      })
      return session.id
    },
    {
      message,
      projectDir: join(app.userDataDir, 'control-workspace'),
      providerId: PROVIDER,
      modelId: MODEL
    }
  )
}

const restore = (page: Page, sessionId: string) =>
  page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 100 }),
    sessionId
  )
const pending = (page: Page, sessionId: string) =>
  page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.listPendingInputs', { sessionId }),
    sessionId
  )
const blocks = (content: string) => JSON.parse(content) as AssistantMessageBlock[]
const questionActions = (content: string) =>
  blocks(content).filter(
    (block) => block.type === 'action' && block.action_type === 'question_request'
  )
const pendingQuestions = (content: string) =>
  questionActions(content).filter(
    (block) => block.status === 'pending' && block.extra?.needsUserAction !== false
  )

function storedFacts(userDataDir: string, sessionId: string) {
  const db = new Database(join(userDataDir, 'app_db', 'agent.db'), { readonly: true })
  try {
    return {
      messages: db
        .prepare(
          'SELECT role, content, metadata FROM deepchat_messages WHERE session_id = ? ORDER BY order_seq'
        )
        .all(sessionId) as Array<{ role: string; content: string; metadata: string }>,
      pending: db
        .prepare(
          "SELECT state, payload_json FROM deepchat_pending_inputs WHERE session_id = ? AND state != 'consumed'"
        )
        .all(sessionId) as Array<{ state: string; payload_json: string }>
    }
  } finally {
    db.close()
  }
}

test('ordered questions resume once through public interaction routes @smoke', async ({
  launchApp
}) => {
  const model = await startModel()
  let app: ElectronAppInstance | undefined
  try {
    app = await launchApp({
      prepareUserData: (directory) =>
        mkdirSync(join(directory, 'control-workspace'), { recursive: true })
    })
    await configure(app, model.baseUrl)
    const sessionId = await createSession(app, QUESTIONS)
    const page = app.page
    await expect
      .poll(async () =>
        (await restore(page, sessionId)).messages
          .filter((message) => message.role === 'assistant')
          .flatMap((message) =>
            pendingQuestions(message.content).map((block) => block.tool_call?.id)
          )
      )
      .toEqual([FIRST, SECOND])
    const snapshot = await restore(page, sessionId)
    const messageId = snapshot.messages.find(
      (message) => message.role === 'assistant' && pendingQuestions(message.content).length === 2
    )!.id
    const reply = (toolCallId: string, optionLabel: string) =>
      page.evaluate(
        async (input) => {
          try {
            return { value: await window.deepchat.invoke('chat.respondToolInteraction', input) }
          } catch (error) {
            return { error: String(error) }
          }
        },
        {
          sessionId,
          messageId,
          toolCallId,
          response: { kind: 'question_option' as const, optionLabel }
        }
      )
    expect(await reply(SECOND, 'SECOND_ANSWER')).toMatchObject({
      error: expect.stringMatching(/out of order/i)
    })
    const firstReplies = await Promise.all([
      reply(FIRST, 'FIRST_ANSWER'),
      reply(FIRST, 'FIRST_ANSWER')
    ])
    expect(firstReplies.some((result) => result.value?.accepted)).toBe(true)
    expect(firstReplies.every((result) => result.value?.resumed !== true)).toBe(true)
    expect(model.requests).toHaveLength(1)
    expect(
      (await restore(page, sessionId)).messages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => pendingQuestions(message.content).map((block) => block.tool_call?.id))
    ).toEqual([SECOND])
    expect(await reply(SECOND, 'SECOND_ANSWER')).toMatchObject({
      value: { accepted: true, resumed: true }
    })
    await expect.poll(async () => (await restore(page, sessionId)).session?.status).toBe('idle')
    const finished = await restore(page, sessionId)
    expect(
      questionActions(finished.messages.find((message) => message.id === messageId)!.content).map(
        (block) => block.extra?.answerText
      )
    ).toEqual(['FIRST_ANSWER', 'SECOND_ANSWER'])
    expect(model.requests.map((request) => request.toolIds)).toEqual([[], [FIRST, SECOND]])
    expect(model.requests[1].toolText).toContain('FIRST_ANSWER')
    expect(model.requests[1].toolText).toContain('SECOND_ANSWER')
    expect(model.errors).toEqual([])
    expect(app.pageErrors).toEqual([])
    expect(await app.close()).toBe('graceful')
  } finally {
    model.release()
    try {
      await app?.close()
    } finally {
      await model.close()
    }
  }
})

test('Steer cancellation and queue recovery preserve each user fact once @smoke', async ({
  launchApp
}) => {
  const model = await startModel()
  let app: ElectronAppInstance | undefined
  try {
    app = await launchApp({
      prepareUserData: (directory) =>
        mkdirSync(join(directory, 'control-workspace'), { recursive: true })
    })
    await configure(app, model.baseUrl)
    const sessionId = await createSession(app, ACTIVE)
    await expect.poll(() => model.requests.map((request) => request.marker)).toEqual([ACTIVE])
    await expect
      .poll(async () =>
        (await restore(app!.page, sessionId)).messages
          .filter((message) => message.role === 'assistant')
          .flatMap((message) => blocks(message.content))
          .some((block) => block.content?.includes(`${ACTIVE}_STARTED`))
      )
      .toBe(true)
    const queued = await app.page.evaluate(
      async ({ sessionId, promoted, tail }) => {
        const first = await window.deepchat.invoke('sessions.queuePendingInput', {
          sessionId,
          content: promoted
        })
        const second = await window.deepchat.invoke('sessions.queuePendingInput', {
          sessionId,
          content: tail
        })
        const result = await window.deepchat.invoke('sessions.steerPendingInput', {
          sessionId,
          itemId: first.item.id
        })
        return { promoted: result.item, tail: second.item }
      },
      { sessionId, promoted: PROMOTED, tail: TAIL }
    )
    expect(queued.promoted.mode).toBe('steer')
    expect(queued.tail.state).toBe('pending')
    expect(
      await app.page.evaluate(
        (sessionId) => window.deepchat.invoke('chat.stopStream', { sessionId }),
        sessionId
      )
    ).toEqual({ stopped: true })
    await expect.poll(() => model.cancelled.has(ACTIVE)).toBe(true)
    await expect
      .poll(() => model.requests.map((request) => request.marker))
      .toEqual([ACTIVE, PROMOTED, TAIL])
    await app.page.evaluate(
      async ({ sessionId, first, second }) => {
        await window.deepchat.invoke('sessions.queuePendingInput', { sessionId, content: first })
        await window.deepchat.invoke('sessions.queuePendingInput', { sessionId, content: second })
      },
      { sessionId, first: RESTORED_A, second: RESTORED_B }
    )
    expect((await pending(app.page, sessionId)).items.map((item) => item.payload.text)).toEqual([
      RESTORED_A,
      RESTORED_B
    ])
    expect(await app.close()).toBe('graceful')
    const interrupted = storedFacts(app.userDataDir, sessionId)
    expect(
      interrupted.pending
        .filter((row) => [RESTORED_A, RESTORED_B].includes(JSON.parse(row.payload_json).text))
        .map((row) => row.state)
    ).toEqual(['pending', 'pending'])
    app = await launchApp()
    await waitForAppReady(app.page)
    const barrierId = await createSession(app, BARRIER)
    await expect
      .poll(async () => (await restore(app!.page, barrierId)).session?.status)
      .toBe('idle')
    expect(model.requests.map((request) => request.marker)).toEqual([
      ACTIVE,
      PROMOTED,
      TAIL,
      BARRIER
    ])
    const recovered = await pending(app.page, sessionId)
    expect(recovered.resumeAvailable).toBe(true)
    expect(recovered.items.map((item) => ({ text: item.payload.text, state: item.state }))).toEqual(
      [
        { text: RESTORED_A, state: 'pending' },
        { text: RESTORED_B, state: 'pending' }
      ]
    )
    expect(
      await app.page.evaluate(
        (sessionId) => window.deepchat.invoke('sessions.resumePendingQueue', { sessionId }),
        sessionId
      )
    ).toEqual({ started: true })
    await expect.poll(async () => (await pending(app!.page, sessionId)).items).toEqual([])
    await expect
      .poll(async () => (await restore(app!.page, sessionId)).session?.status)
      .toBe('idle')
    expect(model.requests.map((request) => request.marker)).toEqual([
      ACTIVE,
      PROMOTED,
      TAIL,
      BARRIER,
      RESTORED_A,
      RESTORED_B
    ])
    expect(model.errors).toEqual([])
    expect(app.pageErrors).toEqual([])
    const messages = (await restore(app.page, sessionId)).messages
    expect(
      messages
        .filter((message) => message.role === 'user')
        .map((message) => JSON.parse(message.content).text)
    ).toEqual([ACTIVE, PROMOTED, TAIL, RESTORED_A, RESTORED_B])
    expect(await app.close()).toBe('graceful')
    const persisted = storedFacts(app.userDataDir, sessionId)
    expect(persisted.pending).toEqual([])
    expect(
      persisted.messages
        .filter((message) => message.role === 'user')
        .map((message) => JSON.parse(message.content).text)
    ).toEqual([ACTIVE, PROMOTED, TAIL, RESTORED_A, RESTORED_B])
    expect(
      persisted.messages.some(
        (message) =>
          message.role === 'assistant' && JSON.parse(message.metadata).runOutcome === 'aborted'
      )
    ).toBe(true)
  } finally {
    model.release()
    try {
      await app?.close()
    } finally {
      await model.close()
    }
  }
})
