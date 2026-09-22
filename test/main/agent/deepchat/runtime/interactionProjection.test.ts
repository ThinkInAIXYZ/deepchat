import { describe, expect, it } from 'vitest'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { projectPendingInteraction } from '@shared/chat/pendingInteraction'
import { collectPendingInteractionEntries } from '@/agent/deepchat/runtime/interactionProjection'
import { collectPendingInteraction } from '@/remote/conversation/interaction'

const action = (overrides: Partial<AssistantMessageBlock> = {}): AssistantMessageBlock => ({
  type: 'action',
  action_type: 'question_request',
  status: 'pending',
  timestamp: 17,
  tool_call: { id: 'call-7', name: 'ask', params: '{"topic":"deploy"}' },
  ...overrides
})

describe('pending interaction contract', () => {
  it.each([
    ['question', {}, true],
    ['permission', { action_type: 'tool_call_permission' }, true],
    ['explicit user action', { extra: { needsUserAction: true } }, true],
    ['settled', { status: 'success' }, false],
    ['no user action', { extra: { needsUserAction: false } }, false],
    ['tool block', { type: 'tool_call' }, false],
    ['other action', { action_type: 'rate_limit' }, false],
    ['no tool', { tool_call: undefined }, false],
    ['empty identity', { tool_call: { id: '' } }, false]
  ] as Array<[string, Partial<AssistantMessageBlock>, boolean]>)(
    '%s has consistent shared, runtime and Remote eligibility',
    (_name, overrides, eligible) => {
      const block = action(overrides)
      const shared = projectPendingInteraction(block)
      const runtime = collectPendingInteractionEntries('message-3', [block])
      const remote = collectPendingInteraction('message-3', 19, [block])
      expect(shared !== null).toBe(eligible)
      expect(runtime).toHaveLength(eligible ? 1 : 0)
      expect(remote !== null).toBe(eligible)
      if (eligible) {
        const identity = { toolCallId: 'call-7', toolName: 'ask', toolArgs: '{"topic":"deploy"}' }
        expect(shared).toMatchObject(identity)
        expect(runtime[0].interaction).toMatchObject(identity)
        expect(remote).toMatchObject(identity)
      }
    }
  )

  it('preserves runtime origin/order and Remote selection/content fallback', () => {
    const blocks = [
      action({ status: 'success' }),
      action({
        content: 'Review this skill',
        extra: { skillDraftAction: 'confirm', skillDraftId: 'draft-9' }
      }),
      action({ action_type: 'tool_call_permission', extra: { providerId: 'acp' } })
    ]
    const entries = collectPendingInteractionEntries('message-3', blocks, 8)
    expect(entries).toMatchObject([
      { blockIndex: 1, interaction: { origin: 'skill-draft-confirmation', order: 8, question: { question: '' } } },
      { blockIndex: 2, interaction: { origin: 'acp-permission', order: 9 } }
    ])
    expect(collectPendingInteraction('message-3', 19, blocks)).toMatchObject({
      type: 'question',
      messageOrderSeq: 19,
      question: { question: 'Review this skill' }
    })
  })
})
