import { createDeepChatOutputProjection } from '@/session/outputProjection'
import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  MessageProjectionService,
  type MessageProjectionServiceDependencies
} from '@/agent/deepchat/runtime/messageProjectionService'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

const SESSION_ID = 'session'
const MESSAGE_ID = 'message'

function assistantMessage(content: string) {
  return { id: MESSAGE_ID, role: 'assistant' as const, content }
}

function createHarness(message: unknown = assistantMessage('[]')) {
  const order: string[] = []
  const runtime = new DeepChatAgentRuntime()
  const getMessage = vi.fn(() => {
    order.push('transcript.getMessage')
    return message as never
  })
  const publishEvent = vi.fn((name) => order.push(`event:${String(name)}`))
  const publishSessionUpdate = vi.fn(() => order.push('sessionUpdate'))
  const deps: MessageProjectionServiceDependencies = {
    registry: runtime,
    transcript: { getMessage, updateAssistantContent: vi.fn(() => order.push('transcript.write')) },
    output: createDeepChatOutputProjection({ publishEvent, publishSessionUpdate })
  } as unknown as MessageProjectionServiceDependencies

  return {
    deps,
    publishEvent,
    publishSessionUpdate,
    order,
    runtime,
    service: new MessageProjectionService(deps)
  }
}

describe('MessageProjectionService', () => {
  it('publishes stream completion, then reads the message, then publishes the session update', () => {
    const message = assistantMessage(
      JSON.stringify([
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          timestamp: 1,
          tool_call: { id: 'tool-1', name: 'fixture', params: '{}' },
          extra: { providerReplayJson: '{"private":"provider-state"}', needsUserAction: true }
        }
      ])
    )
    const { order, service, publishSessionUpdate } = createHarness(message)

    service.refresh(SESSION_ID, MESSAGE_ID)

    expect(order).toEqual(['event:chat.stream.completed', 'transcript.getMessage', 'sessionUpdate'])
    expect(publishSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        waitingInteraction: expect.objectContaining({ toolCallId: 'tool-1' })
      })
    )
    expect(JSON.stringify(publishSessionUpdate.mock.calls)).not.toContain('providerReplayJson')
    expect(message.content).toContain('providerReplayJson')
  })

  it('stops after stream completion for a missing or non-assistant message', () => {
    const missing = createHarness(null)
    missing.service.refresh(SESSION_ID, MESSAGE_ID)
    expect(missing.order).toEqual(['event:chat.stream.completed', 'transcript.getMessage'])

    const user = createHarness({ id: MESSAGE_ID, role: 'user', content: '{}' })
    user.service.refresh(SESSION_ID, MESSAGE_ID)
    expect(user.order).toEqual(['event:chat.stream.completed', 'transcript.getMessage'])
  })

  it('keeps stream completion published when assistant content cannot be parsed', () => {
    const { order, service } = createHarness(assistantMessage('not json'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    service.refresh(SESSION_ID, MESSAGE_ID)

    expect(order).toEqual(['event:chat.stream.completed', 'transcript.getMessage'])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('uses the active run id only for the message that run owns', () => {
    const { deps, publishEvent, runtime, service } = createHarness()
    const scope = runtime.getOrHydrateScope(toAppSessionId(SESSION_ID))
    scope.instance.registerActiveGeneration(
      createLoopRun({
        runId: 'run-1',
        sessionId: toAppSessionId(SESSION_ID),
        messageId: MESSAGE_ID,
        abortController: new AbortController(),
        messages: [],
        streamState: {},
        resources: {
          toolDefinitions: [],
          activeSkillNames: [],
          commandShell: POSIX_COMMAND_SHELL,
          toolMode: { mode: 'agent', source: 'fallback' }
        }
      })
    )

    service.refresh(SESSION_ID, MESSAGE_ID)
    service.refresh(SESSION_ID, 'other-message')

    expect(vi.mocked(publishEvent).mock.calls.map(([, payload]) => payload)).toMatchObject([
      { requestId: 'run-1', messageId: MESSAGE_ID },
      { requestId: 'other-message', messageId: 'other-message' }
    ])
  })

  it('persists subagent progress before refreshing the projection', () => {
    const { order, service } = createHarness(
      assistantMessage(
        JSON.stringify([
          {
            type: 'tool_call',
            status: 'loading',
            timestamp: 1,
            tool_call: { id: 'tc1', name: 'subagent', params: '{}', response: '' }
          }
        ])
      )
    )

    service.updateSubagentToolCallProgress(SESSION_ID, MESSAGE_ID, 'tc1', 'partial', '{"step":1}')

    expect(order).toEqual([
      'transcript.getMessage',
      'transcript.write',
      'event:chat.stream.completed',
      'transcript.getMessage',
      'sessionUpdate'
    ])
  })

  it('does not write or refresh when the tool call is absent', () => {
    const { order, service } = createHarness(assistantMessage('[]'))

    service.updateSubagentToolCallProgress(SESSION_ID, MESSAGE_ID, 'missing', 'partial')

    expect(order).toEqual(['transcript.getMessage'])
  })
})
