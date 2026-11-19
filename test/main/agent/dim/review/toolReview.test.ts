import { expect, it, vi } from 'vitest'
import { createDimToolReview } from '@/agent/dim/review/toolReview'
import type { ChatMessageRecord } from '@shared/types/agent-interface'

function record(role: 'user' | 'assistant', content: unknown, id: string): ChatMessageRecord {
  return {
    id,
    sessionId: 'desktop',
    orderSeq: 0,
    role,
    content: JSON.stringify(content),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    createdAt: 0,
    updatedAt: 0
  }
}

function reviewer(reply: string) {
  return {
    providerSettings: {} as never,
    agentSettings: { resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({}) },
    providerRuntime: {
      executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
      generateCompletionStandalone: vi.fn().mockResolvedValue(reply),
      runJudgment: vi.fn()
    },
    getSessionAgentId: () => 'deepchat'
  }
}

it('reviews the exact native call against the bound desktop transcript', async () => {
  const deps = reviewer('')
  deps.providerRuntime.generateCompletionStandalone.mockImplementation(async (...args) => {
    const prompt = JSON.parse(String(args[1][1].content).split('\n\n').at(-1)!)
    return JSON.stringify({
      actionHash: prompt.actionHash,
      decision: 'auto_allow',
      riskLevel: 'low'
    })
  })
  const assertCurrent = vi.fn()
  const review = createDimToolReview({
    reviewer: deps,
    owner: async () => ({ sessionId: 'desktop', providerId: 'p', modelId: 'm', assertCurrent }),
    messages: () => [
      record('user', { text: 'Write the notes file' }, 'u1'),
      record('assistant', [{ type: 'content', content: 'Writing it now', status: 'success' }], 'a1')
    ]
  })
  await expect(
    review(
      {
        sessionId: 'native',
        callId: 'call-1',
        toolName: 'write',
        arguments: { path: 'notes.txt', content: 'hi' },
        risk: 'write_filesystem'
      },
      new AbortController().signal
    )
  ).resolves.toBe('auto_allow')
  const prompt = JSON.parse(
    String(deps.providerRuntime.generateCompletionStandalone.mock.calls[0][1][1].content)
      .split('\n\n')
      .at(-1)!
  )
  expect(prompt.exactAction).toMatchObject({
    sessionId: 'desktop',
    toolCallId: 'call-1',
    toolName: 'write',
    permission: { permissionType: 'write', paths: ['notes.txt'] }
  })
  expect(prompt.recentMessages.map((message: { content: string }) => message.content)).toEqual([
    'Write the notes file',
    'Writing it now'
  ])
  expect(assertCurrent).toHaveBeenCalledTimes(2)
})

it('asks the user when the reviewer answer is unusable', async () => {
  const review = createDimToolReview({
    reviewer: reviewer('not json'),
    owner: async () => ({
      sessionId: 'desktop',
      providerId: 'p',
      modelId: 'm',
      assertCurrent: () => {}
    }),
    messages: () => []
  })
  await expect(
    review(
      {
        sessionId: 'native',
        callId: 'call-1',
        toolName: 'exec',
        arguments: { command: 'rm -rf build' },
        risk: 'execute_process'
      },
      new AbortController().signal
    )
  ).resolves.toBe('ask_user')
})
