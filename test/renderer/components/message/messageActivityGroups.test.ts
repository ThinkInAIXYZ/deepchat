import { describe, expect, it } from 'vitest'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'
import {
  type ActivityDurationLabels,
  buildAssistantRenderItems,
  formatActivityDuration
} from '@/components/message/messageActivityGroups'

const createBlock = (
  type: DisplayAssistantMessageBlock['type'],
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type,
  status: 'success',
  timestamp: 1_000,
  ...overrides
})

const zhDurationLabels: ActivityDurationLabels = {
  day: '天',
  hour: '小时',
  minute: '分钟',
  second: '秒'
}

const enDurationLabels: ActivityDurationLabels = {
  day: 'd ',
  hour: 'h ',
  minute: 'm ',
  second: 's'
}

describe('messageActivityGroups', () => {
  it('groups consecutive completed reasoning and tool-call blocks', () => {
    const items = buildAssistantRenderItems({
      messageId: 'm1',
      messageUpdatedAt: 70_000,
      shouldGroup: true,
      blocks: [
        createBlock('reasoning_content', { content: 'thinking', timestamp: 10_000 }),
        createBlock('tool_call', {
          timestamp: 20_000,
          tool_call: {
            id: 'tc1',
            name: 'read_file'
          }
        })
      ]
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'activity-group',
      startedAt: 10_000,
      endedAt: 70_000,
      durationMs: 60_000,
      reasoningCount: 1,
      toolCallCount: 1
    })
  })

  it('splits activity groups around visible content blocks', () => {
    const items = buildAssistantRenderItems({
      messageId: 'm1',
      messageUpdatedAt: 12_000,
      shouldGroup: true,
      blocks: [
        createBlock('reasoning_content', { content: 'first' }),
        createBlock('content', { content: 'answer' }),
        createBlock('tool_call', {
          tool_call: {
            id: 'tc1',
            name: 'shell'
          }
        })
      ]
    })

    expect(items.map((item) => item.kind)).toEqual(['activity-group', 'block', 'activity-group'])
  })

  it('ignores empty reasoning signature blocks when merging continuous activity', () => {
    const items = buildAssistantRenderItems({
      messageId: 'm1',
      messageUpdatedAt: 12_000,
      shouldGroup: true,
      blocks: [
        createBlock('reasoning_content', {
          content: 'The user wants to see files.',
          timestamp: 1_000
        }),
        createBlock('reasoning_content', {
          content: '',
          timestamp: 1_100,
          extra: {
            providerOptionsJson: '{"anthropic":{"signature":"sig-1"}}'
          }
        }),
        createBlock('tool_call', {
          timestamp: 2_000,
          tool_call: {
            id: 'tc1',
            name: 'exec'
          }
        }),
        createBlock('reasoning_content', {
          content: 'The working directory does not exist.',
          timestamp: 3_000
        }),
        createBlock('reasoning_content', {
          content: '',
          timestamp: 3_100,
          extra: {
            providerOptionsJson: '{"anthropic":{"signature":"sig-2"}}'
          }
        }),
        createBlock('tool_call', {
          timestamp: 4_000,
          tool_call: {
            id: 'tc2',
            name: 'exec'
          }
        }),
        createBlock('reasoning_content', {
          content: 'I should ask the user to confirm the workspace.',
          timestamp: 5_000
        }),
        createBlock('reasoning_content', {
          content: '',
          timestamp: 5_100,
          extra: {
            providerOptionsJson: '{"anthropic":{"signature":"sig-3"}}'
          }
        }),
        createBlock('content', {
          content: 'Please confirm the folder.',
          timestamp: 6_000
        })
      ]
    })

    expect(items.map((item) => item.kind)).toEqual(['activity-group', 'block'])

    const groups = items.filter((item) => item.kind === 'activity-group')
    expect(groups).toHaveLength(1)
    expect(groups.map((item) => item.blocks.map((block) => block.type))).toEqual([
      ['reasoning_content', 'tool_call', 'reasoning_content', 'tool_call', 'reasoning_content']
    ])
    expect(
      groups.map((item) => item.blocks.map((block) => block.tool_call?.id ?? block.content))
    ).toEqual([
      [
        'The user wants to see files.',
        'tc1',
        'The working directory does not exist.',
        'tc2',
        'I should ask the user to confirm the workspace.'
      ]
    ])
    expect(groups[0]).toMatchObject({
      reasoningCount: 3,
      toolCallCount: 2
    })
  })

  it('does not group when the turn is not settled', () => {
    const items = buildAssistantRenderItems({
      messageId: 'm1',
      messageUpdatedAt: 12_000,
      shouldGroup: false,
      blocks: [
        createBlock('reasoning_content', { content: 'thinking' }),
        createBlock('tool_call', {
          tool_call: {
            id: 'tc1',
            name: 'shell'
          }
        })
      ]
    })

    expect(items.map((item) => item.kind)).toEqual(['block', 'block'])
  })

  it('does not group pending or loading activity blocks', () => {
    const items = buildAssistantRenderItems({
      messageId: 'm1',
      messageUpdatedAt: 12_000,
      shouldGroup: true,
      blocks: [
        createBlock('reasoning_content', { content: 'thinking', status: 'loading' }),
        createBlock('tool_call', {
          status: 'pending',
          tool_call: {
            id: 'tc1',
            name: 'shell'
          }
        })
      ]
    })

    expect(items.map((item) => item.kind)).toEqual(['block', 'block'])
  })

  it('skips internal hidden tool calls', () => {
    const items = buildAssistantRenderItems({
      messageId: 'm1',
      messageUpdatedAt: 12_000,
      shouldGroup: true,
      isInternalToolCall: (block) =>
        block.tool_call?.name === 'update_plan' && block.extra?.internalTool === true,
      blocks: [
        createBlock('tool_call', {
          extra: {
            internalTool: true
          },
          tool_call: {
            id: 'tc1',
            name: 'update_plan'
          }
        }),
        createBlock('content', { content: 'visible' })
      ]
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'block',
      block: {
        type: 'content'
      }
    })
  })

  it('formats duration up to days, hours, minutes, and seconds', () => {
    expect(formatActivityDuration(8_900, zhDurationLabels)).toBe('8秒')
    expect(formatActivityDuration(192_000, zhDurationLabels)).toBe('3分钟12秒')
    expect(formatActivityDuration(7_449_000, zhDurationLabels)).toBe('2小时4分钟9秒')
    expect(formatActivityDuration(97_802_000, zhDurationLabels)).toBe('1天3小时10分钟2秒')

    expect(formatActivityDuration(192_000, enDurationLabels)).toBe('3m 12s')
  })
})
