import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { MainDatabase } from '@/data/mainDatabase'
import { createSessionData } from '@/session/data'
import {
  createDeepChatAgentHarness,
  type DeepChatHarnessDependencies
} from '@/agent/deepchat/harness'
import { createPassthroughModelRequestPolicy } from '@shared/modelRequestPolicy'
import { TOOL_EXECUTION } from '@shared/types/core/mcp'

const [phase, directory] = process.argv.slice(2)
assert(directory)
const marker = 'bounded-file-evidence-2488'
const filePath = join(directory, 'evidence.txt')
writeFileSync(filePath, marker)
let toolExecutions = 0
let providerRequests = 0
let cancelStarted = false
let cancelSignals = 0
const approvals = new Set<string>()
const events: Array<{ kind: string; value: any }> = []
const tool = {
  type: 'function',
  source: 'agent',
  execution: TOOL_EXECUTION.read.sequential,
  function: {
    name: 'read_fixture',
    description: 'Read the one authorized fixture file',
    parameters: { type: 'object', properties: {} }
  },
  server: { name: 'node-fixture', icons: '', description: 'Bounded native file reader' }
}
const shell = {
  profile: 'posix',
  dialect: 'posix',
  pathStyle: 'native',
  executable: '/bin/sh',
  args: ['-c'],
  displayName: 'sh'
}
const modelConfig = {
  temperature: 0.5,
  maxTokens: 2048,
  contextLength: 32000,
  vision: false,
  functionCall: true,
  type: 'chat'
}

