// Clean-Node gate consumer for @deepchat/agent-kernel.
//
// Imports ONLY the package entry, builds fake ports, drives one two-round tool-continuation
// turn through the real kernel composition, and prints a JSON verdict. Exit 0 iff every
// assertion passes and the turn settles.

import { createDeepChatRuntimeServices } from '@deepchat/agent-kernel'

const SESSION_ID = 'gate-session-1'
const TOOL_ID = 'tc-gate-1'
const TOOL_NAME = 'echo_fixture'
const TOOL_ARGS = JSON.stringify({ value: 'fixture-input' })
const TOOL_RESULT = 'fixture-result'
const FINAL_TEXT = 'Fixture echo complete.'

const errors = []
const fail = (message) => {
  errors.push(message)
}

// ---------------------------------------------------------------------------
// Captured evidence
// ---------------------------------------------------------------------------
const requests = []
const events = []
const sessionUpdates = []
const invalidations = []
const toolExecutions = []
const hookEvents = []

// ---------------------------------------------------------------------------
// Fake provider runtime
// ---------------------------------------------------------------------------
async function* streamRoundOne() {
  yield { type: 'tool_call_start', tool_call_id: TOOL_ID, tool_call_name: TOOL_NAME }
  yield { type: 'tool_call_end', tool_call_id: TOOL_ID, tool_call_arguments_complete: TOOL_ARGS }
  yield {
    type: 'usage',
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
  }
  yield { type: 'stop', stop_reason: 'tool_use' }
}

async function* streamRoundTwo() {
  yield { type: 'text', content: FINAL_TEXT }
  yield {
    type: 'usage',
    usage: { prompt_tokens: 29, completion_tokens: 5, total_tokens: 34 }
  }
  yield { type: 'stop', stop_reason: 'complete' }
}

const providerRuntime = {
  async *streamChat(providerId, messages, modelId, modelConfig, temperature, maxTokens, tools) {
    requests.push({
      round: requests.length + 1,
      providerId,
      modelId,
      temperature,
      maxTokens,
      tools: structuredClone(tools),
      messages: structuredClone(messages)
    })
    if (requests.length === 1) return yield* streamRoundOne()
    return yield* streamRoundTwo()
  },
  async executeWithRateLimit() {},
  async getRuntimeContextLimitTokens() {
    return 128000
  },
  async generateText() {
    throw new Error('generateText is not part of the gate scenario')
  },
  async generateCompletionStandalone() {
    throw new Error('generateCompletionStandalone is not part of the gate scenario')
  }
}

// ---------------------------------------------------------------------------
// Fake provider/agent settings (union surface; pure data answers)
// ---------------------------------------------------------------------------
const PASSTHROUGH_POLICY = {
  temperature: { mode: 'passthrough' },
  topP: { mode: 'passthrough' },
  reasoning: { mode: 'passthrough' },
  legacyThinking: { mode: 'passthrough' }
}

const providerSettings = {
  getDefaultModel: () => ({ providerId: 'openai', modelId: 'gpt-4' }),
  getModelConfig: () => ({ temperature: 0.7, maxTokens: 4096, contextLength: 128000 }),
  isKnownModel: () => true,
  getCapabilitySnapshot: ({ providerId, modelId }) => ({
    identity: {
      providerId,
      requestModelId: modelId,
      catalogMatched: true,
      catalogModelId: modelId
    },
    requestPolicy: PASSTHROUGH_POLICY,
    supportsAudioInput: false,
    supportsReasoning: false,
    reasoningPortrait: null,
    thinkingBudgetRange: {},
    supportsSearch: false,
    searchDefaults: {},
    temperatureCapability: undefined,
    supportsTemperatureControl: true,
    supportsReasoningEffort: false,
    reasoningEffortDefault: undefined,
    supportsVerbosity: false,
    verbosityDefault: undefined
  }),
  getProviderById: (providerId) => ({ id: providerId, apiType: 'openai' }),
  supportsAudioInputCapability: () => false,
  getProviderDbSourceUrl: () => 'https://example.com/provider-db.json',
  getSetting: () => undefined,
  getAgentType: async () => 'deepchat',
  getAcpAgents: async () => [],
  resolveDeepChatAgentConfig: async () => ({
    subagentEnabled: false,
    subagents: []
  })
}

