import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { describeIfNativeSqlite } from '../../../nativeSqliteHarness'
import { MainDatabase } from '@/data/mainDatabase'
import { createSessionData } from '@/session/data'
import { AcpAgentInstance } from '@/agent/acp/instance'
import { AcpPromptController } from '@/agent/acp/client'
import { toAppSessionId, toAcpRemoteSessionId } from '@/agent/shared/agentSessionIds'
import {
  createAcpCompatibilityDependencies,
  type AcpCompatibilityHostDependencies
} from '@/agent/acp/compatibility/dependencies'
import { createDeepChatOutputProjection } from '@/session/outputProjection'
import { createSessionStatusProjection } from '@/session/sessionStatusProjection'
import { noopHookObserver } from '../../../hook/hookObserverFixture'

vi.unmock('fs')
vi.unmock('node:fs')

describeIfNativeSqlite('Direct ACP host assembly', () => {
  it('sends, cancels and restores durable history without a DeepChat loop or recovery pass', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'deepchat-acp-host-'))
    const connection = new MainDatabase(join(directory, 'agent.db'))
    const data = createSessionData(connection, undefined, {
      publishPendingInputsChanged: () => {},
      publishMessagesChanged: () => {}
    })
    const sessionId = toAppSessionId('acp-host')
    data.database.newSessionsTable.create(sessionId, 'fixture', 'ACP host', '/workspace', {
      sessionKind: 'subagent',
      parentSessionId: 'parent'
    })
    data.settings.create(sessionId, 'acp', 'fixture', 'default', {
      systemPrompt: 'Configured',
      contextLength: 8192,
      maxTokens: 2048,
      timeout: 5000
    })
    const recoverInputs = vi.spyOn(data.pendingInputs, 'recoverInputsAfterRestart')
    const recoverMessages = vi.spyOn(data.transcript, 'recoverPendingMessages')
    const publishEvent = vi.fn()
    const publishSessionUpdate = vi.fn()
    const sessionUiPort = { refreshSessionUi: vi.fn() }
    const output = createDeepChatOutputProjection({ publishEvent, publishSessionUpdate })
    const publishStatus = createSessionStatusProjection({
      publishEvent,
      publishSessionUpdate,
      sessionUiPort
    })
    const deps = {
      sessionStore: data.settings,
      messageStore: data.transcript,
      tape: data.tapeStore,
      output,
      publishStatus,
      hookObserver: noopHookObserver,
      promptSettings: { getDefaultSystemPrompt: async () => '' },
      providerSettings: {
        getModelConfig: () => ({
          contextLength: 8192,
          maxTokens: 2048,
          temperature: 0.7,
          timeout: 5000
        }),
        getCapabilitySnapshot: () => ({
          identity: {
            providerId: 'acp',
            requestModelId: 'fixture',
            catalogMatched: false,
            catalogModelId: null
          },
          mediaSettings: { image: false, video: false },
          reasoningPortrait: null,
          supportsReasoning: false,
          supportsAudioInput: false,
          thinkingBudgetRange: {},
          requestPolicy: {
            temperature: { mode: 'passthrough' },
            topP: { mode: 'passthrough' },
            reasoning: { mode: 'passthrough' },
            legacyThinking: { mode: 'passthrough' }
          },
          supportsTemperatureControl: true
        })
      },
      skillSettings: { isEnabled: () => false },
      skillService: { validateSkillNames: async () => [] },
      agentSettings: { getAgentType: async () => 'acp' },
      traceSettings: { isEnabled: () => false },
      providerRuntime: { executeWithRateLimit: async () => {} }
    } as unknown as AcpCompatibilityHostDependencies
    let hooks: { onEvents(events: unknown[]): void }
    let blockPrompt = false
    let releasePrompt = () => {}
    const prompt = vi.fn(async () => {
      hooks.onEvents([{ type: 'text', content: blockPrompt ? 'Partial' : 'ACP response' }])
      if (blockPrompt)
        await new Promise<void>((resolve) => {
          releasePrompt = resolve
        })
      return { stopReason: 'end_turn' }
    })
    const cancel = vi.fn(async () => releasePrompt())
    const remote = {
      sessionId: toAcpRemoteSessionId('remote-fixture'),
      connection: { prompt, cancel },
      detachHandlers: [],
      workdir: '/workspace',
      providerId: 'acp',
      agentId: 'fixture',
      conversationId: sessionId,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
      systemPromptSent: false
    }
    const sessions = {
      open: async (_id: string, _agent: unknown, nextHooks: typeof hooks) => {
        hooks = nextHooks
        return remote
      },
      getSession: () => remote,
      clearMappedSession: () => {},
      clear: async () => {}
    }
    const agent = { id: 'fixture', name: 'Fixture', command: 'fixture', source: 'manual' as const }
    const options = { sessionId, agent, workdir: '/workspace', scope: 'subagent' as const }
    const createInstance = () =>
      new AcpAgentInstance(options, {
        ...createAcpCompatibilityDependencies(deps, {
          runtime: {
            sessionPersistence: { startTurn: async () => {}, finishTurn: async () => {} },
            processManager: { appendDebugEvent: () => {} }
          } as never,
          session: { ...options, descriptor: { id: 'fixture' } as never }
        }),
        sessions: sessions as never,
        promptController: new AcpPromptController()
      })
    let instance = createInstance()
    try {
      expect(recoverInputs).not.toHaveBeenCalled()
      expect(recoverMessages).not.toHaveBeenCalled()
      await instance.send({ text: 'First turn' })
      expect((await instance.snapshot()).status).toBe('idle')
      expect(data.transcript.getMessages(sessionId).map((message) => message.role)).toEqual([
        'user',
        'assistant'
      ])
      expect(data.transcript.getMessages(sessionId)[1].content).toContain('ACP response')
      await instance.close()
      connection.reopen()
      instance = createInstance()
      await instance.send({ text: 'After reopen' })
      expect(data.transcript.getMessages(sessionId)).toHaveLength(4)
      blockPrompt = true
      const pending = instance.send({ text: 'Cancel this turn' })
      await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(3))
      await instance.cancel()
      await pending
      expect((await instance.snapshot()).status).toBe('idle')
      expect(cancel).toHaveBeenCalled()
      expect(data.transcript.getMessages(sessionId).at(-1)?.content).toContain('Partial')
      expect(recoverInputs).not.toHaveBeenCalled()
      expect(recoverMessages).not.toHaveBeenCalled()
      expect(publishEvent).toHaveBeenCalledWith(
        'sessions.status.changed',
        expect.objectContaining({ sessionId, status: 'idle' })
      )
    } finally {
      releasePrompt()
      await instance.close()
      connection.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