function host() {
  const connection = new MainDatabase(join(directory, 'agent.db'))
  const data = createSessionData(connection, undefined, {
    publishPendingInputsChanged() {},
    publishMessagesChanged() {}
  })
  const settings = {
    getProviderDbSourceUrl: () => 'https://example.test/catalog',
    getProviderById: () => ({ id: 'fixture', apiType: 'openai-compatible' }),
    getModelConfig: () => modelConfig,
    getCapabilitySnapshot: ({ providerId, modelId }: { providerId: string; modelId: string }) => ({
      identity: {
        providerId,
        requestModelId: modelId,
        catalogMatched: true,
        catalogModelId: modelId
      },
      requestPolicy: createPassthroughModelRequestPolicy(),
      mediaSettings: { image: false, video: false },
      supportsAudioInput: false,
      supportsReasoning: false,
      supportsSearch: false,
      reasoningPortrait: { supported: false },
      searchDefaults: {}
    }),
    supportsAudioInputCapability: () => false,
    getAutoCompactionEnabled: () => false,
    getAutoCompactionTriggerThreshold: () => 80,
    getAutoCompactionRetainRecentPairs: () => 2,
    getSetting: () => undefined
  }
  const dependencies = {
    ...data.runtime,
    providerRuntime: {
      getRuntimeContextLimitTokens: async () => undefined,
      executeWithRateLimit: async () => {},
      async *streamChat(
        _provider: string,
        messages: any[],
        _model: string,
        _config: unknown,
        _temperature: number,
        _tokens: number,
        tools: any[],
        options: { signal?: AbortSignal }
      ) {
        providerRequests += 1
        assert.equal(tools.filter((item) => item.function.name === 'read_fixture').length, 1)
        const user = messages.filter((message) => message.role === 'user').at(-1)
        const text = JSON.stringify(user?.content)
        if (text.includes('cancel') || text.includes('crash')) {
          cancelStarted = true
          await new Promise<void>((_resolve, reject) => {
            const abort = () => {
              cancelSignals += 1
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
            }
            if (options.signal?.aborted) abort()
            else options.signal?.addEventListener('abort', abort, { once: true })
          })
          return
        }
        if (text.includes('recall')) {
          assert(JSON.stringify(messages).includes(marker), 'Second turn lost prior tool evidence')
          assert(
            JSON.stringify(messages).includes('First turn complete'),
            'Second turn lost prior answer'
          )
          yield { type: 'text', content: 'Second turn recalled evidence.' }
        } else if (messages.at(-1)?.role === 'tool') {
          if (!text.includes('deny'))
            assert(
              JSON.stringify(messages.at(-1)).includes(marker),
              'Tool result absent from next provider request'
            )
          yield { type: 'text', content: 'First turn complete.' }
        } else {
          yield {
            type: 'tool_call_start',
            tool_call_id: `read-${providerRequests}`,
            tool_call_name: 'read_fixture'
          }
          yield {
            type: 'tool_call_end',
            tool_call_id: `read-${providerRequests}`,
            tool_call_arguments_complete: '{}'
          }
          yield { type: 'stop', stop_reason: 'tool_use' }
          return
        }
        yield { type: 'stop', stop_reason: 'complete' }
      },
      generateCompletionStandalone: async () => {
        throw new Error('Unexpected standalone model request')
      },
      generateText: async () => {
        throw new Error('Unexpected summary request')
      },
      runJudgment: async () => {
        throw new Error('Unexpected automatic permission review')
      }
    },
    providerSettings: settings,
    providerCatalogPort: { getProviderModels: () => [], getCustomModels: () => [] },
    agentSettings: {
      getAgentType: async () => 'deepchat',
      resolveDeepChatAgentConfig: async () => ({}),
      agentSupportsCapability: async () => false
    },
    toolService: {
      getAllToolDefinitions: async () => [tool],
      getToolDefinitionUniverse: async () => ({
        definitions: [tool],
        complete: true,
        unavailableSourceCount: 0
      }),
      syncAgentToolContext() {},
      clearConversationToolMapping() {},
      buildToolSystemPrompt: () => '',
      preCheckToolPermission: async (call: any) =>
        call.conversationId?.startsWith('permission') && !approvals.has(call.conversationId)
          ? {
              needsPermission: true,
              toolName: 'read_fixture',
              serverName: 'node-fixture',
              permissionType: 'read',
              description: 'Read the isolated fixture',
              paths: [filePath],
              requiresUserConfirmation: true
            }
          : null,
      callTool: async (call: any) => {
        assert.equal(call.function.name, 'read_fixture')
        assert.deepEqual(JSON.parse(call.function.arguments), {})
        if (call.conversationId?.startsWith('permission'))
          assert(approvals.has(call.conversationId))
        toolExecutions += 1
        const content = readFileSync(filePath, 'utf8')
        return { content, rawData: { toolCallId: call.id, content, isError: false } }
      }
    },
    hookObserver: { isObserved: () => false, notify() {} },
    publishStatus: (value: unknown) => events.push({ kind: 'status', value }),
    output: Object.fromEntries(
      [
        'streamSnapshot',
        'streamCompleted',
        'streamFailed',
        'compactionChanged',
        'sessionUpdate'
      ].map((kind) => [kind, (value: unknown) => events.push({ kind, value })])
    ),
    sessionPermissionPort: {
      clearSessionPermissions: (id: string) => {
        approvals.delete(id)
      },
      approvePermission: async (id: string) => {
        approvals.add(id)
        return { kind: 'granted' }
      },
      revokeOneShotCommandPermission() {}
    },
    acpAsLlmProviderPermission: {
      resolveAgentPermission: async () => {
        throw new Error('ACP unavailable in Node host')
      }
    },
    memoryPort: { isEnabled: () => false },
    getMemoryIngestionProjection: () => {
      throw new Error('Memory is disabled')
    },
    cacheImage: async () => {
      throw new Error('Images unavailable in Node host')
    },
    skillSettings: { isEnabled: () => false, isDraftSuggestionsEnabled: () => false },
    skillService: {
      getMetadataList: async () => [],
      getAllSkills: async () => [],
      getActiveSkills: async () => [],
      snapshotCachedMetadataList: () => ({ state: 'ready', skills: [] }),
      snapshotPersistedActiveSkillNames: () => [],
      resolveSessionAgentId: async () => 'deepchat',
      revalidateActiveSkillsForAgent: async () => [],
      validateSkillNames: async () => [],
      setActiveSkills: async () => [],
      resolveFreshEffectiveSkillContents: async () => []
    },
    traceSettings: { isEnabled: () => false },
    promptSettings: { getDefaultSystemPrompt: async () => 'Use only the bounded fixture reader.' },
    attachmentRouter: {
      prepare: async ({ content }: any) => ({
        content,
        summary: { status: 'ready', issues: [], suggestedActions: [] }
      })
    },
    interactionContinuationAdmission: { resume: async () => true, suspend: async () => {} },
    taskContractContext: { prepare: () => null },
    commandShell: { resolveForTurn: async () => shell, resolveProfile: async () => shell },
    programmaticTools: {
      prepare: () => {
        throw new Error('CLI programmatic capability unavailable')
      },
      commitRunTerminal: (_run: unknown, commit: () => unknown) => commit(),
      releaseSession() {},
      revokeConversation() {}
    }
  } as unknown as DeepChatHarnessDependencies
  return { connection, data, harness: createDeepChatAgentHarness(dependencies) }
}
async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Harness settlement')
    await delay(10)
  }
}
async function create(
  current: ReturnType<typeof host>,
  id: string,
  permissionMode: 'default' | 'full_access' = 'full_access'
) {
  current.data.database.newSessionsTable.create(id, 'deepchat', id, directory)
  await current.harness.initSession(id, {
    providerId: 'fixture',
    modelId: 'fixture-model',
    projectDir: directory,
    permissionMode
  })
}
async function settled(current: ReturnType<typeof host>, id: string) {
  await until(async () =>
    ['idle', 'error'].includes((await current.harness.getSessionState(id))?.status ?? '')
  )
  return current.data.transcript.listMessagesPage(id, { limit: 500 }).messages
}

