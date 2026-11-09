import { DimSessionConnection } from '@/agent/dim/sessionConnection'
import { projectDimEvent } from '@/agent/dim/messageProjection'
import { DimProjectionStore } from '@/agent/dim/projectionStore'
import type { DimEvent } from '@/agent/dim/sessionConnection'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimSessionRuntime } from '@/agent/dim/sessionRuntime'
import { dimDatabase } from './fixtures/database'
import { DimProductContext } from '@/agent/dim/productContext'
import { DimScopes, type DimAuthorizedScope } from '@/agent/dim/scopes'
import { DimProductTools } from '@/agent/dim/productTools'
import { TOOL_EXECUTION } from '@shared/types/mcp'
import {
  DimProductGateway,
  type DimProductToolCall,
  type DimProductGatewayOptions
} from '@/agent/dim/productGateway'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimInputPreparation } from '@/agent/dim/inputPreparation'
import { DimAuxiliaryModels } from '@/agent/dim/auxiliaryModels'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { DimAgentProfiles } from '@/agent/dim/agentProfiles'
import { DimSessionSettings } from '@/agent/dim/sessionSettings'
import { DesktopSessionState } from '@/session/desktopSessionState'
import { DimDesktopProjection } from '@/agent/dim/desktopProjection'
import { createDeepChatOutputProjection } from '@/session/outputProjection'
import { createSessionStatusProjection } from '@/session/sessionStatusProjection'
import type { SessionEventPublisher } from '@/events/sessionEventRouter'
import type { ProviderSettingsPort } from '@/provider/settings'
import type { ModelConfig } from '@shared/types/provider'
import { DimSessionControls } from '@/agent/dim/sessionControls'
import { DimQueue } from '@/agent/dim/queue'
import { DimInteractions } from '@/agent/dim/interactions'
import { DimContext } from '@/agent/dim/context'
import { DimMemorySource } from '@/agent/dim/memorySource'
import { DimMemoryEvidence } from '@/agent/dim/memoryEvidence'
import type { DimMemorySource as MemorySourceReference } from '@shared/types/agent-memory'
import { DimContent } from '@/agent/dim/content'
import { DimScopeTransitions } from '@/agent/dim/scopeTransitions'
import { DimTranscriptMutations } from '@/agent/dim/transcriptMutations'
import { SessionTranscriptMutations } from '@/session/transcriptMutations'
import { createDimAgent } from '@/agent/dim/createDimAgent'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { DimLegacyMigration } from '@/agent/dim/legacyMigration'
import { DimLegacySource } from '@/agent/dim/legacySource'
import {
  dimHistoryPlan,
  dimHistoryHash,
  normalizeDimImportedMessage
} from '@/agent/dim/historyImport'
import { TranscriptProjectionApplier } from '@/session/data/transcriptProjection'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { ServerResponse } from 'node:http'
import { createServer } from 'node:http'

