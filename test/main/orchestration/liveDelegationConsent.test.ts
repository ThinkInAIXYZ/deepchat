import { describe, expect, it } from 'vitest'
import {
  LiveDelegationConsentAuthority,
  type LiveDelegationConsentReceipt
} from '@/orchestration/liveDelegationConsent'

describe('LiveDelegationConsentAuthority', () => {
  it('binds one opaque receipt to one parent operation and consumes it once', () => {
    const authority = new LiveDelegationConsentAuthority()
    const receipt = authority.issue({
      parentSessionId: 'parent-1',
      operation: 'spawn',
      executionId: 'tool-call-1'
    })

    expect(authority.isValid(receipt, { parentSessionId: 'parent-2', operation: 'spawn' })).toBe(
      false
    )
    expect(
      authority.isValid(receipt, { parentSessionId: 'parent-1', operation: 'follow_up' })
    ).toBe(false)
    expect(authority.consume(receipt, { parentSessionId: 'parent-1', operation: 'spawn' })).toBe(
      true
    )
    expect(authority.consume(receipt, { parentSessionId: 'parent-1', operation: 'spawn' })).toBe(
      false
    )
    expect(
      authority.consume({} as LiveDelegationConsentReceipt, {
        parentSessionId: 'parent-1',
        operation: 'spawn'
      })
    ).toBe(false)
  })

  it('rejects receipts without stable parent or execution identity', () => {
    const authority = new LiveDelegationConsentAuthority()

    expect(() =>
      authority.issue({ parentSessionId: ' ', operation: 'spawn', executionId: 'call-1' })
    ).toThrow('requires parent and execution identity')
    expect(() =>
      authority.issue({ parentSessionId: 'parent-1', operation: 'spawn', executionId: ' ' })
    ).toThrow('requires parent and execution identity')
  })
})
