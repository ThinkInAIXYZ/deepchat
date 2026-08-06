import { describe, expect, it } from 'vitest'
import { getLiveDelegationStatusPresentation } from '@/lib/liveDelegationPresentation'

describe('live delegation presentation', () => {
  it('falls back safely for a status from a newer projection schema', () => {
    expect(getLiveDelegationStatusPresentation('future_status' as never)).toMatchObject({
      labelKey: 'chat.toolCall.subagents.status.error',
      active: false,
      actionRequired: false
    })
  })
})
