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
import { DimProductGateway, type DimProductToolCall } from '@/agent/dim/productGateway'
import { DimModelBridge } from '@/agent/dim/modelBridge'
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
    const requests: Array<{ authorization?: string; body: Record<string, unknown> }> = []
    let nativeCancelled = false
    let holdQueue = false
    let heldQueueResponse: ServerResponse | null = null
    const fixture = createServer(async (req, res) => {
      let payload = ''
      for await (const data of req) payload += data
      const body = payload ? JSON.parse(payload) : {}
      requests.push({ authorization: req.headers.authorization, body })
      if (holdQueue) {
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
    let admittedProvider = ''
    let credentialValue = 'fixture-secret-only'
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'empty',
        tools: [],
        execute: async () => {
          throw new Error('No tools')
        }
      }),
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
            baseUrl: configuration.connection.baseUrl,
            enable: true
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
        nativeSettings = new DimSessionSettings({
          state,
          database: grants.data,
          profiles: new DimAgentProfiles(host),
          models: catalog,
          controls: new DimSessionControls(host),
          identity: async () => ({ name: 'Product fixture', description: '', cwd: profile }),
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
      await controls.call('set_permission', ref, {
        expectedVersion: String(policy.version),
        policy: { ...policy.policy, preset: 'workspace-write' }
      })
      expect(await controls.call('permission', ref)).toMatchObject({
        policy: { preset: 'workspace-write' }
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
          desktopEvents.filter((event) => event.name === 'chat.stream.completed')
        ).toHaveLength(1)
        expect(desktopEvents.some((event) => event.name === 'chat.stream.updated')).toBe(true)
        expect(
          desktopEvents
            .filter((event) => event.name === 'sessions.status.changed')
            .map((event) => (event.payload as { status: string }).status)
        ).toEqual(['idle', 'generating', 'idle'])
        expect(notifications).toBe(1)
        expect(JSON.stringify(requests[0].body)).toContain('Native product persona sentinel')
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
        expect(JSON.stringify(requests[0].body)).not.toContain(representation.text)
      }

      expect(
        await models.complete(
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
        expect(requests[0].body).toMatchObject({ temperature: 0.23, top_p: 0.71, max_tokens: 83 })
        expect(requests[1].body).toMatchObject({ temperature: 0.31, top_p: 0.68, max_tokens: 93 })
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
      expect(requests.filter((item) => item.body.messages)).toHaveLength(2)
      expect(requests.every((item) => item.authorization === 'Bearer fixture-secret-only')).toBe(
        true
      )
      if (nativePlugins) credentialValue = 'rotated-native-credential'
      const abort = new AbortController()
      const completion = models.complete(
        target,
        { messages: [{ role: 'user', content: 'hold native auxiliary' }] },
        abort.signal,
        nativePlugins ? {} : undefined
      )
      // Attach the rejection handler before cancelling so it cannot become an unhandled promise.
      const cancelled = expect(completion).rejects.toThrow()
      await expect.poll(() => requests.filter((item) => item.body.messages).length).toBe(3)
      abort.abort()
      await cancelled
      await expect.poll(() => nativeCancelled).toBe(true)
      await host.stop()
      if (nativePlugins) {
        const verifyNoPlaintextCredential = async (directory: string): Promise<void> => {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name)
            if (entry.isDirectory()) await verifyNoPlaintextCredential(filename)
            else if (entry.isFile())
              expect(
                (await readFile(filename)).includes(Buffer.from('fixture-secret-only')),
                filename
              ).toBe(false)
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
        const queue = new DimQueue({
          database: grants.data,
          host,
          runtime: new DimSessionRuntime({
            database: grants.data,
            host,
            launch: async () => {
              throw new Error('Reuse the existing binding')
            },
            projected: () => {},
            failed: () => {}
          }),
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
        const steered = await queue.steerPendingInput('product-ui', edited.id)
        expect(steered.mode).toBe('steer')
        const response = heldQueueResponse as unknown as ServerResponse
        response.end(
          `data: ${JSON.stringify({ id: 'held', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: 'queue held response' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
        )
        await current.call('deepchat.host.idle', ref)
        expect(await queue.listPendingInputs('product-ui')).toEqual([])
        await host.stop()
        const restored = await host.start()
        expect(await restored.call('session.deepchat_queue.mutate', { ...ref, plan })).toEqual(
          deleted
        )
        expect(await queue.listPendingInputs('product-ui')).toEqual([])
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
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'executes product tools inside dim and reloads their scoped catalog with cancellation',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-tools-'))
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
      profile: 'mock',
      gatewayAddress: await gateway.start()
    })
    try {
      const client = await host.start()
      const { agentId } = await client.call<{ agentId: string }>('agent.create', {
        profile: { name: 'DeepChat tools fixture', description: '', systemPrompt: '' }
      })
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        agent: agentId,
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
