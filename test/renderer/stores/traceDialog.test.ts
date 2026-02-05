import { describe, it, expect } from 'vitest'
import { createTraceDialogStore } from '@/stores/traceDialog'

describe('createTraceDialogStore', () => {
  it('opens and closes trace dialog state', () => {
    const store = createTraceDialogStore()

    store.open('message-1', 'agent-1')
    expect(store.messageId.value).toBe('message-1')
    expect(store.agentId.value).toBe('agent-1')

    store.close()
    expect(store.messageId.value).toBeNull()
    expect(store.agentId.value).toBeNull()
  })
})
