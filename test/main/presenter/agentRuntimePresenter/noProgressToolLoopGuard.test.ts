import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types/core/chat-message'
import {
  extractLatestCompletedToolBatch,
  NoProgressToolLoopGuard
} from '@/presenter/agentRuntimePresenter/noProgressToolLoopGuard'

function toolCall(id: string) {
  return { id, name: 'read', arguments: '{"path":"README.md"}' }
}

function toolMessage(id: string, content: string): ChatMessage {
  return { role: 'tool', tool_call_id: id, content }
}

describe('NoProgressToolLoopGuard', () => {
  it('ignores volatile timestamps and generated IDs in otherwise identical results', () => {
    const guard = new NoProgressToolLoopGuard()
    const first = guard.observe(
      [toolCall('call-1')],
      [
        toolMessage(
          'call-1',
          JSON.stringify({
            path: 'README.md',
            updatedAt: '2026-07-13T10:00:00.000Z',
            requestId: '3e9b1f2d-b83d-4c7c-9c39-5d3a35f0a920',
            toolCallId: 'call-1',
            content: 'unchanged'
          })
        )
      ]
    )
    const secondMessages = [
      toolMessage(
        'call-2',
        JSON.stringify({
          requestId: 'cbf1a435-68a5-4f30-bbf8-42ec2c0ce6fe',
          toolCallId: 'call-2',
          content: 'unchanged',
          updatedAt: '2026-07-13T10:01:00.000Z',
          path: 'README.md'
        })
      )
    ]
    const second = guard.observe([toolCall('call-2')], secondMessages)

    expect(first.repeatedBatchCount).toBe(1)
    expect(second.repeatedBatchCount).toBe(2)
    expect(second.correctionAppended).toBe(true)
    expect(secondMessages[0].content).toContain('agent_no_progress')
  })

  it('preserves UUIDs in semantic result fields as progress', () => {
    const guard = new NoProgressToolLoopGuard()
    const first = guard.observe(
      [toolCall('call-1')],
      [
        toolMessage(
          'call-1',
          JSON.stringify({
            recordId: '3e9b1f2d-b83d-4c7c-9c39-5d3a35f0a920',
            status: 'created'
          })
        )
      ]
    )
    const second = guard.observe(
      [toolCall('call-2')],
      [
        toolMessage(
          'call-2',
          JSON.stringify({
            recordId: 'cbf1a435-68a5-4f30-bbf8-42ec2c0ce6fe',
            status: 'created'
          })
        )
      ]
    )

    expect(first.snapshot.fingerprint).not.toBe(second.snapshot.fingerprint)
    expect(second).toMatchObject({ repeatedBatchCount: 1, correctionAppended: false })
  })

  it('normalizes timestamps and generated IDs in unstructured result text', () => {
    const guard = new NoProgressToolLoopGuard()
    guard.observe(
      [toolCall('call-1')],
      [
        toolMessage(
          'call-1',
          'unchanged\nrequest 3e9b1f2d-b83d-4c7c-9c39-5d3a35f0a920\nfinished 2026-07-13T10:00:00.000Z'
        )
      ]
    )
    const secondMessages = [
      toolMessage(
        'call-2',
        'unchanged\nrequest cbf1a435-68a5-4f30-bbf8-42ec2c0ce6fe\nfinished 2026-07-13T10:01:00.000Z'
      )
    ]
    const second = guard.observe([toolCall('call-2')], secondMessages)

    expect(second).toMatchObject({ repeatedBatchCount: 2, correctionAppended: true })
  })

  it('corrects but does not hard-stop repeated acknowledgement-only results', () => {
    const guard = new NoProgressToolLoopGuard()
    const observations = Array.from({ length: 6 }, (_, index) =>
      guard.observe([toolCall(`call-${index}`)], [toolMessage(`call-${index}`, 'ok')])
    )

    expect(observations[1]).toMatchObject({
      repeatedBatchCount: 2,
      correctionAppended: true,
      shouldTerminate: false,
      snapshot: { evidence: 'weak' }
    })
    expect(observations.at(-1)).toMatchObject({
      repeatedBatchCount: 6,
      shouldTerminate: false,
      snapshot: { evidence: 'weak' }
    })
  })

  it('restores a persisted streak and observes the completed batch after a pause', () => {
    const initialGuard = new NoProgressToolLoopGuard()
    const initial = initialGuard.observe(
      [toolCall('call-1')],
      [toolMessage('call-1', 'stable file contents')]
    )
    const resumeMessages: ChatMessage[] = [
      { role: 'user', content: 'Inspect README.md' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-2',
            type: 'function',
            function: { name: 'read', arguments: '{"path":"README.md"}' }
          }
        ]
      },
      toolMessage('call-2', 'stable file contents')
    ]
    const resumedBatch = extractLatestCompletedToolBatch(resumeMessages)
    const resumedGuard = new NoProgressToolLoopGuard(initial.snapshot)
    const resumed = resumedGuard.observe(
      resumedBatch?.toolCalls ?? [],
      resumedBatch?.batchMessages ?? []
    )

    expect(resumedBatch?.toolCalls).toHaveLength(1)
    expect(resumed).toMatchObject({ repeatedBatchCount: 2, correctionAppended: true })
  })
})