// ---------------------------------------------------------------------------
// In-memory durable stores
// ---------------------------------------------------------------------------
const settingsRows = new Map()
const summaryStates = new Map()
const DEFAULT_SUMMARY_STATE = {
  summaryText: null,
  summaryCursorOrderSeq: 0,
  summaryUpdatedAt: null
}
const settingsStore = {
  create(id, providerId, modelId, permissionMode, generationSettings) {
    settingsRows.set(id, {
      provider_id: providerId,
      model_id: modelId,
      permission_mode: permissionMode,
      system_prompt: null,
      temperature: null,
      top_p: null,
      context_length: null,
      max_tokens: null,
      timeout_ms: null,
      thinking_budget: null,
      ...(generationSettings ? JSON.parse(JSON.stringify(generationSettings)) : {})
    })
  },
  get: (id) => settingsRows.get(id),
  delete: (id) => settingsRows.delete(id),
  updatePermissionMode(id, mode) {
    const row = settingsRows.get(id)
    if (row) row.permission_mode = mode
  },
  updateSessionModel(id, providerId, modelId) {
    const row = settingsRows.get(id)
    if (row) {
      row.provider_id = providerId
      row.model_id = modelId
    }
  },
  getGenerationSettings(id) {
    const row = settingsRows.get(id)
    if (!row) return null
    const settings = {}
    for (const key of [
      'system_prompt',
      'temperature',
      'top_p',
      'context_length',
      'max_tokens',
      'timeout_ms',
      'thinking_budget'
    ]) {
      if (row[key] !== null && row[key] !== undefined) settings[key] = row[key]
    }
    return settings
  },
  updateGenerationSettings(id, settings) {
    const row = settingsRows.get(id)
    if (row) Object.assign(row, JSON.parse(JSON.stringify(settings)))
  },
  updateSessionConfiguration(id, providerId, modelId, generationSettings, permissionMode) {
    const row = settingsRows.get(id)
    if (!row) return
    row.provider_id = providerId
    row.model_id = modelId
    Object.assign(row, JSON.parse(JSON.stringify(generationSettings)))
    if (permissionMode) row.permission_mode = permissionMode
  },
  getSummaryState: (id) => summaryStates.get(id) ?? { ...DEFAULT_SUMMARY_STATE },
  getReconstructionAnchorPromptState: () => null,
  getReconstructionAnchorPromptStateByCompactionAttemptId: () => null,
  updateSummaryState(id, state) {
    summaryStates.set(id, JSON.parse(JSON.stringify(state)))
  },
  compareAndSetSummaryState(id, expectedState, nextState) {
    const current = summaryStates.get(id) ?? { ...DEFAULT_SUMMARY_STATE }
    const applied =
      current.summaryCursorOrderSeq === expectedState.summaryCursorOrderSeq &&
      current.summaryText === expectedState.summaryText
    if (applied) summaryStates.set(id, JSON.parse(JSON.stringify(nextState)))
    return { applied, currentState: summaryStates.get(id) ?? { ...DEFAULT_SUMMARY_STATE } }
  },
  resetSummaryState(id) {
    summaryStates.set(id, { ...DEFAULT_SUMMARY_STATE })
  },
  resetTape: () => {}
}

