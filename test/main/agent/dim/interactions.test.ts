import { expect, it, vi } from 'vitest'
import type { SessionDatabase } from '@/session/data/database'
import { DimInteractions } from '@/agent/dim/interactions'
import { DimMethodError } from '@/agent/dim/pluginClient'
import type { DimSessionControls } from '@/agent/dim/sessionControls'
import { staleDimInteractionMessages } from '@shared/dimQuestions'

it('treats a native not-pending reply as stale only for the acknowledged question', async () => {
  const question = JSON.stringify([
    { id: '1', question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }
  ])
  const database = {
    dimSessionBindingsTable: {
      get: () => ({ dimSessionId: 'native', branchId: 'main' })
    },
    deepchatMessagesTable: {
      get: () => ({
        role: 'assistant',
        session_id: 'session',
        status: 'pending',
        metadata: JSON.stringify({ dim: { sessionId: 'native', branchId: 'main' } }),
        content: JSON.stringify(
          ['first', 'second'].map((id) => ({
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            tool_call: { id },
            extra: { dimRequestId: 'request', dimQuestions: question }
          }))
        )
      })
    }
  }
  const notPending = new DimMethodError(-32000, 'No ask_user call is waiting for this answer', {
    appError: 'question_not_pending'
  })
  const invalid = new DimMethodError(-32602, 'Invalid answer', { appError: 'invalid_params' })
  const controls = {
    call: vi
      .fn()
      .mockRejectedValueOnce(notPending)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(invalid)
      .mockRejectedValue(notPending)
  }
  const interactions = new DimInteractions(
    database as unknown as SessionDatabase,
    controls as unknown as DimSessionControls
  )
  const answer = (callId: string) =>
    interactions.respondToolInteraction('session', 'message', callId, {
      kind: 'question_option',
      optionLabel: 'Yes'
    })

  await expect(answer('first')).rejects.toBe(notPending)
  await expect(answer('first')).resolves.toEqual({ resumed: true })
  await expect(answer('second')).rejects.toBe(invalid)
  await expect(answer('second')).rejects.toBe(notPending)
  await expect(answer('first')).rejects.toThrow(staleDimInteractionMessages.noLongerPending)
})
