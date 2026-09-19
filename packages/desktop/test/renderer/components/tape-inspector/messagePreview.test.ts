import { describe, expect, it } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import {
  projectTapeInspectorAssistantActivities,
  projectTapeInspectorMessagePreview,
  selectTapeInspectorRequestContext,
  selectTapeInspectorRequestObservation,
  selectTapeInspectorRequestRowActivity
} from '@/components/tape-inspector/messagePreview'

function message(
  role: ChatMessageRecord['role'],
  content: unknown,
  overrides: Partial<ChatMessageRecord> = {}
): ChatMessageRecord {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    orderSeq: 1,
    role,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  }
}

describe('Tape Inspector message preview', () => {
  it('projects the same visible text represented by a user message', () => {
    const preview = projectTapeInspectorMessagePreview(
      message('user', {
        text: 'Forecast ',
        inlineItems: [{ type: 'file', offset: 9, fileName: 'sales.csv', filePath: '/sales.csv' }]
      })
    )

    expect(preview).toEqual({ role: 'user', text: 'Forecast sales.csv' })
  })

  it('includes assistant content while excluding reasoning, errors, and tool payloads', () => {
    const preview = projectTapeInspectorMessagePreview(
      message('assistant', [
        {
          type: 'reasoning_content',
          status: 'success',
          timestamp: 1,
          content: 'private reasoning'
        },
        { type: 'content', status: 'success', timestamp: 2, content: 'Visible answer' },
        { type: 'error', status: 'error', timestamp: 3, content: 'provider token abc' },
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 4,
          tool_call: { name: 'query', params: '{"secret":true}', response: 'secret result' }
        }
      ])
    )

    expect(preview).toEqual({ role: 'assistant', text: 'Visible answer' })
  })

  it('fails closed for malformed or non-visible content', () => {
    expect(projectTapeInspectorMessagePreview(message('user', '{broken'))).toBeNull()
    expect(
      projectTapeInspectorMessagePreview(
        message('assistant', [
          { type: 'reasoning_content', status: 'success', timestamp: 1, content: 'hidden' }
        ])
      )
    ).toBeNull()
  })

  it('compacts and bounds long previews without splitting a surrogate pair', () => {
    const preview = projectTapeInspectorMessagePreview(
      message('user', { text: `${'word '.repeat(43)}😀${' tail'.repeat(100)}` })
    )

    expect(preview?.text.length).toBeLessThanOrEqual(221)
    expect(preview?.text.endsWith('…')).toBe(true)
    expect(preview?.text).not.toContain('\uFFFD')
    expect(preview?.text).not.toMatch(/[\uD800-\uDBFF]…$/u)
  })

  it('selects the latest visible block before a model request instead of the final message', () => {
    const assistant = message('assistant', [
      { type: 'content', status: 'success', timestamp: 150, content: 'First answer' },
      {
        id: 'tool-1',
        type: 'tool_call',
        status: 'success',
        timestamp: 250,
        tool_call: { server_name: 'files', name: 'read_file', response: 'private result' }
      },
      { type: 'reasoning_content', status: 'success', timestamp: 275, content: 'private' },
      { type: 'content', status: 'success', timestamp: 300, content: 'Ambiguous same tick' },
      { type: 'content', status: 'success', timestamp: 350, content: 'Final answer' }
    ])

    const context = selectTapeInspectorRequestContext({
      activities: projectTapeInspectorAssistantActivities(assistant),
      before: 300
    })

    expect(context.map(({ kind, preview }) => ({ kind, preview }))).toEqual([
      { kind: 'tool', preview: 'files / read_file' },
      { kind: 'assistant', preview: 'First answer' }
    ])
    expect(context.map((activity) => activity.preview)).not.toContain('Final answer')
    expect(context.map((activity) => activity.preview)).not.toContain('Ambiguous same tick')
    expect(context.map((activity) => activity.text)).not.toContain('private result')
  })

  it('uses the preceding user message when no assistant block predates the request', () => {
    const assistant = message(
      'assistant',
      [{ type: 'content', status: 'success', timestamp: 350, content: 'Later answer' }],
      { id: 'assistant-1', orderSeq: 2 }
    )
    const user = message('user', { text: 'Start this task' }, { id: 'user-1', orderSeq: 1 })

    expect(
      selectTapeInspectorRequestContext({
        activities: projectTapeInspectorAssistantActivities(assistant),
        before: 300,
        precedingUser: user
      })
    ).toMatchObject([{ kind: 'user', preview: 'Start this task' }])
    expect(
      selectTapeInspectorRequestContext({
        activities: [],
        before: 300,
        precedingUser: { ...user, createdAt: 300 }
      })
    ).toEqual([])
  })

  it('selects final accumulated blocks by exact request and attempt identity', () => {
    const assistant = message('assistant', [
      {
        type: 'content',
        status: 'success',
        timestamp: 200,
        content: 'Earlier attempt',
        extra: { providerLogicalRound: 1, providerRequestSeq: 2, providerPhysicalAttempt: 1 }
      },
      {
        type: 'reasoning_content',
        status: 'success',
        timestamp: 300,
        content: 'Final attempt reasoning',
        extra: { providerLogicalRound: 1, providerRequestSeq: 2, providerPhysicalAttempt: 2 }
      },
      {
        type: 'content',
        status: 'success',
        timestamp: 310,
        content: 'Final answer',
        extra: { providerLogicalRound: 1, providerRequestSeq: 2, providerPhysicalAttempt: 2 }
      },
      {
        type: 'content',
        status: 'success',
        timestamp: 320,
        content: 'Different logical round',
        extra: { providerLogicalRound: 2, providerRequestSeq: 2, providerPhysicalAttempt: 2 }
      }
    ])

    const observation = selectTapeInspectorRequestObservation({
      activities: projectTapeInspectorAssistantActivities(assistant),
      createdAt: 250,
      requestSeq: 2,
      logicalRound: 1,
      physicalAttempt: 2
    })

    expect(observation.afterBasis).toBe('identity')
    expect(observation.after.map((activity) => activity.text)).toEqual([
      'Final answer',
      'Final attempt reasoning'
    ])
    expect(selectTapeInspectorRequestRowActivity(observation)).toMatchObject({
      relation: 'output',
      activity: { text: 'Final answer' }
    })
  })

  it('does not coalesce an unattributed or zero attempt into a real attempt', () => {
    const assistant = message('assistant', [
      {
        type: 'content',
        status: 'success',
        timestamp: 310,
        content: 'Attempt one',
        extra: { providerRequestSeq: 2, providerPhysicalAttempt: 1 }
      },
      {
        type: 'content',
        status: 'success',
        timestamp: 320,
        content: 'Unattributed legacy block',
        extra: { providerRequestSeq: 2, providerPhysicalAttempt: 0 }
      }
    ])
    const activities = projectTapeInspectorAssistantActivities(assistant)

    expect(activities[1].providerPhysicalAttempt).toBeUndefined()
    expect(
      selectTapeInspectorRequestObservation({
        activities,
        createdAt: 300,
        requestSeq: 2,
        physicalAttempt: 0
      }).afterBasis
    ).toBe('chronological')
  })

  it('labels bounded legacy activity as chronological rather than request output', () => {
    const assistant = message('assistant', [
      { type: 'content', status: 'success', timestamp: 310, content: 'First later block' },
      { type: 'content', status: 'success', timestamp: 390, content: 'Latest later block' },
      { type: 'content', status: 'success', timestamp: 410, content: 'Next request block' }
    ])

    const observation = selectTapeInspectorRequestObservation({
      activities: projectTapeInspectorAssistantActivities(assistant),
      createdAt: 300,
      requestSeq: 2,
      nextTraceCreatedAt: 400
    })

    expect(observation.afterBasis).toBe('chronological')
    expect(observation.after.map((activity) => activity.text)).toEqual([
      'Latest later block',
      'First later block'
    ])
    expect(selectTapeInspectorRequestRowActivity(observation)).toMatchObject({
      relation: 'later',
      activity: { text: 'Latest later block' }
    })
  })

  it('projects generated reasoning, tool arguments, errors, and media without tool results', () => {
    const assistant = message('assistant', [
      {
        type: 'reasoning_content',
        status: 'success',
        timestamp: 100,
        content: 'Inspect the data'
      },
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 110,
        tool_call: {
          server_name: 'files',
          name: 'read_file',
          params: '{"path":"sales.csv"}',
          response: 'large private tool result'
        }
      },
      { type: 'error', status: 'error', timestamp: 120, content: 'Provider failed' },
      { type: 'image', status: 'success', timestamp: 130, image_data: {} }
    ])

    const activities = projectTapeInspectorAssistantActivities(assistant)

    expect(activities.map((activity) => activity.kind)).toEqual([
      'reasoning',
      'tool',
      'error',
      'media'
    ])
    expect(activities[1].text).toBe('files / read_file\n{"path":"sales.csv"}')
    expect(activities[1].text).not.toContain('large private tool result')
    expect(
      selectTapeInspectorRequestRowActivity({
        before: [],
        after: [activities[1]],
        afterBasis: 'identity',
        afterTruncated: false
      })?.activity.preview
    ).toBe('files / read_file')
  })

  it('bounds detailed activity text without splitting a surrogate pair', () => {
    const assistant = message('assistant', [
      {
        type: 'content',
        status: 'success',
        timestamp: 100,
        content: `${'a'.repeat(32_767)}😀tail`
      }
    ])

    const [activity] = projectTapeInspectorAssistantActivities(assistant)

    expect(activity.text.length).toBe(32_767)
    expect(activity.truncated).toBe(true)
    expect(activity.text).not.toMatch(/[\uD800-\uDBFF]$/u)
  })

  it('reports when a request has more result blocks than the detail bound', () => {
    const assistant = message(
      'assistant',
      Array.from({ length: 13 }, (_, index) => ({
        type: 'content',
        status: 'success',
        timestamp: 100 + index,
        content: `Block ${index}`,
        extra: { providerRequestSeq: 2, providerPhysicalAttempt: 1 }
      }))
    )

    const observation = selectTapeInspectorRequestObservation({
      activities: projectTapeInspectorAssistantActivities(assistant),
      createdAt: 90,
      requestSeq: 2,
      physicalAttempt: 1
    })

    expect(observation.after).toHaveLength(12)
    expect(observation.afterTruncated).toBe(true)
    expect(observation.after[0].text).toBe('Block 12')
  })
})