let current = host()
try {
  if (phase === 'main') {
    await create(current, 'two-turn')
    await current.harness.processMessage('two-turn', 'read evidence')
    let messages = await settled(current, 'two-turn')
    assert(messages.at(-1)?.content.includes('First turn complete'))
    assert.equal(toolExecutions, 1)
    await current.harness.processMessage('two-turn', 'recall previous evidence')
    messages = await settled(current, 'two-turn')
    assert(messages.at(-1)?.content.includes('Second turn recalled evidence'))
    const ids = messages.map((message) => message.id)
    await current.harness.drainMemoryIngestion()
    current.connection.close()
    current = host()
    assert.deepEqual(
      current.data.transcript
        .listMessagesPage('two-turn', { limit: 500 })
        .messages.map((message) => message.id),
      ids
    )
    console.log('PASS two turns, real bounded tool, next-request evidence and SQLite reopen')
    for (const granted of [false, true]) {
      const sessionId = granted ? 'permission-allow' : 'permission-deny'
      await create(current, sessionId, 'default')
      await current.harness.processMessage(
        sessionId,
        granted ? 'read with permission' : 'deny permission'
      )
      assert.equal((await current.harness.getSessionState(sessionId))?.status, 'generating')
      const paused = current.data.transcript
        .listMessagesPage(sessionId, { limit: 500 })
        .messages.at(-1)!
      const action = JSON.parse(paused.content).find(
        (block: any) => block.action_type === 'tool_call_permission'
      )
      assert(action?.tool_call?.id, 'Permission interaction was not persisted')
      const before = toolExecutions
      if (granted) {
        await current.harness.drainMemoryIngestion()
        current.connection.close()
        current = host()
        assert.equal(current.data.transcript.getMessage(paused.id)?.content, paused.content)
      }
      const response = await current.harness.respondToolInteraction(
        sessionId,
        paused.id,
        action.tool_call.id,
        { kind: 'permission', granted }
      )
      assert.equal(response.resumed, true)
      await settled(current, sessionId)
      assert.equal(toolExecutions, before + (granted ? 1 : 0))
    }
    console.log(
      'PASS denied tool never executes; persisted permission resumes after reopening with one allowed execution'
    )
    await create(current, 'cancel-session')
    cancelStarted = false
    const cancelled = current.harness.processMessage(
      'cancel-session',
      'cancel this provider request'
    )
    await until(() => cancelStarted)
    await current.harness.cancelGeneration('cancel-session')
    await cancelled
    assert.equal(cancelSignals, 1)
    assert.notEqual((await current.harness.getSessionState('cancel-session'))?.status, 'generating')
    assert.notEqual(
      current.data.transcript.listMessagesPage('cancel-session', { limit: 500 }).messages.at(-1)
        ?.status,
      'pending'
    )
    console.log('PASS cancellation aborts the real loop and persists a terminal message')
    await create(current, 'failure-session')
    const db = current.data.database.getDatabase()
    db.exec(`CREATE TRIGGER inject_terminal_failure BEFORE UPDATE OF status ON deepchat_messages
      WHEN NEW.session_id = 'failure-session' AND NEW.role = 'assistant' AND NEW.status = 'sent'
      BEGIN SELECT RAISE(ABORT, 'injected terminal transaction failure'); END;`)
    await assert.rejects(
      current.harness.processMessage('failure-session', 'read evidence before persistence failure'),
      (error: any) =>
        error.name === 'CommittedRunProjectionError' &&
        error.cause?.code === 'SQLITE_CONSTRAINT_TRIGGER'
    )
    assert.equal((await current.harness.getSessionState('failure-session'))?.status, 'idle')
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS count FROM deepchat_messages WHERE session_id = 'failure-session' AND role = 'assistant' AND status = 'sent'"
        )
        .get().count,
      0
    )
    assert.equal(
      events.filter(
        (event) => event.kind === 'streamFailed' && event.value.sessionId === 'failure-session'
      ).length,
      0
    )
    db.exec('DROP TRIGGER inject_terminal_failure')
    await current.harness.drainMemoryIngestion()
    current.connection.close()
    current = host()
    assert.equal(
      current.data.transcript
        .listMessagesPage('failure-session', { limit: 500 })
        .messages.filter((message) => message.role === 'assistant' && message.status === 'sent')
        .length,
      0
    )
    console.log(
      'PASS injected SQLite terminal transaction failure has no partial success after reopen'
    )
  } else if (phase === 'crash') {
    await create(current, 'crash-session')
    const interrupted = current.harness.processMessage(
      'crash-session',
      'crash while provider is pending'
    )
    void interrupted.catch(() => {})
    await until(() => cancelStarted)
    await current.harness.queuePendingInput('crash-session', 'held after abrupt shutdown')
    process.exit(73)
  } else {
    const pending = await current.harness.listPendingInputs('crash-session')
    assert.equal(pending.length, 1)
    assert.equal(pending[0].state, 'pending')
    assert.equal(pending[0].payload.text, 'held after abrupt shutdown')
    assert.equal(await current.harness.isPendingQueueResumeAvailable('crash-session'), true)
    assert.equal(providerRequests, 0)
    console.log('PASS abrupt shutdown, new process recovery and durable held queue')
  }
} finally {
  await current.harness.drainMemoryIngestion()
  current.connection.close()
}