const transcriptRows = []
const toRecord = (row) => ({
  id: row.message_id,
  sessionId: row.session_id,
  orderSeq: row.order_seq,
  role: row.role,
  content:
    typeof row.content === 'string'
      ? row.content
      : JSON.stringify(row.role === 'user' ? row.content : row.blocks),
  status: row.status,
  isContextEdge: 0,
  metadata: JSON.stringify(row.metadata ?? {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at
})
const transcriptStore = {
  readProjectionCursor: () => null,
  writeProjectionCursor: () => {},
  applyTapeEntries: () => {},
  createUserMessage(sessionId, orderSeq, content, options) {
    const row = {
      session_id: sessionId,
      message_id: `user-${transcriptRows.length + 1}`,
      order_seq: orderSeq,
      role: 'user',
      content: JSON.parse(JSON.stringify(content)),
      metadata: options?.metadata ?? {},
      status: options?.status ?? 'sent',
      created_at: Date.now(),
      updated_at: Date.now()
    }
    transcriptRows.push(row)
    return row.message_id
  },
  createAssistantMessage(sessionId, orderSeq) {
    const row = {
      session_id: sessionId,
      message_id: `assistant-${transcriptRows.length + 1}`,
      order_seq: orderSeq,
      role: 'assistant',
      blocks: [],
      metadata: {},
      status: 'pending',
      created_at: Date.now(),
      updated_at: Date.now()
    }
    transcriptRows.push(row)
    return row.message_id
  },
  createCompactionMessage: () => 'compaction-unused',
  createCompactionMessageAtOrderSeq: () => 'compaction-unused',
  updateAssistantContent(messageId, blocks, metadata) {
    const row = transcriptRows.find((entry) => entry.message_id === messageId)
    if (!row) throw new Error(`transcript.updateAssistantContent: unknown message ${messageId}`)
    row.blocks = JSON.parse(JSON.stringify(blocks))
    row.updated_at = Date.now()
    if (metadata !== undefined) row.metadata = JSON.parse(JSON.stringify(metadata))
  },
  updateAssistantMetadata(messageId, metadata) {
    const row = transcriptRows.find((entry) => entry.message_id === messageId)
    if (row) row.metadata = JSON.parse(JSON.stringify(metadata))
  },
  updateMessageStatus() {},
  finalizeAssistantMessage(messageId, blocks, metadata) {
    const row = transcriptRows.find((entry) => entry.message_id === messageId)
    if (!row) throw new Error(`transcript.finalizeAssistantMessage: unknown message ${messageId}`)
    row.blocks = JSON.parse(JSON.stringify(blocks))
    row.metadata = JSON.parse(JSON.stringify(metadata))
    row.status = 'sent'
    row.updated_at = Date.now()
  },
  updateCompactionMessage() {},
  recordCompactionModelCall() {},
  setMessageError(messageId, blocks, metadata) {
    const row = transcriptRows.find((entry) => entry.message_id === messageId)
    if (!row) throw new Error(`transcript.setMessageError: unknown message ${messageId}`)
    row.blocks = JSON.parse(JSON.stringify(blocks))
    if (metadata !== undefined) row.metadata = JSON.parse(JSON.stringify(metadata))
    row.status = 'error'
    row.updated_at = Date.now()
  },
  getMessages: (sessionId) =>
    transcriptRows.filter((row) => row.session_id === sessionId).map(toRecord),
  getPendingAssistantMessages: (sessionId) =>
    transcriptRows
      .filter(
        (row) =>
          row.session_id === sessionId && row.role === 'assistant' && row.status === 'pending'
      )
      .map(toRecord),
  getMessagesUpToOrderSeq: (sessionId, maxOrderSeq) =>
    transcriptRows
      .filter((row) => row.session_id === sessionId && row.order_seq <= maxOrderSeq)
      .map(toRecord),
  getMessage: (messageId) => {
    const row = transcriptRows.find((entry) => entry.message_id === messageId)
    return row ? toRecord(row) : null
  },
  getLastUserMessageBeforeOrAt(sessionId, orderSeq) {
    const candidates = transcriptRows.filter(
      (row) => row.session_id === sessionId && row.role === 'user' && row.order_seq <= orderSeq
    )
    const row = candidates.at(-1)
    return row ? toRecord(row) : null
  },
  getNextOrderSeq: (sessionId) =>
    transcriptRows
      .filter((row) => row.session_id === sessionId)
      .reduce((max, row) => Math.max(max, row.order_seq), 0) + 1,
  deleteBySession(sessionId) {
    for (let index = transcriptRows.length - 1; index >= 0; index -= 1) {
      if (transcriptRows[index].session_id === sessionId) transcriptRows.splice(index, 1)
    }
  },
  deleteMessage(messageId) {
    const index = transcriptRows.findIndex((row) => row.message_id === messageId)
    if (index !== -1) transcriptRows.splice(index, 1)
  },
  deleteFromOrderSeq() {},
  addSearchResult: () => {},
  insertMessageTrace: () => 0,
  getMaxMessageTraceRequestSeq: () => 0,
  recoverPendingMessages: () => 0,
  reconcileCompactionMessages: () => ({ compacted: 0, retracted: 0, failed: 0 })
}

const tapeEvents = []
const tapeStore = {
  commitRunStarted: (record) => {
    tapeEvents.push({ kind: 'run_started', ...JSON.parse(JSON.stringify(record)) })
    return { created: true }
  },
  commitRunTerminal: (record) => {
    tapeEvents.push({ kind: 'run_terminal', ...JSON.parse(JSON.stringify(record)) })
    return { created: true }
  },
  appendViewManifest: (record) => {
    tapeEvents.push({ kind: 'view_manifest', ...JSON.parse(JSON.stringify(record)) })
  },
  appendProviderAttempt: (record) => {
    tapeEvents.push({ kind: 'provider_attempt', ...JSON.parse(JSON.stringify(record)) })
  }
}
for (const method of [
  'appendAnchor',
  'appendCompactionModelCall',
  'appendMessageRecord',
  'appendMessageReplacement',
  'appendMessageRetraction',
  'appendSkillViewResultFact',
  'appendToolFact',
  'assertSkillRequestAuthority',
  'classifyRecoveryCandidates',
  'commitDispatch',
  'commitNestedDispatch',
  'commitNestedToolOutcome',
  'commitToolOutcome',
  'commitToolSurfaceView',
  'deleteSessionTape',
  'ensureSessionTapeReady',
  'exportTapeInspectorSupportFacts',
  'getBySession',
  'getContextOccupancyEvidence',
  'getEffectiveMessageSourceSpan',
  'getEffectiveUserMessageSourceEntryId',
  'getLatestReconstructionAnchor',
  'getLatestViewManifestByRunBinding',
  'getMaxProviderAttemptRequestSeq',
  'getMessages',
  'getPendingProviderContextPressure',
  'getProjectionHead',
  'getReconstructionAnchorByCompactionAttemptId',
  'getTapeIncarnationId',
  'getTapeInspectorHead',
  'getTapeInspectorRecordDetail',
  'getViewManifestByExecutionBinding',
  'getViewManifestSourceMaps',
  'hasAnyCommittedDispatchForMessageToolCall',
  'initializeSessionTape',
  'listCompactionModelCallsPage',
  'listMemoryViewManifestsByAgent',
  'listMessageIdsWithNestedExecutionAudit',
  'listNestedExecutionAuditForMessage',
  'listTapeInspectorPage',
  'listToolSurfaceFactsByMessage',
  'listToolSurfaceFactsByMessageRequest',
  'listViewManifestsByMessage',
  'listViewManifestsByMessageRequest',
  'materializeSkillContexts',
  'readSkillMaterialization',
  'recoverRuntimeSkillViewContexts',
  'resetSessionTape',
  'resolveTapeInspectorEvidenceEntries'
]) {
  if (method.startsWith('commit')) {
    tapeStore[method] = () => ({ created: true, entryId: 0 })
  } else if (method === 'getViewManifestSourceMaps') {
    tapeStore[method] = () => ({
      latestEntryId: 0,
      anchorEntryIds: [],
      reconstructionAnchorEntryIds: [],
      reconstructionAnchorEntryId: null,
      entryIdByMessageId: new Map(),
      messageContentHashByMessageId: new Map(),
      toolCallEntryIdByToolId: new Map(),
      toolResultEntryIdByToolId: new Map()
    })
  } else if (method === 'ensureSessionTapeReady') {
    tapeStore[method] = () => ({ historyRecords: [] })
  } else if (method === 'classifyRecoveryCandidates') {
    tapeStore[method] = () => []
  } else if (method.startsWith('list')) {
    tapeStore[method] = () => []
  } else if (method.startsWith('has')) {
    tapeStore[method] = () => false
  } else if (method.startsWith('get')) {
    tapeStore[method] = () => null
  } else {
    tapeStore[method] = () => {}
  }
}

const pendingInputsStore = {
  recoverInputsAfterRestart: () => ({
    affectedSessionIds: new Set(),
    heldQueueInputIds: new Set()
  })
}
for (const method of [
  'acceptSteerMessage',
  'blockClaimedInput',
  'claimQueuedInput',
  'claimSteerInput',
  'consumeQueuedInput',
  'consumeSteerInput',
  'createClaimedQueueUserMessage',
  'degradeBlockedInput',
  'deleteBySession',
  'deletePendingInput',
  'getInput',
  'getNextQueuedInput',
  'getNextSteerInput',
  'hasActiveInputs',
  'hasBlockingInput',
  'hasClaimedInput',
  'hasPendingTurnInput',
  'isAtCapacity',
  'listPendingInputs',
  'moveQueuedInput',
  'promoteQueuedInputToSteerMessage',
  'queuePendingInput',
  'releaseClaimedInput',
  'releaseClaimedQueueInput',
  'releaseClaimedQueueInputForRetry',
  'retryBlockedInput',
  'retryReleasedQueueInput',
  'updateQueuedInput'
]) {
  if (method.startsWith('has') || method === 'isAtCapacity') {
    pendingInputsStore[method] = () => false
  } else if (method.startsWith('list')) {
    pendingInputsStore[method] = () => []
  } else if (method.startsWith('get')) {
    pendingInputsStore[method] = () => null
  } else {
    pendingInputsStore[method] = () => {}
  }
}

// ---------------------------------------------------------------------------
// Remaining fake ports
// ---------------------------------------------------------------------------
const POSIX_COMMAND_SHELL = Object.freeze({
  profile: 'posix',
  dialect: 'posix',
  pathStyle: 'native',
  executable: '/bin/sh',
  args: Object.freeze(['-c']),
  displayName: 'sh'
})

const toolService = {
  getAllToolDefinitions: async () => [
    {
      execution: 'write',
      type: 'function',
      source: 'agent',
      function: {
        name: TOOL_NAME,
        description: 'Echoes a fixture value back to the model.',
        parameters: { type: 'object', properties: {} }
      },
      server: {
        name: 'gate-fixture',
        icons: '',
        description: 'Clean-Node gate fixture tools'
      }
    }
  ],
  callTool: async (request) => {
    toolExecutions.push({
      name: request.function.name,
      arguments: request.function.arguments
    })
    return {
      content: TOOL_RESULT,
      rawData: { toolCallId: TOOL_ID, content: TOOL_RESULT, isError: false }
    }
  },
  preCheckToolPermission: async () => null,
  syncAgentToolContext: () => {},
  clearConversationToolMapping: () => {},
  clearAgentPlanState: () => {},
  buildToolSystemPrompt: () => ''
}

const memoryIngestionProjection = {
  appendRecords: () => {},
  listBySession: () => [],
  markProcessed: () => {}
}

const deps = {
  providerRuntime,
  providerSettings,
  agentSettings: providerSettings,
  database: {
    newSessionsTable: {
      get: () => null,
      getDisabledAgentTools: () => []
    },
    deepchatSessionsTable: {
      getMemoryCursorOrderSeq: () => null,
      updateMemoryCursorOrderSeq: () => {},
      rewindMemoryCursorOrderSeq: () => {}
    }
  },
  sessionData: {
    settings: settingsStore,
    transcript: transcriptStore,
    tapeStore,
    pendingInputs: pendingInputsStore,
    programmaticExecutionJournal: {
      commitToolOutcome: () => ({ created: true, entryId: 0 }),
      commitDispatch: () => ({ created: true, entryId: 0 }),
      beginNestedTool: () => {},
      commitNestedToolOutcome: () => ({ created: true, entryId: 0 }),
      commitNestedDispatch: () => ({ created: true, entryId: 0 }),
      rollbackNestedTool: () => {}
    }
  },
  toolService,
  hookObserver: {
    isObserved: () => true,
    notify: (event) => hookEvents.push(event.event)
  },
  onSessionCompleted: () => {},
  publishEvent: (name, payload) => {
    events.push({ name, payload })
  },
  publishSessionUpdate: (update) => {
    sessionUpdates.push(update)
  },
  providerCatalogPort: {
    getProviderModels: () => [],
    getCustomModels: () => []
  },
  sessionPermissionPort: {
    clearSessionPermissions: () => {},
    approvePermission: async () => ({ kind: 'granted' }),
    revokeOneShotCommandPermission: () => {}
  },
  acpAsLlmProviderPermission: {
    resolveAgentPermission: async () => undefined
  },
  sessionInvalidationPort: {
    invalidate: (reason) => invalidations.push(reason)
  },
  memoryPort: {
    isEnabled: () => false
  },
  getMemoryIngestionProjection: () => memoryIngestionProjection,
  cacheImage: async (data) => data,
  skillService: {
    getMetadataList: async () => [],
    getActiveSkills: async () => [],
    resolveSessionAgentId: async () => 'deepchat',
    validateSkillNames: async () => [],
    setActiveSkills: async (_sessionId, skills) => skills,
    loadSkillContent: async () => null,
    viewDraftSkill: async () => ({ success: false, action: 'view', draftId: '' }),
    installDraftSkill: async () => ({ success: false, action: 'install', draftId: '' }),
    discardDraftSkill: async () => ({ success: false, action: 'discard', draftId: '' })
  },
  skillSettings: {
    isEnabled: () => true,
    isDraftSuggestionsEnabled: () => false
  },
  traceSettings: {
    isEnabled: () => false
  },
  promptSettings: {
    getDefaultSystemPrompt: async () => 'You are a helpful assistant.'
  },
  attachmentRouter: {
    prepare: async ({ content }) => ({
      content,
      summary: { status: 'ready', issues: [], suggestedActions: [] }
    })
  },
  interactionContinuationAdmission: {
    resume: async () => true,
    suspend: () => {}
  },
  taskContractContext: {
    prepare: () => null
  },
  commandShell: {
    resolveForTurn: async () => POSIX_COMMAND_SHELL,
    resolveProfile: async () => POSIX_COMMAND_SHELL
  },
  visionTargetResolver: {
    resolveSessionVisionTarget: async () => null
  },
  imagePreviews: {
    cacheToolCallImagePreviews: async ({ imagePreviews }) => imagePreviews,
    extractToolCallImagePreviews: async () => []
  },
  programmaticToolParents: {
    prepare: (_identity, operation) => operation(),
    commitRunTerminal: (_identity, operation) => operation(),
    releaseSession: () => {}
  },
  agentCliTokenAuthority: {
    prepareProgrammaticOperation: () => {
      throw new Error('programmatic grants are not part of the gate scenario')
    },
    revokeConversation: () => {}
  }
}

// ---------------------------------------------------------------------------
// Drive the kernel
// ---------------------------------------------------------------------------
let turnSettled = false
const settled = new Promise((resolve) => {
  deps.onSessionCompleted = () => {
    turnSettled = true
    resolve()
  }
})

const services = createDeepChatRuntimeServices(deps)

await services.sessionLifecycle.init(SESSION_ID, {
  providerId: 'openai',
  modelId: 'gpt-4'
})

const startResult = await services.turnCoordinator.start(SESSION_ID, {
  text: 'Use the echo tool.',
  files: []
})

const settlement = await Promise.race([
  settled.then(() => 'settled'),
  new Promise((resolve) => setTimeout(() => resolve('timeout'), 30000))
])

if (settlement !== 'settled' && !turnSettled) {
  // Fall back to polling for transcript finals in case the completion hook is not wired.
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const assistant = transcriptRows.find(
      (row) => row.role === 'assistant' && row.status !== 'pending'
    )
    if (assistant) {
      turnSettled = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
if (requests.length !== 2) {
  fail(`expected exactly 2 provider rounds, got ${requests.length}`)
}

let roundTwoHasToolResult = false
if (requests[1]) {
  const serialized = JSON.stringify(requests[1].messages)
  roundTwoHasToolResult = serialized.includes(TOOL_RESULT) && serialized.includes(TOOL_ID)
  if (!roundTwoHasToolResult) {
    fail('round-2 provider request does not carry the tool result for the round-1 tool call')
  }
}

if (requests[0] && !JSON.stringify(requests[0].tools).includes(TOOL_NAME)) {
  fail('round-1 provider request did not receive the echo_fixture tool definition')
}

if (toolExecutions.length !== 1) {
  fail(`expected exactly 1 tool execution, got ${toolExecutions.length}`)
} else if (toolExecutions[0].name !== TOOL_NAME || toolExecutions[0].arguments !== TOOL_ARGS) {
  fail(`tool execution mismatch: ${JSON.stringify(toolExecutions[0])}`)
}

const userRow = transcriptRows.find((row) => row.role === 'user')
if (!userRow) {
  fail('durable transcript is missing the user message')
}

const assistantRows = transcriptRows.filter((row) => row.role === 'assistant')
const finalAssistant = assistantRows.find((row) => row.status === 'sent' || row.status === 'error')
if (!finalAssistant) {
  fail('durable transcript is missing a settled assistant message')
} else {
  if (finalAssistant.status !== 'sent') {
    fail(`assistant message settled as ${finalAssistant.status}, expected sent`)
  }
  const serializedBlocks = JSON.stringify(finalAssistant.blocks)
  if (!serializedBlocks.includes(TOOL_NAME)) {
    fail('settled assistant blocks do not contain the tool call block')
  }
  if (!serializedBlocks.includes(FINAL_TEXT)) {
    fail('settled assistant blocks do not contain the final text')
  }
}

if (!tapeEvents.some((event) => event.kind === 'run_started')) {
  fail('tape is missing run_started')
}
if (!tapeEvents.some((event) => event.kind === 'run_terminal')) {
  fail('tape is missing run_terminal')
}

if (!turnSettled) {
  fail('turn did not settle within the timeout')
}

const verdict = {
  ok: errors.length === 0,
  errors,
  providerRounds: requests.map((request) => ({
    round: request.round,
    messageCount: request.messages.length,
    toolCount: request.tools.length
  })),
  roundTwoHasToolResult,
  toolExecutions,
  transcript: transcriptRows.map((row) => ({
    role: row.role,
    status: row.status,
    blockTypes: Array.isArray(row.blocks)
      ? row.blocks.map((block) => block.type)
      : typeof row.content === 'string'
        ? ['text']
        : []
  })),
  tapeKinds: tapeEvents.map((event) => event.kind),
  eventNames: events.map((event) => event.name),
  sessionUpdateKinds: sessionUpdates.map((update) => update?.kind),
  invalidationCount: invalidations.length,
  hookEventNames: hookEvents
}

console.log('---AGENT-KERNEL-GATE-VERDICT---')
console.log(JSON.stringify(verdict, null, 2))
process.exitCode = verdict.ok ? 0 : 1