// Explicit smoke target: no network requests or runtime downloads during tests.
it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'runs through the injected plugins and restores committed content',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-native-'))
    const runtime = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock'
    })
    try {
      const [client, sameClient] = await Promise.all([runtime.start(), runtime.start()])
      expect(sameClient).toBe(client)
      expect(await client.call('deepchat.host.capabilities')).toMatchObject({
        apiVersion: 1,
        plugin: 'deepchat-host'
      })
      expect(await client.call('deepchat.storage.capabilities')).toMatchObject({
        apiVersion: 1,
        plugin: 'deepchat-storage'
      })
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile
      })
      const ref = { sessionId, branchId: 'main' }
      const events: Array<{ type: string; name: string }> = []
      client.on('notification', (notice) => {
        if (notice.method === 'deepchat.host.event') events.push(notice.params.event)
      })
      const { watchId } = await client.call<{ watchId: string }>('deepchat.host.subscribe', ref)
      const submissionId = randomUUID()

      expect(await client.call('deepchat.host.lookup', { ...ref, submissionId })).toEqual({
        status: 'unknown'
      })
      const receipt = await client.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId,
        rawBlocks: [],
        content: [{ type: 'text', text: 'DeepChat dim integration' }]
      })
      expect(receipt).toMatchObject({ inputId: expect.any(String), sequence: expect.any(Number) })
      await client.call('deepchat.host.idle', ref)
      expect(await client.call('deepchat.host.lookup', { ...ref, submissionId })).toMatchObject({
        status: 'accepted',
        ...(receipt as object)
      })
      type History = {
        through: number
        events: Array<{ type: string; name: string; data: { delta?: string } }>
      }
      const history = await client.call<History>('deepchat.storage.history', {
        ...ref,
        after: 0,
        limit: 100
      })
      expect(
        history.events.some(
          (event) =>
            event.name === 'text' && event.data.delta?.includes('Echo: DeepChat dim integration')
        )
      ).toBe(true)
      expect(history.events.at(-1)).toMatchObject({
        type: 'turn',
        name: 'end',
        data: { status: 'completed' }
      })
      await expect
        .poll(() => events.some((event) => event.type === 'turn' && event.name === 'end'))
        .toBe(true)
      const query = { scope: 'branch', query: { select: { kind: 'events' } }, page: { limit: 3 } }
      const raw = await client.call<{
        through: number
        next: unknown
        result: { events: unknown[] }
      }>('session.deepchat_storage.query', { ...ref, query })
      expect(raw.result.events).toHaveLength(3)
      expect(raw.next).toBeTruthy()
      const next = await client.call<{ result: { events: unknown[] } }>(
        'session.deepchat_storage.query',
        {
          ...ref,
          query: { ...query, through: String(raw.through), page: { limit: 3, after: raw.next } }
        }
      )
      expect(next.result.events).toHaveLength(3)
      await expect(
        client.call('deepchat.storage.history', { ...ref, limit: 1000 })
      ).rejects.toMatchObject({ data: { appError: 'invalid_params' } })
      await client.call('deepchat.host.unsubscribe', { watchId })
      client.close()
      const reconnected = await runtime.start()
      expect(
        await reconnected.call('deepchat.host.lookup', { ...ref, submissionId })
      ).toMatchObject({ status: 'accepted' })
      await runtime.stop()
      const restored = await runtime.start()
      const page = await restored.call('deepchat.storage.history', {
        ...ref,
        after: 0,
        through: history.through,
        limit: 100
      })
      expect(page).toEqual(history)
      expect(await restored.call('deepchat.host.lookup', { ...ref, submissionId })).toMatchObject({
        status: 'accepted'
      })
      await restored.call('deepchat.host.stop', ref)
    } finally {
      await runtime.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'controls the Rust queue, withdrawal/steer and fork through the injected host plugin',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-queue-'))
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock'
    })
    try {
      const client = await host.start()
      const controls = new DimSessionControls(host)
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        policy: { preset: 'read-only', allowedTools: ['wait', 'echo'], disallowedTools: [] }
      })
      const ref = { sessionId, branchId: 'main' }
      const send = (text: string) =>
        client.call<{ inputId: string }>('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text }]
        })
      await send('tool:wait {"millis":60000}')
      await expect
        .poll(async () => {
          const history = await client.call<{ events: Array<{ name: string }> }>(
            'deepchat.storage.history',
            { ...ref, limit: 100 }
          )
          return history.events.some((event) => event.name === 'tool-call')
        })
        .toBe(true)
      const second = await send('second held')
      const third = await send('third held')
      const queue = await controls.call<{ inputs: Array<{ inputId: string; applied: boolean }> }>(
        'queue',
        ref
      )
      expect(
        queue.inputs.filter((input) => [second.inputId, third.inputId].includes(input.inputId))
      ).toHaveLength(2)
      expect(
        queue.inputs
          .filter((input) => [second.inputId, third.inputId].includes(input.inputId))
          .every((input) => !input.applied)
      ).toBe(true)
      const withdrawn = await controls.call<{ status: string; steer: { inputId: string } }>(
        'withdraw',
        ref,
        {
          inputId: second.inputId,
          steer: { content: [{ type: 'text', text: 'native steer replacement' }] }
        }
      )
      expect(withdrawn.status).toBe('deleted')
      expect(withdrawn.steer.inputId).toBeTruthy()
      expect(await controls.call('withdraw', ref, { inputId: third.inputId })).toMatchObject({
        status: 'deleted'
      })
      await client.call('deepchat.host.stop', ref)
      await client.call('deepchat.host.idle', ref)
      const remaining = await controls.call<{ inputs: Array<{ inputId: string }> }>('queue', ref)
      expect(
        remaining.inputs.some((input) => [second.inputId, third.inputId].includes(input.inputId))
      ).toBe(false)
      await send('settle the continuation')
      await client.call('deepchat.host.idle', ref)
      const history = await client.call<{ through: number }>('deepchat.storage.history', {
        ...ref,
        limit: 100
      })
      const fork = await controls.call<{ sessionId: string }>('fork', ref, {
        at: String(history.through)
      })
      expect(fork.sessionId).toBeTruthy()
      expect(fork.sessionId).not.toBe(sessionId)
    } finally {
      await host.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1').each([false, true])(
  'uses Rust model owners with native extensions=%s and cancels their HTTP requests',
  async (nativePlugins) => {
    const requests: Array<{
      authorization?: string
      productHeader?: string
      body: Record<string, unknown>
    }> = []
    const conversationRequests = () =>
      requests.filter(
        (item) =>
          item.body.messages &&
          !JSON.stringify(item.body.messages).includes('Write a short title for this conversation:')
      )
    let nativeCancelled = false
    let holdQueue = false
    let heldQueueResponse: ServerResponse | null = null
    let nextTools: Array<{ id: string; name: string; arguments: object }> | null = null
    let mcpEnabled = false
    let mcpToken = 'native-mcp-first'
    let nextMcpCall = false
    const mcpCalls: string[] = []
    const fixture = createServer(async (req, res) => {
      let payload = ''
      for await (const data of req) payload += data
      const body = payload ? JSON.parse(payload) : {}
      if (req.url === '/native-mcp') {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        if (req.headers.authorization !== `Bearer ${mcpToken}`) {
          res.writeHead(401)
          res.end()
          return
        }
        if (body.id === undefined) {
          res.writeHead(202)
          res.end()
          return
        }
        let result: object = {}
        if (body.method === 'initialize')
          result = {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'native-mcp-fixture', version: '1' }
          }
        if (body.method === 'tools/list')
          result = {
            tools: [
              {
                name: 'native_echo',
                description: 'Native MCP migration fixture',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false }
              }
            ]
          }
        if (body.method === 'tools/call') {
          mcpCalls.push(req.headers.authorization!)
          result = { content: [{ type: 'text', text: 'native MCP result' }] }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
        return
      }
      requests.push({
        authorization: req.headers.authorization,
        productHeader: req.headers['x-product-secret'] as string | undefined,
        body
      })
      const titleRequest = JSON.stringify(body.messages ?? []).includes(
        'Write a short title for this conversation:'
      )
      if (holdQueue && !titleRequest) {
        holdQueue = false
        heldQueueResponse = res
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.flushHeaders()
        return
      }
      if (JSON.stringify(body.messages ?? []).includes('hold native auxiliary')) {
        res.once('close', () => {
          nativeCancelled = true
        })
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.flushHeaders()
        return
      }
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fixture' }] }))
        return
      }
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        if (nextMcpCall && !titleRequest) {
          const tool = body.tools?.find((item: { function?: { description?: string } }) =>
            item.function?.description?.includes('Native MCP migration fixture')
          )
          if (!tool) throw new Error('The native MCP catalog is missing from the model request')
          nextMcpCall = false
          nextTools = [{ id: randomUUID(), name: tool.function.name, arguments: {} }]
        }
        if (nextTools && !titleRequest) {
          const tools = nextTools
          nextTools = null
          res.end(
            `data: ${JSON.stringify({ id: 'native-tools', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: tools.map((tool, index) => ({ index, id: tool.id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } })) }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
          )
          return
        }
        for (const chunk of [
          {
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'Rust provider answer' },
                finish_reason: null
              }
            ]
          },
          {
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
          }
        ])
          res.write(
            `data: ${JSON.stringify({ id: 'fixture-call', object: 'chat.completion.chunk', model: 'fixture', created: 0, ...chunk })}\n\n`
          )
        res.end('data: [DONE]\n\n')
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'fixture-call',
            object: 'chat.completion',
            model: 'fixture',
            created: 0,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Rust provider answer' },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
          })
        )
      }
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-provider-'))
    const grants = dimDatabase(path.join(profile, 'desktop.sqlite'))
    let catalog: DimModelCatalog | null = null
    let nativeSettings: DimSessionSettings | null = null
    let nativeState: DesktopSessionState | null = null
    let admittedProvider = ''
    let credentialValue = 'fixture-secret-only'
    let providerEnabled = true
    let productCatalogVersion = 'facade-only'
    let liveContextVersion = 1
    const contextSessionIds: string[] = []
    let contextStarted = false
    let contextCancelled = false
    const productToolCalls: DimProductToolCall[] = []
    const prepareContext: NonNullable<DimProductGatewayOptions['context']> = async (
      request,
      signal
    ) => {
      contextSessionIds.push(request.sessionId)
      if (request.query.includes('block native product context')) {
        contextStarted = true
        await new Promise<void>((resolve) => {
          const cancelled = () => {
            contextCancelled = true
            resolve()
          }
          signal.addEventListener('abort', cancelled, { once: true })
          if (signal.aborted) cancelled()
        })
        signal.throwIfAborted()
      }
      return {
        messages: [
          { role: 'user', content: `native product context version ${liveContextVersion}` }
        ],
        receipts: [{ source: 'product-context-fixture', version: liveContextVersion }]
      }
    }
    const nativeScopes: DimAuthorizedScope[] = []
    const scopedContext = new DimProductContext({
      database: grants.data,
      content: { latest: (...args) => new DimContent(host).latest(...args) },
      resolve: async (request, signal) => {
        const scope = await new DimScopes({ database: grants.data, host }).context(request, signal)
        nativeScopes.push(scope)
        return scope
      },
      authorize: () => {},
      prepare: (_binding, request, signal) => prepareContext(request, signal)
    })
    const desktopTools = new DimProductTools({
      database: grants.data,
      authorize: () => {},
      catalog: async () => [
        {
          definition: {
            execution: TOOL_EXECUTION.write,
            type: 'function',
            function: {
              name: 'deepchat_facade_echo',
              description: `Fixture product capability ${productCatalogVersion}`,
              parameters: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text']
              }
            },
            server: { name: 'fixture', icons: '', description: 'Desktop fixture' }
          },
          risk: 'session',
          execute: async (call) => {
            productToolCalls.push(call)
            return { content: `product capability: ${call.arguments.text}` }
          }
        }
      ]
    })
    const gateway = new DimProductGateway({
      resolve: async (nativeId) => {
        if (
          grants.data.dimSessionBindingsTable.getByNative(nativeId)?.sessionId === 'facade-product'
        )
          return desktopTools.resolve(nativeId)
        return {
          version: 'empty',
          tools: [],
          execute: async () => {
            throw new Error('No tools')
          }
        }
      },
      context: async (request, signal) => {
        if (grants.data.dimSessionBindingsTable.getByNative(request.sessionId))
          return scopedContext.prepare(request, signal)
        const scope = await new DimScopes({ database: grants.data, host }).describe(
          request.sessionId
        )
        return scope.origin === 'internal'
          ? scopedContext.prepare(request, signal)
          : prepareContext(request, signal)
      },
      credential: async (providerId, reference, signal) => {
        if (catalog) return catalog.credential(providerId, reference, signal)
        if (providerId !== admittedProvider || reference !== 'desktop/provider/fixture')
          throw new Error('Unknown credential reference')
        return credentialValue
      }
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      nativePlugins,
      contextBridge: nativePlugins,
      gatewayAddress: nativePlugins ? await gateway.start() : undefined,
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      )
    })
    try {
      const port = (fixture.address() as { port: number }).port
      const models = new DimModelBridge(host)
      const configuration = {
        key: 'desktop/fixture',
        displayName: 'Local native provider',
        connection: {
          driverKind: 'openai-compatible',
          auth: { type: 'bearer' },
          baseUrl: `http://127.0.0.1:${port}/v1`,
          credential: nativePlugins
            ? { action: 'set_ref', reference: 'desktop/provider/fixture' }
            : { action: 'set', value: 'fixture-secret-only' }
        },
        model: {
          modelId: 'fixture',
          displayName: 'Fixture',
          status: 'active',
          capabilities: {
            modalities: ['text'],
            toolCalling: true,
            streaming: true,
            structuredOutput: false,
            vision: false,
            audio: false,
            reasoning: false,
            contextWindow: 128000,
            maxOutputTokens: 1024
          }
        }
      }
      if (nativePlugins) {
        const settings = {
          getProviderById: () => ({
            id: 'desktop-fixture',
            name: configuration.displayName,
            apiType: 'openai-compatible',
            apiKey: credentialValue,
            customHeaders: { 'x-product-secret': 'native-header-secret-sentinel' },
            baseUrl: configuration.connection.baseUrl,
            enable: providerEnabled
          }),
          getModelStatus: () => true,
          isKnownModel: () => true,
          getProviderDbSourceUrl: () => '',
          supportsAudioInputCapability: () => false,
          getModelConfig: () =>
            ({
              contextLength: 128000,
              maxTokens: 1024,
              timeout: 60000,
              temperature: 0.7,
              vision: false,
              functionCall: true,
              reasoning: false
            }) as ModelConfig,
          getProviderModelRouteMetadata: () => undefined,
          getCapabilitySnapshot: () =>
            ({
              supportsAudioInput: false,
              identity: { providerId: 'desktop-fixture' },
              mediaSettings: { image: false, video: false },
              requestPolicy: {
                temperature: { mode: 'passthrough' },
                topP: { mode: 'passthrough' },
                reasoning: { mode: 'passthrough' },
                legacyThinking: { mode: 'passthrough' }
              },
              thinkingBudgetRange: {},
              supportsReasoningEffort: false,
              supportsReasoning: false,
              reasoningPortrait: null
            }) as ReturnType<ProviderSettingsPort['getCapabilitySnapshot']>
        }
        catalog = new DimModelCatalog({
          settings,
          models,
          grants: grants.data.dimProviderGrantsTable,
          credential: async () => credentialValue
        })
        const state = new DesktopSessionState({
          database: grants.data,
          providerSettings: settings,
          promptSettings: { getDefaultSystemPrompt: async () => 'Native product persona sentinel' }
        })
        nativeState = state
        nativeSettings = new DimSessionSettings({
          state,
          database: grants.data,
          profiles: new DimAgentProfiles(host),
          models: catalog,
          controls: new DimSessionControls(host),
          identity: async (id) => ({
            name: 'Product fixture',
            description: '',
            cwd: grants.data.newSessionsTable.get(id)?.project_dir ?? profile
          }),
          configurationChanged: async () => {}
        })
        await nativeSettings.initSession('product-ui', {
          providerId: 'desktop-fixture',
          modelId: 'fixture',
          generationSettings: { temperature: 0.23, topP: 0.71, maxTokens: 83, contextLength: 64000 }
        })
      }
      const admit = () =>
        catalog ? catalog.admit('desktop-fixture', 'fixture') : models.configure(configuration)
      const target = await admit()
      admittedProvider = target.providerId
      expect(await admit()).toEqual(target)
      const client = await host.start()
      const launch = nativeSettings
        ? await nativeSettings.launch('product-ui')
        : { cwd: profile, model: target }
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', launch)
      const ref = { sessionId, branchId: 'main' }
      const controls = new DimSessionControls(host)
      const policy = await controls.call<{
        version: number
        policy: { preset: string; allowedTools: string[]; disallowedTools: string[] }
      }>('permission', ref)
      const changedPreset =
        policy.policy.preset === 'workspace-write' ? 'full-access' : 'workspace-write'
      await controls.call('set_permission', ref, {
        expectedVersion: String(policy.version),
        policy: { ...policy.policy, preset: changedPreset }
      })
      expect(await controls.call('permission', ref)).toMatchObject({
        policy: { preset: changedPreset }
      })
      await expect(
        controls.call('set_permission', ref, {
          expectedVersion: String(policy.version),
          policy: policy.policy
        })
      ).rejects.toThrow()
      if (nativePlugins) {
        await expect(
          controls.call('native_configure', ref, { config: { topP: 1.5 } })
        ).rejects.toThrow()
        await controls.call('native_configure', ref, {
          config: { temperature: 0.23, topP: 0.71, maxTokens: 83 }
        })
        expect(await controls.call('native_settings', ref)).toMatchObject({
          config: { temperature: 0.23, topP: 0.71, maxTokens: 83 }
        })
      }
      const representation = {
        text: 'UI-only representation sentinel',
        files: [{ name: 'source.md', path: '/fixture/source.md' }],
        links: ['https://example.test'],
        search: false,
        think: false,
        activeSkills: ['product-skill']
      }
      if (nativePlugins) {
        const submissionId = randomUUID()
        grants.data.dimSessionBindingsTable.bind('product-ui', sessionId)
        const failures: unknown[] = []
        const desktopEvents: Array<{ name: string; payload: unknown }> = []
        const publishEvent: SessionEventPublisher = (name, payload) => {
          desktopEvents.push({ name, payload })
        }
        let notifications = 0
        const views = new DimDesktopProjection({
          publishEvent,
          output: createDeepChatOutputProjection({ publishEvent, publishSessionUpdate: () => {} }),
          publishStatus: createSessionStatusProjection({
            publishEvent,
            publishSessionUpdate: () => {},
            sessionUiPort: { refreshSessionUi: () => {} }
          }),
          completed: () => {
            notifications++
          }
        })
        const desktop = new DimSessionRuntime({
          database: grants.data,
          host,
          launch: async () => {
            throw new Error('Existing native identity must be reused')
          },
          prepare: (binding) => nativeSettings!.prepare(binding),
          projected: (_id, projection) => views.apply(projection),
          failed: (_id, error) => failures.push(error)
        })
        const accepted = await desktop.submit(
          'product-ui',
          [{ type: 'text', text: 'native agent request' }],
          { submissionId, representation }
        )
        expect(
          await desktop.submit('product-ui', [{ type: 'text', text: 'native agent request' }], {
            submissionId,
            representation
          })
        ).toEqual(accepted)
        await desktop.waitIdle('product-ui')
        await desktop.close('product-ui')
        expect(failures).toEqual([])
        expect(
          desktopEvents.filter((event) => event.name === 'chat.stream.completed'),
          JSON.stringify(desktopEvents)
        ).toHaveLength(1)
        expect(desktopEvents.some((event) => event.name === 'chat.stream.updated')).toBe(true)
        expect(
          desktopEvents
            .filter((event) => event.name === 'sessions.status.changed')
            .map((event) => (event.payload as { status: string }).status)
        ).toEqual(['idle', 'generating', 'idle'])
        expect(notifications).toBe(1)
        expect(JSON.stringify(conversationRequests()[0].body)).toContain(
          'Native product persona sentinel'
        )
        expect(await controls.call('native_settings', ref)).toMatchObject({
          capabilitySnapshot: { capabilities: { contextWindow: 64000, maxOutputTokens: 83 } }
        })
        const input = {
          ...ref,
          input: {
            submission_id: submissionId,
            mode: 'queue',
            user: {
              content: [{ type: 'text', text: 'native agent request' }]
            }
          },
          representation
        }
        expect(await client.call('session.deepchat_inputs.submit', input)).toEqual(accepted)
      } else {
        await client.call('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text: 'native agent request' }]
        })
      }
      await client.call('deepchat.host.idle', ref)
      const history = await client.call<{
        through: number | string
        events: DimEvent[]
      }>('deepchat.storage.history', { ...ref, limit: 100 })
      expect(
        history.events
          .filter((event) => event.name === 'text')
          .map((event) => event.data.delta ?? '')
          .join(''),
        JSON.stringify(history.events.filter((event) => event.type === 'turn'))
      ).toBe('Rust provider answer')
      expect(JSON.stringify(history)).not.toContain('fixture-secret-only')
      if (nativePlugins) {
        const nativeCall = history.events.find(
          (event) => event.type === 'model' && event.name === 'call'
        )
        expect(nativeCall?.data.request).toMatchObject({
          metadata: { deepchatContextReceipts: [{ source: 'product-context-fixture', version: 1 }] }
        })
        expect(
          history.events.filter(
            (event) => event.type === 'deepchat' && event.name === 'input-representation'
          )
        ).toHaveLength(1)
        const binding = grants.data.dimSessionBindingsTable.get('product-ui')!
        const projection = new DimProjectionStore(grants.data)
        for (const event of history.events) projection.apply(binding, event)
        const user = grants.data.deepchatMessagesTable
          .getBySession('product-ui')
          .find((row) => row.role === 'user')!
        expect(JSON.parse(user.content)).toEqual(representation)
        expect(JSON.stringify(conversationRequests()[0].body)).not.toContain(representation.text)
      }

      expect(
        nativePlugins
          ? await new DimAuxiliaryModels({ models: catalog!, bridge: models }).complete({
              providerId: 'desktop-fixture',
              modelId: 'fixture',
              messages: [
                { role: 'system', content: 'native auxiliary instructions' },
                { role: 'user', content: 'native auxiliary request' }
              ],
              parameters: { temperature: 0.31, topP: 0.68, maxTokens: 93 }
            })
          : await models.complete(
              target,
              {
                messages: [{ role: 'user', content: 'native auxiliary request' }],
                maxOutputTokens: 100
              },
              undefined,
              nativePlugins ? { temperature: 0.31, topP: 0.68, maxTokens: 93 } : undefined
            )
      ).toMatchObject({ text: 'Rust provider answer' })
      if (nativePlugins) {
        expect(conversationRequests()[0].body).toMatchObject({
          temperature: 0.23,
          top_p: 0.71,
          max_tokens: 83
        })
        expect(conversationRequests()[1].body).toMatchObject({
          temperature: 0.31,
          top_p: 0.68,
          max_tokens: 93
        })
        await nativeSettings!.setSessionModel('product-ui', 'desktop-fixture', 'fixture-2')
        expect(await controls.call('native_settings', ref)).toMatchObject({ modelId: 'fixture-2' })
        await nativeSettings!.setSessionModel('product-ui', 'desktop-fixture', 'fixture')
        await Promise.all([
          nativeSettings!.updateGenerationSettings('product-ui', { temperature: 0.41 }),
          nativeSettings!.updateGenerationSettings('product-ui', { temperature: 0.42 })
        ])
        expect(await controls.call('native_settings', ref)).toMatchObject({
          config: { temperature: 0.42 }
        })
        expect(await nativeSettings!.getGenerationSettings('product-ui')).toMatchObject({
          temperature: 0.42
        })
        await expect(
          controls.call('native_configure', ref, {
            config: { temperature: 0.5 },
            expectedModel: { ...target, modelId: 'replaced' }
          })
        ).rejects.toThrow()
        await controls.call('native_configure', ref, {
          config: { temperature: 0.4, maxTokens: 83 },
          replace: true,
          expectedModel: target
        })
        const adopted = await controls.call<{ config: { topP?: number } }>('native_settings', ref)
        expect(adopted.config.topP).toBeUndefined()
      }
      expect(conversationRequests()).toHaveLength(2)
      expect(requests.every((item) => item.authorization === 'Bearer fixture-secret-only')).toBe(
        true
      )
      if (nativePlugins) {
        expect(
          requests.every((item) => item.productHeader === 'native-header-secret-sentinel')
        ).toBe(true)
        credentialValue = 'rotated-native-credential'
      }
      const abort = new AbortController()
      const completion = models.complete(
        target,
        { messages: [{ role: 'user', content: 'hold native auxiliary' }] },
        abort.signal,
        nativePlugins ? {} : undefined
      )
      // Attach the rejection handler before cancelling so it cannot become an unhandled promise.
      const cancelled = expect(completion).rejects.toThrow()
      await expect.poll(() => conversationRequests().length).toBe(3)
      abort.abort()
      await cancelled
      await expect.poll(() => nativeCancelled).toBe(true)
      await host.stop()
      if (nativePlugins) {
        const verifyNoPlaintextCredential = async (directory: string): Promise<void> => {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name)
            if (entry.isDirectory()) await verifyNoPlaintextCredential(filename)
            else if (entry.isFile()) {
              const bytes = await readFile(filename)
              for (const secret of ['fixture-secret-only', 'native-header-secret-sentinel'])
                expect(bytes.includes(Buffer.from(secret)), filename).toBe(false)
            }
          }
        }
        await verifyNoPlaintextCredential(path.join(profile, 'dim'))
      }
      expect(await admit()).toEqual(target)
      if (nativePlugins) {
        expect(await nativeSettings!.launch('product-ui')).toEqual(launch)
        const recovered = await (
          await host.start()
        ).call<{ events: DimEvent[] }>('deepchat.storage.history', {
          ...ref,
          limit: 100,
          through: String(history.through)
        })
        expect(recovered.events).toEqual(history.events)
        grants.data.deepchatMessagesTable.deleteBySession('product-ui')
        grants.data.dimSessionBindingsTable.delete('product-ui')
        const binding = grants.data.dimSessionBindingsTable.bind('product-ui', sessionId)
        const projection = new DimProjectionStore(grants.data)
        for (const event of recovered.events) projection.apply(binding, event)
        const user = grants.data.deepchatMessagesTable
          .getBySession('product-ui')
          .find((row) => row.role === 'user')!
        expect(JSON.parse(user.content)).toEqual(representation)
      }
      expect(
        await models.complete(target, { messages: [{ role: 'user', content: 'after restart' }] })
      ).toMatchObject({ text: 'Rust provider answer' })
      if (nativePlugins)
        expect(requests.at(-1)?.authorization).toBe('Bearer rotated-native-credential')
      if (nativePlugins) {
        const current = await host.start()
        const send = (text: string) =>
          current.call<{ inputId: string }>('session.deepchat_inputs.submit', {
            ...ref,
            input: {
              submission_id: randomUUID(),
              mode: 'queue',
              user: { content: [{ type: 'text', text }] }
            },
            representation: { text, files: [], links: [], search: false, think: false }
          })
        holdQueue = true
        await send('hold the native queue fixture')
        await expect.poll(() => Boolean(heldQueueResponse)).toBe(true)
        const a = await send('queue A')
        const b = await send('queue B')
        const c = await send('queue C')
        const queueRuntime = new DimSessionRuntime({
          database: grants.data,
          host,
          launch: async () => {
            throw new Error('Reuse the existing binding')
          },
          projected: () => {},
          failed: () => {}
        })
        await queueRuntime.open('product-ui')
        await Promise.all([
          queueRuntime.synchronize('product-ui'),
          queueRuntime.synchronize('product-ui')
        ])
        expect((heldQueueResponse as unknown as ServerResponse).writableEnded).toBe(false)
        expect(grants.data.dimSessionBindingsTable.get('product-ui')?.status).toBe('generating')
        const queue = new DimQueue({
          database: grants.data,
          host,
          runtime: queueRuntime,
          prepareNative: async () => {},
          setProjectDir: async () => {},
          prepareInput: async (_id, input) => ({
            content: [{ type: 'text', text: input.text }],
            representation: { text: input.text, files: [], links: [], search: false, think: false },
            summary: { status: 'ready', issues: [] }
          })
        })
        expect((await queue.listPendingInputs('product-ui')).map((item) => item.id)).toEqual([
          a.inputId,
          b.inputId,
          c.inputId
        ])
        await expect(queueRuntime.retire('product-ui', randomUUID(), true)).rejects.toMatchObject({
          data: { appError: 'input_blocked' }
        })
        const moved = await queue.moveQueuedInput('product-ui', c.inputId, 0)
        expect(moved.map((item) => item.payload.text)).toEqual(['queue C', 'queue A', 'queue B'])
        const edited = await queue.updateQueuedInput('product-ui', moved[1].id, {
          text: 'edited queue A'
        })
        expect(
          (await queue.listPendingInputs('product-ui')).map((item) => item.payload.text)
        ).toEqual(['queue C', 'edited queue A', 'queue B'])
        expect(edited.id).not.toBe(a.inputId)
        await queue.deletePendingInput('product-ui', moved[0].id)
        const pending = await queue.listPendingInputs('product-ui')
        const plan = {
          operationId: randomUUID(),
          sources: [pending[1].id],
          order: [],
          replacement: null
        }
        const deleted = await current.call('session.deepchat_queue.mutate', { ...ref, plan })
        expect(await current.call('session.deepchat_queue.mutate', { ...ref, plan })).toEqual(
          deleted
        )
        await expect(queue.deletePendingInput('product-ui', pending[1].id)).rejects.toThrow(
          'already started'
        )
        liveContextVersion = 2
        const steered = await queue.steerPendingInput('product-ui', edited.id)
        expect(steered.mode).toBe('steer')
        const response = heldQueueResponse as unknown as ServerResponse
        response.end(
          `data: ${JSON.stringify({ id: 'held', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: 'queue held response' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
        )
        await current.call('deepchat.host.idle', ref)
        expect(await queue.listPendingInputs('product-ui')).toEqual([])
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).toContain(
          'native product context version 2'
        )
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).not.toContain(
          'native product context version 1'
        )
        await queueRuntime.close('product-ui')
        const desktop = new DimSessionRuntime({
          database: grants.data,
          host,
          launch: async () => {
            throw new Error('Existing native session')
          },
          projected: () => {},
          failed: () => {}
        })
        const interactions = new DimInteractions(grants.data, new DimSessionControls(host))
        const pendingAction = () =>
          grants.data.deepchatMessagesTable
            .getBySession('product-ui')
            .flatMap((message) =>
              message.role === 'assistant'
                ? (JSON.parse(message.content) as AssistantMessageBlock[])
                    .filter((block) => block.type === 'action' && block.status === 'pending')
                    .map((block) => ({ messageId: message.id, block }))
                : []
            )
            .at(-1)
        nextTools = [
          {
            id: 'native-question',
            name: 'ask_user',
            arguments: {
              questions: [
                {
                  id: 'colours',
                  question: 'Choose colours',
                  options: [{ label: 'red, green' }, { label: 'blue' }],
                  multiSelect: true
                },
                {
                  id: 'language',
                  question: 'Choose language',
                  options: [{ label: 'Rust' }, { label: 'TypeScript' }],
                  allowCustom: true
                }
              ]
            }
          }
        ]
        await desktop.submit('product-ui', [
          { type: 'text', text: 'native question batch fixture' }
        ])
        await expect.poll(() => pendingAction()?.block.action_type).toBe('question_request')
        const question = pendingAction()!
        await expect(
          interactions.respondToolInteraction('product-ui', question.messageId, 'native-question', {
            kind: 'question_option',
            optionLabel: 'invalid',
            answers: [
              { questionId: 'colours', selected: ['unknown'] },
              { questionId: 'language', selected: ['Rust'] }
            ]
          })
        ).rejects.toThrow()
        await interactions.respondToolInteraction(
          'product-ui',
          question.messageId,
          'native-question',
          {
            kind: 'question_option',
            optionLabel: 'native structured answer',
            answers: [
              { questionId: 'colours', selected: ['red, green', 'blue'] },
              { questionId: 'language', selected: [], custom: 'native Rust host' }
            ]
          }
        )
        await desktop.waitIdle('product-ui')
        expect(pendingAction()).toBeUndefined()
        const resolved = JSON.parse(
          grants.data.deepchatMessagesTable.get(question.messageId)!.content
        ) as AssistantMessageBlock[]
        expect(resolved.find((block) => block.action_type === 'question_request')).toMatchObject({
          status: 'success',
          extra: { needsUserAction: false }
        })
        expect(requests.at(-1)!.body.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'tool',
              content: expect.stringContaining('native Rust host')
            })
          ])
        )
        await expect(
          interactions.respondToolInteraction('product-ui', question.messageId, 'native-question', {
            kind: 'question_custom',
            answerText: 'duplicate'
          })
        ).rejects.toThrow('no longer pending')
        nextTools = [
          {
            id: 'native-write',
            name: 'write',
            arguments: { path: 'native-consent.txt', content: 'Written by dim' }
          }
        ]
        await desktop.submit('product-ui', [{ type: 'text', text: 'native approval fixture' }])
        await expect.poll(() => pendingAction()?.block.action_type).toBe('tool_call_permission')
        const approval = pendingAction()!
        await interactions.respondToolInteraction(
          'product-ui',
          approval.messageId,
          approval.block.tool_call!.id!,
          { kind: 'permission', granted: true }
        )
        await desktop.waitIdle('product-ui')
        expect(await readFile(path.join(profile, 'native-consent.txt'), 'utf8')).toBe(
          'Written by dim'
        )
        expect(pendingAction()).toBeUndefined()
        nextTools = [
          {
            id: 'native-declined',
            name: 'ask_user',
            arguments: {
              questions: [
                { question: 'Cancel this question?', options: [{ label: 'Yes' }, { label: 'No' }] }
              ]
            }
          }
        ]
        await desktop.submit('product-ui', [{ type: 'text', text: 'native cancel fixture' }])
        await expect.poll(() => pendingAction()?.block.action_type).toBe('question_request')
        await desktop.cancel('product-ui')
        await desktop.waitIdle('product-ui')
        expect(pendingAction()).toBeUndefined()
        const context = new DimContext({
          database: grants.data,
          controls: new DimSessionControls(host),
          content: new DimContent(host),
          output: createDeepChatOutputProjection({
            publishEvent: () => {},
            publishSessionUpdate: () => {}
          }),
          prepareNative: async () => {}
        })
        expect(await context.getSessionContextOccupancy('legacy-unopened')).toMatchObject({
          freshness: 'unavailable'
        })
        expect(await context.getSessionContextOccupancy('product-ui')).toMatchObject({
          freshness: 'current',
          source: 'estimated',
          contextWindowTokens: 64000,
          occupiedTokens: expect.any(Number),
          manifestEntryId: null,
          requestSeq: null,
          timeline: { sessionId, branchId: 'main', sequence: expect.stringMatching(/^\d+$/) }
        })
        const compacted = await context.compactSession('product-ui')
        expect(compacted).toMatchObject({ compacted: true, state: { status: 'compacted' } })
        expect(await context.getSessionCompactionSnapshot('product-ui')).toMatchObject({
          latestAnchorEntryId: null,
          timeline: {
            sessionId,
            branchId: 'main',
            sequence: expect.stringMatching(/^\d+$/),
            eventId: expect.any(String)
          }
        })
        await desktop.close('product-ui')
        // An interrupted, checksummed legacy import resumes before the first native turn.
        const legacyProduct = 'legacy-product'
        grants.data.newSessionsTable.create(legacyProduct, 'deepchat', 'Legacy session', profile)
        await nativeSettings!.initSession(legacyProduct, {
          providerId: 'desktop-fixture',
          modelId: 'fixture',
          generationSettings: { maxTokens: 83, contextLength: 64000 }
        })
        const legacyText = '历史🐳'.repeat(70000)
        const oldMessages: ChatMessageRecord[] = [
          {
            id: 'legacy-user',
            sessionId: legacyProduct,
            orderSeq: 1,
            role: 'user',
            content: JSON.stringify({
              text: 'Legacy original message',
              files: [
                { name: 'legacy.pdf', path: '/old/cache/document.pdf', type: 'application/pdf' }
              ],
              links: [],
              search: false,
              think: false
            }),
            status: 'sent',
            isContextEdge: 0,
            metadata: JSON.stringify({ legacyAnnotation: legacyText }),
            createdAt: 1234,
            updatedAt: 1234
          },
          {
            id: 'legacy-assistant',
            sessionId: legacyProduct,
            orderSeq: 2,
            role: 'assistant',
            content: JSON.stringify([
              {
                id: 'legacy-write',
                type: 'tool_call',
                tool_call: {
                  id: 'old-call',
                  name: 'write',
                  params: JSON.stringify({
                    path: 'legacy-never-run.txt',
                    content: 'must not execute'
                  }),
                  response: 'legacy-tool-result'
                },
                status: 'success',
                timestamp: 1234
              }
            ]),
            status: 'sent',
            isContextEdge: 0,
            metadata: '{}',
            createdAt: 1234,
            updatedAt: 1234
          },
          {
            id: 'legacy-pending',
            sessionId: legacyProduct,
            orderSeq: 3,
            role: 'assistant',
            content: JSON.stringify([
              {
                id: 'legacy-question',
                type: 'action',
                action_type: 'question_request',
                status: 'pending',
                timestamp: 1234,
                tool_call: { id: 'old-question', name: 'question' },
                extra: { needsUserAction: true }
              }
            ]),
            status: 'pending',
            isContextEdge: 0,
            metadata: '{}',
            createdAt: 1234,
            updatedAt: 1234
          }
        ]
        const applier = new TranscriptProjectionApplier(grants.data)
        for (const message of oldMessages) applier.applyRecord(message)
        const native = await host.start()
        const legacyCreated = await native.call<{ sessionId: string }>(
          'deepchat.host.launch',
          await nativeSettings!.launch(legacyProduct)
        )
        const legacyBinding = grants.data.dimSessionBindingsTable.bind(
          legacyProduct,
          legacyCreated.sessionId,
          'main',
          4
        )
        const legacyRef = { sessionId: legacyCreated.sessionId, branchId: 'main' }
        const legacySource = new DimLegacySource({
          database: grants.data,
          transcript: { getMessages: () => oldMessages },
          tape: { getEffectiveViewInputRows: () => [] },
          summary: {
            getSummaryState: () => ({
              summaryText: 'Prior summary retained',
              summaryCursorOrderSeq: 2,
              summaryUpdatedAt: 1234
            })
          },
          pending: { listPendingInputs: () => [] }
        })
        const snapshot = await legacySource.snapshot(legacyProduct)
        snapshot.messages = snapshot.messages.map(normalizeDimImportedMessage)
        const historyPlan = dimHistoryPlan(snapshot)
        expect(historyPlan.chunks.length).toBeGreaterThan(1)
        grants.data.dimSessionImportsTable.begin(legacyBinding, historyPlan)
        const manifest = {
          migrationId: historyPlan.migrationId,
          productSessionId: legacyProduct,
          digest: historyPlan.digest,
          chunks: historyPlan.chunks.length
        }
        await native.call('session.deepchat_migration.begin', {
          ...legacyRef,
          migrationId: historyPlan.migrationId,
          manifest
        })
        await expect(
          native.call('session.deepchat_migration.chunk', {
            ...legacyRef,
            migrationId: historyPlan.migrationId,
            index: 0,
            payload: historyPlan.chunks[0],
            checksum: '0'.repeat(64)
          })
        ).rejects.toThrow('Invalid history chunk')
        await native.call('session.deepchat_migration.chunk', {
          ...legacyRef,
          migrationId: historyPlan.migrationId,
          index: 0,
          payload: historyPlan.chunks[0],
          checksum: dimHistoryHash(historyPlan.chunks[0])
        })
        await expect(
          native.call('session.deepchat_inputs.submit', {
            ...legacyRef,
            input: {
              submission_id: randomUUID(),
              mode: 'queue',
              user: { content: [{ type: 'text', text: 'must wait for import' }] }
            },
            representation: {
              text: 'must wait for import',
              files: [],
              links: [],
              search: false,
              think: false
            }
          })
        ).rejects.toMatchObject({ data: { appError: 'migration_incomplete' } })
        await host.stop()
        let sourceReads = 0
        const migration = new DimLegacyMigration({
          database: grants.data,
          host,
          snapshot: async () => {
            sourceReads++
            if (sourceReads > 1) throw new Error('Committed history must be read only through dim')
            return legacySource.snapshot(legacyProduct)
          }
        })
        const importFailures: unknown[] = []
        const importedRuntime = new DimSessionRuntime({
          database: grants.data,
          host,
          launch: async () => {
            throw new Error('Reuse the interrupted native import')
          },
          prepare: async (binding) => {
            await nativeSettings!.prepare(binding)
            await migration.prepare(binding)
          },
          projected: () => {},
          failed: (_id, error) => importFailures.push(error)
        })
        const callsBeforeImport = conversationRequests().length
        await importedRuntime.open(legacyProduct)
        await importedRuntime.waitIdle(legacyProduct)
        expect(conversationRequests()).toHaveLength(callsBeforeImport)
        expect(sourceReads).toBe(1)
        expect(grants.data.dimSessionImportsTable.get(legacyBinding)).toMatchObject({
          sealed: true
        })
        const importedRows = grants.data.deepchatMessagesTable.getBySession(legacyProduct)
        expect(importedRows.map((row) => row.id)).toEqual(oldMessages.map((message) => message.id))
        expect(JSON.parse(importedRows[0].content)).toMatchObject({
          text: 'Legacy original message',
          files: [{ name: 'legacy.pdf' }]
        })
        expect(importedRows[2].status).toBe('error')
        expect(JSON.parse(importedRows[0].metadata).legacyAnnotation).toBe(legacyText)
        expect(JSON.parse(importedRows[2].content)[0]).toMatchObject({
          status: 'error',
          extra: { needsUserAction: false }
        })
        await expect(readFile(path.join(profile, 'legacy-never-run.txt'))).rejects.toMatchObject({
          code: 'ENOENT'
        })
        const resumedSubmissionId = randomUUID()
        const resumed = await importedRuntime.submit(
          legacyProduct,
          [{ type: 'text', text: 'first native continuation' }],
          { submissionId: resumedSubmissionId }
        )
        await importedRuntime.waitIdle(legacyProduct)
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).toContain('legacy-tool-result')
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).not.toContain(
          'Legacy original message'
        )
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).toContain(
          'Prior summary retained'
        )
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).toContain(
          'first native continuation'
        )
        expect(grants.data.deepchatMessagesTable.getBySession(legacyProduct)).toHaveLength(5)
        await importedRuntime.close(legacyProduct)
        await host.stop()
        // Lose the desktop receipt and cache. The native seal recovers both without legacy reads.
        grants.data
          .getDatabase()
          .prepare('UPDATE dim_session_imports SET sealed_cursor=NULL WHERE session_id=?')
          .run(legacyProduct)
        applier.applyRetractions(grants.data.deepchatMessagesTable.getIdsBySession(legacyProduct))
        grants.data.dimSessionBindingsTable.delete(legacyProduct)
        grants.data.dimSessionBindingsTable.bind(legacyProduct, legacyCreated.sessionId)
        await importedRuntime.open(legacyProduct)
        await importedRuntime.waitIdle(legacyProduct)
        expect(sourceReads).toBe(1)
        expect(grants.data.deepchatMessagesTable.getBySession(legacyProduct)).toHaveLength(5)
        expect(
          JSON.parse(grants.data.deepchatMessagesTable.get('legacy-user')!.metadata)
            .legacyAnnotation
        ).toBe(legacyText)
        expect(importFailures).toEqual([])
        await expect(readFile(path.join(profile, 'legacy-never-run.txt'))).rejects.toMatchObject({
          code: 'ENOENT'
        })
        expect(await new DimSessionControls(host).call('native_identity', legacyRef)).toMatchObject(
          { cwd: profile, tools: null }
        )
        const neverSent = randomUUID()
        grants.data.dimInputIntentsTable.begin({
          submissionId: neverSent,
          sessionId: legacyProduct,
          dimSessionId: legacyCreated.sessionId,
          branchId: 'main',
          payload: {}
        })
        grants.data.dimInputIntentsTable.settle(neverSent, 'unknown')
        const retirement = randomUUID()
        const beforeRetirement = conversationRequests().length
        await importedRuntime.retire(legacyProduct, retirement)
        await importedRuntime.retire(legacyProduct, retirement)
        expect(grants.data.dimInputIntentsTable.get(neverSent)?.state).toBe('rejected')
        expect(
          await (
            await host.start()
          ).call('session.deepchat_inputs.submit', {
            ...legacyRef,
            input: {
              submission_id: resumedSubmissionId,
              mode: 'queue',
              user: { content: [{ type: 'text', text: 'first native continuation' }] }
            }
          })
        ).toEqual(resumed)
        const lateSubmission = randomUUID()
        await expect(
          importedRuntime.submit(
            legacyProduct,
            [{ type: 'text', text: 'late input into retired generation' }],
            { submissionId: lateSubmission }
          )
        ).rejects.toMatchObject({ data: { appError: 'session_retired' } })
        expect(grants.data.dimInputIntentsTable.get(lateSubmission)?.state).toBe('rejected')
        expect(conversationRequests()).toHaveLength(beforeRetirement)
        await importedRuntime.close(legacyProduct)
        await host.stop()
        const restored = await host.start()
        await expect(
          restored.call('session.deepchat_inputs.submit', {
            ...legacyRef,
            input: {
              submission_id: randomUUID(),
              user: { content: [{ type: 'text', text: 'retirement survives restart' }] },
              mode: 'queue'
            }
          })
        ).rejects.toMatchObject({ data: { appError: 'session_retired' } })
        const callsBeforeStoredRead = conversationRequests().length
        await new DimSessionControls(host).call('close', legacyRef)
        const stored = await new DimContent(host).transcript(legacyRef, legacyProduct)
        expect(
          stored.messages.map((message) => ({
            id: message.id,
            content: message.content,
            status: message.status
          }))
        ).toEqual(
          grants.data.deepchatMessagesTable.getBySession(legacyProduct).map((message) => ({
            id: message.id,
            content: message.content,
            status: message.status
          }))
        )
        expect(
          await importedRuntime.reconcile(
            grants.data.dimInputIntentsTable.get(resumedSubmissionId)!
          )
        ).toEqual(resumed)
        const summaries = await restored.call<Array<{ sessionId: string; closed: boolean }>>(
          'session.summaries',
          { includeClosed: true }
        )
        expect(summaries.find((session) => session.sessionId === legacyRef.sessionId)?.closed).toBe(
          true
        )
        expect(conversationRequests()).toHaveLength(callsBeforeStoredRead)
        expect(await restored.call('session.deepchat_queue.mutate', { ...ref, plan })).toEqual(
          deleted
        )
        expect(await queue.listPendingInputs('product-ui')).toEqual([])

        // A sealed target survives interruption before the atomic product binding switch.
        const scopeProduct = 'scope-product'
        grants.data.newSessionsTable.create(scopeProduct, 'deepchat', 'Scope session', profile)
        await nativeSettings!.initSession(scopeProduct, {
          providerId: 'desktop-fixture',
          modelId: 'fixture'
        })
        const scopeRuntime = new DimSessionRuntime({
          database: grants.data,
          host,
          launch: (id) => nativeSettings!.launch(id),
          prepare: (binding) => nativeSettings!.prepare(binding),
          projected: () => {},
          failed: (_id, error) => importFailures.push(error)
        })
        await scopeRuntime.submit(scopeProduct, [{ type: 'text', text: 'scope original' }])
        await scopeRuntime.waitIdle(scopeProduct)
        const originalScope = grants.data.dimSessionBindingsTable.get(scopeProduct)!
        const originalView = await new DimContent(host).transcript(
          { sessionId: originalScope.dimSessionId, branchId: originalScope.branchId },
          scopeProduct
        )
        const changedDirectory = await mkdtemp(path.join(profile, 'scope-directory-'))
        const transitionOptions = {
          database: grants.data,
          host,
          runtime: scopeRuntime,
          installed: () => {}
        }
        const nativeCallsBeforeChange = conversationRequests().length
        grants.sqlite.exec(`CREATE TRIGGER interrupt_scope_install
          BEFORE UPDATE ON dim_session_bindings WHEN OLD.session_id='scope-product'
          AND NEW.generation=2 BEGIN SELECT RAISE(ABORT,'scope install interrupted'); END`)
        await expect(
          new DimScopeTransitions(transitionOptions).replace(
            scopeProduct,
            { cwd: changedDirectory },
            { kind: 'retain' }
          )
        ).rejects.toThrow('scope install interrupted')
        const interrupted = grants.data.dimScopeChangesTable.get(scopeProduct)!
        expect(interrupted.targetSessionId).toBeTruthy()
        expect(grants.data.dimSessionBindingsTable.get(scopeProduct)?.generation).toBe(1)
        expect(conversationRequests()).toHaveLength(nativeCallsBeforeChange)
        await host.stop()
        grants.sqlite.exec('DROP TRIGGER interrupt_scope_install')
        const transitions = new DimScopeTransitions(transitionOptions)
        const changedScope = (await transitions.recover(scopeProduct))!
        expect(changedScope).toMatchObject({
          generation: 2,
          dimSessionId: interrupted.targetSessionId
        })
        expect(grants.data.dimScopeChangesTable.get(scopeProduct)).toBeNull()
        expect(
          await transitions.ensureCreation(scopeProduct, { cwd: changedDirectory })
        ).toMatchObject({ generation: 2, dimSessionId: changedScope.dimSessionId })
        expect(
          grants.data.deepchatMessagesTable.getBySession(scopeProduct).map((row) => row.id)
        ).toEqual(originalView.messages.map((message) => message.id))
        expect(conversationRequests()).toHaveLength(nativeCallsBeforeChange)
        grants.data.newSessionsTable.update(scopeProduct, { project_dir: changedDirectory })
        expect(
          await controls.call('native_identity', {
            sessionId: changedScope.dimSessionId,
            branchId: changedScope.branchId
          })
        ).toMatchObject({ cwd: changedDirectory })
        await scopeRuntime.submit(scopeProduct, [{ type: 'text', text: 'scope after directory' }])
        await scopeRuntime.waitIdle(scopeProduct)
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).toContain('scope original')
        const callsBeforeEdit = conversationRequests().length
        providerEnabled = false
        const sourceMessage = originalView.messages[0]
        const editedContent = JSON.stringify({
          ...JSON.parse(sourceMessage.content),
          text: 'scope edited'
        })
        const invalidated: number[] = []
        const nativeMutations = new DimTranscriptMutations({
          database: grants.data,
          host,
          settings: nativeSettings!,
          transitions,
          prepareHistory: async () => {},
          projectDir: () => changedDirectory,
          invalidate: (_id, from) => {
            invalidated.push(from)
          }
        })
        const mutations = new SessionTranscriptMutations({
          native: { owns: (id) => id === scopeProduct, mutations: nativeMutations },
          get transcript() {
            throw new Error('Native edits must not use the legacy writer')
          },
          get settings() {
            throw new Error('Native edits must not reset Tape')
          },
          get pendingInputs() {
            throw new Error('Native edits must not use the old queue')
          },
          get runtime() {
            throw new Error('Native edits must not use the old runtime')
          },
          runInTransaction: () => {
            throw new Error('Native edits must use atomic generation installation')
          }
        })
        await mutations.editUserMessage(scopeProduct, sourceMessage.id, 'scope edited')
        expect(grants.data.deepchatMessagesTable.get(sourceMessage.id)?.content).toBe(editedContent)
        expect(grants.data.dimSessionBindingsTable.get(scopeProduct)?.generation).toBe(3)
        expect(conversationRequests()).toHaveLength(callsBeforeEdit)
        providerEnabled = true
        const retry = await mutations.prepareRetryMessage(scopeProduct, sourceMessage.id)
        expect(retry.reuseUserMessage?.messageId).toBe(sourceMessage.id)
        await mutations.commitRetryMessage(
          scopeProduct,
          retry.retryFromOrderSeq,
          retry.reuseUserMessage
        )
        const retrySubmissionId = randomUUID()
        const retried = await scopeRuntime.submit(
          scopeProduct,
          [{ type: 'text', text: retry.content.text }],
          {
            submissionId: retrySubmissionId,
            representation: JSON.parse(editedContent),
            reuseUserMessage: retry.reuseUserMessage
          }
        )
        expect(
          await scopeRuntime.submit(scopeProduct, [{ type: 'text', text: retry.content.text }], {
            submissionId: retrySubmissionId,
            representation: JSON.parse(editedContent),
            reuseUserMessage: retry.reuseUserMessage
          })
        ).toEqual(retried)
        await scopeRuntime.waitIdle(scopeProduct)
        expect(
          JSON.stringify(conversationRequests().at(-1)!.body).match(/scope edited/g)
        ).toHaveLength(1)
        const retriedView = await new DimContent(host).transcript(
          {
            sessionId: grants.data.dimSessionBindingsTable.get(scopeProduct)!.dimSessionId,
            branchId: 'main'
          },
          scopeProduct
        )
        expect(retriedView.messages).toHaveLength(2)
        expect(retriedView.messages[0]).toMatchObject({
          id: sourceMessage.id,
          createdAt: sourceMessage.createdAt,
          content: editedContent
        })
        const callsBeforeClear = conversationRequests().length
        providerEnabled = false
        await mutations.clearMessages(scopeProduct)
        expect(grants.data.deepchatMessagesTable.getBySession(scopeProduct)).toEqual([])
        expect(grants.data.dimSessionBindingsTable.get(scopeProduct)?.generation).toBe(5)
        expect(
          grants.data.dimSessionScopesTable.list(scopeProduct).map((scope) => scope.generation)
        ).toEqual([1, 2, 3, 4, 5])
        expect(conversationRequests()).toHaveLength(callsBeforeClear)
        expect(invalidated).toEqual([1, 1, 1])
        providerEnabled = true
        expect(importFailures).toEqual([])

        // Exercise the composed desktop backend, including its asynchronous retry boundary.
        const facadeId = toAppSessionId('facade-product')
        grants.data.newSessionsTable.create(facadeId, 'deepchat', 'Facade session', profile)
        const facade = createDimAgent({
          database: grants.data,
          host,
          state: nativeState!,
          models: catalog!,
          legacy: new DimLegacySource({
            database: grants.data,
            transcript: { getMessages: () => [] },
            tape: { getEffectiveViewInputRows: () => [] },
            summary: {
              getSummaryState: () => ({
                summaryText: null,
                summaryCursorOrderSeq: 1,
                summaryUpdatedAt: null
              })
            },
            pending: { listPendingInputs: () => [] }
          }),
          identity: async (id) => ({
            name: 'Facade fixture',
            description: '',
            cwd: grants.data.newSessionsTable.get(id)?.project_dir ?? profile
          }),
          prepareInput: new DimInputPreparation({
            capabilities: () => ({ vision: false, audio: false }),
            attachments: {
              prepare: async ({ content }) => ({
                content,
                summary: { status: 'ready', issues: [], suggestedActions: [] }
              })
            }
          }).prepare,
          output: createDeepChatOutputProjection({
            publishEvent: () => {},
            publishSessionUpdate: () => {}
          }),
          publishStatus: () => {},
          publishEvent: () => {},
          completed: () => {},
          committed: () => {},
          failed: (_id, error) => importFailures.push(error),
          mcpServers: async () =>
            mcpEnabled
              ? {
                  fixture: {
                    type: 'http',
                    url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/native-mcp`,
                    headers: { Authorization: `Bearer ${mcpToken}` }
                  }
                }
              : {},
          refreshTools: async (binding) => {
            await (
              await host.start()
            ).call('session.deepchat_tools.refresh', {
              sessionId: binding.dimSessionId,
              branchId: binding.branchId
            })
          },
          closed: () => {},
          invalidateHistory: () => {},
          beginDestroy: () => {},
          finishDestroy: () => {},
          deleteLegacyMetadata: () => {}
        })
        await facade.backend.initSession(facadeId, {
          providerId: 'desktop-fixture',
          modelId: 'fixture'
        })
        providerEnabled = false
        const callsBeforeContainer = conversationRequests().length
        await facade.prepareHistory(facadeId)
        expect(grants.data.dimSessionBindingsTable.get(facadeId)).toBeTruthy()
        await expect(
          facade.backend.send(facadeId, { content: { text: 'disabled inference' } })
        ).rejects.toThrow('Provider is unavailable')
        expect(grants.data.deepchatMessagesTable.getBySession(facadeId)).toEqual([])
        expect(conversationRequests()).toHaveLength(callsBeforeContainer)
        providerEnabled = true
        nextTools = [
          {
            id: 'facade-capability',
            name: 'deepchat_facade_echo',
            arguments: { text: 'scope-only' }
          }
        ]
        await facade.backend.send(facadeId, { content: { text: 'facade original' } })
        await facade.runtime.waitIdle(facadeId)
        expect(productToolCalls).toHaveLength(1)
        expect(productToolCalls[0]).toMatchObject({
          sessionId: grants.data.dimSessionBindingsTable.get(facadeId)!.dimSessionId,
          name: 'deepchat_facade_echo',
          arguments: { text: 'scope-only' }
        })
        const forkProduct = toAppSessionId('facade-fork')
        grants.data.newSessionsTable.create(forkProduct, 'deepchat', 'Native fork', profile)
        await facade.backend.initSession(forkProduct, {
          providerId: 'desktop-fixture',
          modelId: 'fixture'
        })
        const forkSourceBinding = grants.data.dimSessionBindingsTable.get(facadeId)!
        const forkSource = await new DimContent(host).transcript(
          {
            sessionId: forkSourceBinding.dimSessionId,
            branchId: forkSourceBinding.branchId
          },
          facadeId
        )
        const forkMessage = forkSource.messages.findLast((message) => message.status === 'sent')!
        await facade.mutations.forkSessionFromMessage(facadeId, forkProduct, forkMessage.id)
        const forkBinding = grants.data.dimSessionBindingsTable.get(forkProduct)!
        const forkView = await new DimContent(host).transcript(
          {
            sessionId: forkBinding.dimSessionId,
            branchId: forkBinding.branchId
          },
          forkProduct
        )
        expect(forkView.messages.map((message) => message.content)).toEqual(
          forkSource.messages
            .filter(
              (message) => message.status === 'sent' && message.orderSeq <= forkMessage.orderSeq
            )
            .map((message) => message.content)
        )
        expect(forkView.messages.length).toBeGreaterThan(0)
        expect(
          forkView.messages.every(
            (message) =>
              message.sessionId === forkProduct &&
              !forkSource.messages.some((source) => source.id === message.id)
          )
        ).toBe(true)
        await facade.backend.destroySession(forkProduct)
        expect(grants.data.dimSessionBindingsTable.get(facadeId)).not.toBeNull()

        const memorySource = new DimMemorySource({
          database: grants.data,
          host,
          content: new DimContent(host)
        })
        const memoryRange = await memorySource.readRange(facadeId, 0, 100)
        expect(memoryRange.rows.map((row) => row.role)).toEqual(['user', 'assistant'])
        expect(memoryRange.rows[1].hadToolUse).toBe(true)
        const memoryReference = memoryRange.rows[0].entryId as MemorySourceReference
        expect(memoryReference).toMatchObject({
          kind: 'dim',
          messageId: grants.data.deepchatMessagesTable.getBySession(facadeId)[0].id
        })
        const audit = await memorySource.audit({
          sessionId: facadeId,
          name: 'memory/view_assembled',
          state: { selected: ['native-memory-audit-sentinel'] }
        })
        expect(audit).toMatchObject({
          entryId: null,
          timeline: { eventId: expect.any(String), sequence: expect.stringMatching(/^\d+$/) }
        })
        expect(
          (
            await new DimContent(host).latest(
              { sessionId: memoryReference.sessionId, branchId: memoryReference.branchId },
              ['deepchat/memory-audit']
            )
          ).event?.data.state
        ).toEqual({ selected: ['native-memory-audit-sentinel'] })
        const facadeBinding = grants.data.dimSessionBindingsTable.get(facadeId)!
        const otherBinding = grants.data.dimSessionBindingsTable.get(scopeProduct)!
        expect(
          await (
            await host.start()
          ).call('session.deepchat_tools.refresh', {
            sessionId: otherBinding.dimSessionId,
            branchId: otherBinding.branchId
          })
        ).toMatchObject({ count: 0, version: 'empty' })
        expect(
          await (
            await host.start()
          ).call('session.deepchat_tools.refresh', {
            sessionId: facadeBinding.dimSessionId,
            branchId: facadeBinding.branchId
          })
        ).toMatchObject({
          count: 1,
          version: (await desktopTools.resolve(facadeBinding.dimSessionId)).version
        })
        await facade.backend.setSessionProjectDir(facadeId, changedDirectory)
        await facade.backend.send(facadeId, { content: { text: 'facade after directory' } })
        await facade.runtime.waitIdle(facadeId)
        expect(contextSessionIds.at(-1)).toBe(
          grants.data.dimSessionBindingsTable.get(facadeId)!.dimSessionId
        )
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).not.toContain(
          'native-memory-audit-sentinel'
        )
        const evidence = await new DimMemoryEvidence({
          database: grants.data,
          content: new DimContent(host)
        }).read(facadeId, [memoryReference])
        expect(evidence[0].record.id).toBe(memoryReference.messageId)
        expect(JSON.stringify(evidence[0].record.content)).toContain('facade original')
        const facadeUser = grants.data.deepchatMessagesTable.getBySession(facadeId)[2]
        const facadeRetry = await facade.mutations.prepareRetryMessage(facadeId, facadeUser.id)
        let boundaryCompleted = false
        await facade.backend.send(facadeId, {
          content: facadeRetry.content,
          context: {
            reuseUserMessage: facadeRetry.reuseUserMessage,
            beforeHistoryPreparation: async () => {
              await facade.mutations.commitRetryMessage(
                facadeId,
                facadeRetry.retryFromOrderSeq,
                facadeRetry.reuseUserMessage
              )
              boundaryCompleted = true
            }
          }
        })
        expect(boundaryCompleted).toBe(true)
        await facade.runtime.waitIdle(facadeId)
        const facadeRows = grants.data.deepchatMessagesTable.getBySession(facadeId)
        expect(facadeRows).toHaveLength(4)
        expect(facadeRows[2].id).toBe(facadeUser.id)
        expect(
          JSON.stringify(conversationRequests().at(-1)!.body).match(/facade after directory/g)
        ).toHaveLength(1)
        const cancelledRetry = new AbortController()
        const beforeCancelledRetry = conversationRequests().length
        await expect(
          facade.backend.send(facadeId, {
            content: facadeRetry.content,
            context: {
              signal: cancelledRetry.signal,
              reuseUserMessage: facadeRetry.reuseUserMessage,
              beforeHistoryPreparation: async () => {
                await facade.mutations.commitRetryMessage(
                  facadeId,
                  facadeRetry.retryFromOrderSeq,
                  facadeRetry.reuseUserMessage
                )
                cancelledRetry.abort()
              }
            }
          })
        ).rejects.toThrow()
        expect(conversationRequests()).toHaveLength(beforeCancelledRetry)
        expect(grants.data.deepchatMessagesTable.get(facadeUser.id)?.role).toBe('user')
        expect(grants.data.deepchatMessagesTable.getBySession(facadeId)).toHaveLength(3)
        // Reopening must preserve the unsubmitted prompt; the next ordinary input restores its
        // historical context through native Append, without running a separate turn for it.
        await facade.runtime.close(facadeId)
        await host.stop()
        await facade.runtime.open(facadeId)
        await facade.backend.send(facadeId, { content: { text: 'after cancelled retry' } })
        await facade.runtime.waitIdle(facadeId)
        expect(conversationRequests()).toHaveLength(beforeCancelledRetry + 1)
        expect(
          JSON.stringify(conversationRequests().at(-1)!.body).match(/facade after directory/g)
        ).toHaveLength(1)
        expect(JSON.stringify(conversationRequests().at(-1)!.body)).toContain(
          'after cancelled retry'
        )
        expect(grants.data.deepchatMessagesTable.getBySession(facadeId)).toHaveLength(5)
        await facade.backend.setPermissionMode(facadeId, 'full_access')
        mcpEnabled = true
        productCatalogVersion = 'facade-mcp-coexist'
        nextMcpCall = true
        await facade.backend.send(facadeId, { content: { text: 'use native MCP' } })
        await facade.runtime.waitIdle(facadeId)
        expect(mcpCalls).toEqual(['Bearer native-mcp-first'])
        await facade.runtime.close(facadeId)
        await host.stop()
        await facade.runtime.open(facadeId)
        mcpToken = 'native-mcp-rotated'
        nextMcpCall = true
        await facade.backend.send(facadeId, { content: { text: 'use rotated native MCP' } })
        await facade.runtime.waitIdle(facadeId)
        expect(mcpCalls).toEqual(['Bearer native-mcp-first', 'Bearer native-mcp-rotated'])
        mcpEnabled = false
        await facade.backend.send(facadeId, { content: { text: 'native MCP was disabled' } })
        await facade.runtime.waitIdle(facadeId)
        expect(JSON.stringify(conversationRequests().at(-1)!.body.tools)).not.toContain(
          'Native MCP migration fixture'
        )
        expect(productToolCalls).toHaveLength(1)
        const beforeBlockedContext = conversationRequests().length
        await facade.backend.send(facadeId, { content: { text: 'block native product context' } })
        await expect.poll(() => contextStarted).toBe(true)
        await facade.backend.cancelGeneration(facadeId)
        await facade.runtime.waitIdle(facadeId)
        await expect.poll(() => contextCancelled).toBe(true)
        expect(conversationRequests()).toHaveLength(beforeBlockedContext)
        // dim's own agent tool creates and runs the member. The desktop authorizes its
        // immutable native parent link; it never creates, schedules or calls the child model.
        await facade.backend.setPermissionMode(facadeId, 'full_access')
        const leaderBinding = grants.data.dimSessionBindingsTable.get(facadeId)!
        const nativeModel = await new DimSessionControls(host).call<{
          providerId: string
          modelId: string
        }>('native_settings', {
          sessionId: leaderBinding.dimSessionId,
          branchId: leaderBinding.branchId
        })
        nextTools = [
          {
            id: 'native-delegation',
            name: 'agent',
            arguments: {
              action: 'request',
              prompt: 'native member task scope proof',
              profile: {
                name: 'Native scope member',
                description: 'Native delegation fixture',
                systemPrompt: 'Complete the delegated task.',
                tools: [],
                model: nativeModel
              }
            }
          }
        ]
        await facade.backend.send(facadeId, {
          content: { text: 'delegate through the native agent tool' }
        })
        await facade.runtime.waitIdle(facadeId)
        await expect
          .poll(() =>
            nativeScopes.some(
              (scope) =>
                scope.description.parentSessionId === leaderBinding.dimSessionId &&
                scope.description.role === 'member'
            )
          )
          .toBe(true)
        const child = nativeScopes.findLast(
          (scope) => scope.description.parentSessionId === leaderBinding.dimSessionId
        )!
        expect(child.binding.sessionId).toBe(facadeId)
        expect(child.ref.sessionId).not.toBe(leaderBinding.dimSessionId)
        expect(child.ref.branchId).toBe('main')
        expect(child.description.cwd).toBe(changedDirectory)
        await expect
          .poll(() =>
            requests.some((request) => {
              const messages = request.body.messages as
                | Array<{ role: string; content: unknown }>
                | undefined
              return (
                messages?.some(
                  (message) =>
                    message.role === 'system' &&
                    JSON.stringify(message.content).includes('Complete the delegated task.')
                ) && JSON.stringify(messages).includes('native member task scope proof')
              )
            })
          )
          .toBe(true)
        await (await host.start()).call('deepchat.host.delete', { sessionId: child.ref.sessionId })
        await facade.runtime.waitIdle(facadeId)
        const facadeScopes = grants.data.dimSessionScopesTable.list(facadeId)
        expect(facadeScopes).toHaveLength(4)
        await facade.backend.destroySession(facadeId)
        expect(grants.data.dimSessionBindingsTable.get(facadeId)).toBeNull()
        expect(grants.data.deepchatMessagesTable.getBySession(facadeId)).toEqual([])
        expect(grants.data.dimSessionScopesTable.list(facadeId)).toEqual([])
        const remaining = await (
          await host.start()
        ).call<Array<{ sessionId: string }>>('session.summaries', { includeClosed: true })
        expect(
          remaining.some((row) =>
            facadeScopes.some((scope) => scope.dimSessionId === row.sessionId)
          )
        ).toBe(false)
        expect(
          remaining.some(
            (row) =>
              row.sessionId === grants.data.dimSessionBindingsTable.get(scopeProduct)!.dimSessionId
          )
        ).toBe(true)
        expect(importFailures).toEqual([])
      }
    } finally {
      await host.stop()
      await gateway.stop()
      grants.sqlite.close()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  120_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'executes product tools inside dim and reloads their scoped catalog with cancellation',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-tools-'))
    const fixture = createServer(async (request, response) => {
      let payload = ''
      for await (const chunk of request) payload += chunk
      const body = JSON.parse(payload)
      const last = body.messages?.at(-1)
      const title = JSON.stringify(body.messages).includes(
        'Write a short title for this conversation:'
      )
      const text =
        typeof last?.content === 'string'
          ? last.content
          : Array.isArray(last?.content)
            ? last.content
                .filter((part: { type: string }) => part.type === 'text')
                .map((part: { text: string }) => part.text)
                .join('\n')
            : ''
      const tool = !title && last?.role === 'user' ? text.match(/^tool:(\w+) (.*)$/s) : null
      const message = tool
        ? {
            role: 'assistant',
            tool_calls: [
              {
                id: randomUUID(),
                type: 'function',
                function: { name: tool[1], arguments: tool[2] }
              }
            ]
          }
        : { role: 'assistant', content: 'Native tool fixture response' }
      const finishReason = tool ? 'tool_calls' : 'stop'
      const result = {
        id: randomUUID(),
        object: 'chat.completion',
        model: 'fixture',
        created: 0,
        choices: [{ index: 0, message, finish_reason: finishReason }]
      }
      if (body.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(
          `data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { ...message, ...(tool ? { tool_calls: message.tool_calls!.map((call, index) => ({ ...call, index })) } : {}) }, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`
        )
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(result))
      }
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    let version = 'one'
    let names = ['deepchat_echo', 'deepchat_hold']
    const calls: DimProductToolCall[] = []
    let cancelled = false
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version,
        tools: names.map((name) => ({
          name,
          description: 'DeepChat native bridge fixture',
          inputSchema: { type: 'object' },
          source: 'extension',
          risk: 'session'
        })),
        execute: async (call, signal) => {
          calls.push(call)
          if (call.name === 'deepchat_hold') {
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve()
              else
                signal.addEventListener(
                  'abort',
                  () => {
                    cancelled = true
                    resolve()
                  },
                  { once: true }
                )
            })
          }
          return { content: `product: ${call.arguments.text ?? 'done'}` }
        }
      })
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true,
      gatewayAddress: await gateway.start()
    })
    try {
      const client = await host.start()
      const model = await new DimModelBridge(host).configure({
        key: 'native-tools-fixture',
        displayName: 'Native tools fixture',
        connection: {
          driverKind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
          auth: { type: 'anonymous' }
        },
        model: {
          modelId: 'fixture',
          displayName: 'Native tools fixture',
          status: 'active',
          capabilities: {
            modalities: ['text'],
            structuredOutput: false,
            vision: false,
            audio: false,
            reasoning: false,
            contextWindow: 65536,
            maxOutputTokens: 4096,
            toolCalling: true,
            streaming: true
          }
        }
      })
      const { agentId } = await client.call<{ agentId: string }>('agent.create', {
        profile: { name: 'DeepChat tools fixture', description: '', systemPrompt: '' }
      })
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        agent: agentId,
        model: { ...model },
        policy: { preset: 'full-access' }
      })
      const ref = { sessionId, branchId: 'main' }
      const send = (text: string) =>
        client.call('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text }]
        })
      await client.call('session.deepchat_tools.refresh', ref)
      await send('tool:deepchat_echo {"text":"first"}')
      await client.call('deepchat.host.idle', ref)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        ...ref,
        name: 'deepchat_echo',
        arguments: { text: 'first' },
        turnId: expect.any(String),
        callId: expect.any(String)
      })
      const history = await client.call<{
        events: import('@/agent/dim/sessionConnection').DimEvent[]
      }>('deepchat.storage.history', { ...ref, limit: 100 })
      let projected: DimSessionBinding = {
        sessionId: 'desktop',
        dimSessionId: sessionId,
        branchId: 'main',
        generation: 1,
        cursor: '0',
        nextOrderSeq: 1,
        activeTurnId: null,
        assistantMessageId: null,
        status: 'idle'
      }
      const transcript = new Map<string, ChatMessageRecord>()
      const inputCache = new Map<string, import('@/agent/dim/sessionConnection').DimEvent>()
      for (const event of history.events) {
        const update = projectDimEvent(
          projected,
          event,
          (id) => transcript.get(id) ?? null,
          (id) => inputCache.get(id) ?? null
        )
        for (const input of update.inputEvents ?? []) inputCache.set(input.id, input)
        for (const id of update.consumedInputs ?? []) inputCache.delete(id)
        for (const message of update.messages) transcript.set(message.id, message)
        projected = update.binding
      }
      expect(JSON.parse([...transcript.values()][1].content)).toContainEqual(
        expect.objectContaining({
          type: 'tool_call',
          status: 'success',
          tool_call: expect.objectContaining({
            name: 'deepchat_echo',
            response: expect.stringContaining('product: first')
          })
        })
      )
      version = 'refused-native-shadow'
      names = ['read']
      await expect(client.call('session.deepchat_tools.refresh', ref)).rejects.toThrow(
        'Native tool registry rejected the product catalog'
      )
      version = 'two'
      names = ['deepchat_changed', 'deepchat_hold']
      expect(await client.call('session.deepchat_tools.refresh', ref)).toEqual({
        version,
        count: 2
      })
      await send('tool:deepchat_changed {"text":"second"}')
      await client.call('deepchat.host.idle', ref)
      expect(calls.at(-1)?.name).toBe('deepchat_changed')
      await send('tool:deepchat_hold {}')
      await expect.poll(() => calls.at(-1)?.name).toBe('deepchat_hold')
      await client.call('deepchat.host.stop', ref)
      await client.call('deepchat.host.idle', ref)
      await expect.poll(() => cancelled).toBe(true)
      await host.stop()
      const restored = await host.start()
      await restored.call('deepchat.storage.history', { ...ref, limit: 1 })
      await restored.call('session.deepchat_tools.refresh', ref)
      await restored.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'tool:deepchat_changed {"text":"restored"}' }]
      })
      await restored.call('deepchat.host.idle', ref)
      expect(calls.at(-1)).toMatchObject({
        name: 'deepchat_changed',
        arguments: { text: 'restored' }
      })
    } finally {
      await host.stop()
      await gateway.stop()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'durably admits an input once and restores the native binding and transcript after restart',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-durable-'))
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock'
    })
    let db = dimDatabase(path.join(profile, 'desktop.sqlite'))
    const errors: unknown[] = []
    const open = () =>
      new DimSessionRuntime({
        database: db.data,
        host,
        launch: async () => ({ cwd: profile }),
        projected: () => {},
        failed: (_, error) => errors.push(error)
      })
    let runtime = open()
    try {
      const content = [{ type: 'text', text: 'durable once' }]
      const receipt = await runtime.submit('desktop', content, { submissionId: 'stable-input' })
      await runtime.waitIdle('desktop')
      const identity = db.data.dimSessionBindingsTable.get('desktop')!.dimSessionId
      expect(db.data.deepchatMessagesTable.getBySession('desktop')).toHaveLength(2)
      await runtime.stop()
      db.sqlite.close()
      db = dimDatabase(path.join(profile, 'desktop.sqlite'))
      runtime = open()
      expect(await runtime.submit('desktop', content, { submissionId: 'stable-input' })).toEqual(
        receipt
      )
      await runtime.waitIdle('desktop')
      expect(db.data.dimSessionBindingsTable.get('desktop')!.dimSessionId).toBe(identity)
      expect(db.data.deepchatMessagesTable.getBySession('desktop')).toHaveLength(2)
      await expect(
        runtime.submit('desktop', [{ type: 'text', text: 'conflict' }], {
          submissionId: 'stable-input'
        })
      ).rejects.toThrow('already bound')
      await runtime.submit('desktop', [{ type: 'text', text: 'next turn' }])
      await runtime.waitIdle('desktop')
      expect(db.data.deepchatMessagesTable.getBySession('desktop')).toHaveLength(4)
      expect(errors).toEqual([])
    } finally {
      await runtime.stop()
      db.sqlite.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'boots the production profile with its injected plugins without an account login',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-product-'))
    const runtime = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      )
    })
    try {
      const client = await runtime.start()
      expect(await client.call('deepchat.host.capabilities')).toMatchObject({
        plugin: 'deepchat-host',
        apiVersion: 1
      })
      expect(await client.call('deepchat.storage.capabilities')).toMatchObject({
        plugin: 'deepchat-storage',
        apiVersion: 1
      })
    } finally {
      await runtime.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'projects live native messages and resumes the same cursor after reader and host restart',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-conversation-'))
    const runtime = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock'
    })
    let reader: DimSessionConnection | undefined
    try {
      let client = await runtime.start()
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile
      })
      let binding: DimSessionBinding = {
        sessionId: 'desktop-session',
        dimSessionId: sessionId,
        branchId: 'main',
        generation: 1,
        cursor: '0',
        nextOrderSeq: 1,
        activeTurnId: null,
        assistantMessageId: null,
        status: 'idle'
      }
      const messages = new Map<string, ChatMessageRecord>()
      const inputCache = new Map<string, import('@/agent/dim/sessionConnection').DimEvent>()
      const failures: unknown[] = []
      let failOnce = false
      const consume = (event: import('@/agent/dim/sessionConnection').DimEvent) => {
        if (failOnce && event.type === 'input' && event.name === 'message') {
          failOnce = false
          throw new Error('projection temporarily unavailable')
        }
        const projection = projectDimEvent(
          binding,
          event,
          (id) => messages.get(id) ?? null,
          (id) => inputCache.get(id) ?? null
        )
        for (const input of projection.inputEvents ?? []) inputCache.set(input.id, input)
        for (const id of projection.consumedInputs ?? []) inputCache.delete(id)
        for (const message of projection.messages) messages.set(message.id, message)
        binding = projection.binding
      }
      const openReader = async () => {
        reader = new DimSessionConnection(
          client,
          { sessionId, branchId: 'main' },
          consume,
          (error) => failures.push(error),
          binding.cursor
        )
        await reader.start()
        return reader
      }
      await openReader()
      await reader!.send('first turn')
      await reader!.waitIdle()
      expect([...messages.values()].map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(JSON.parse([...messages.values()][1].content)).toMatchObject([
        { type: 'content', content: 'Echo: first turn', status: 'success' }
      ])
      expect(binding.status).toBe('idle')
      await reader!.close()
      await runtime.stop()
      client = await runtime.start()
      await openReader()
      expect(messages.size).toBe(2)
      await reader!.send('second turn')
      await reader!.waitIdle()
      expect(messages.size).toBe(4)
      expect(failures).toEqual([])
      failOnce = true
      const submissionId = randomUUID()
      await reader!.send('third turn', { submissionId })
      await client.call('deepchat.host.idle', { sessionId, branchId: 'main' })
      await expect.poll(() => failures.length).toBe(1)
      expect(await reader!.lookup(submissionId)).toMatchObject({ status: 'accepted' })
      await reader!.close()
      await openReader()
      await reader!.waitIdle()
      expect(messages.size).toBe(6)
      expect(binding.status).toBe('idle')
    } finally {
      await reader?.close()
      await runtime.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)
