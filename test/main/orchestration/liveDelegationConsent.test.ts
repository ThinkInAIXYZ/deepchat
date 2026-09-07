import { describe, expect, it } from 'vitest'
import {
  LiveDelegationConsentAuthority,
  type LiveDelegationConsentReceipt
} from '@/orchestration/liveDelegationConsent'

describe('LiveDelegationConsentAuthority', () => {
  it('binds one opaque receipt to one successful parent mutation', () => {
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
    const committed = authority.runAuthorizedMutation(
      receipt,
      { parentSessionId: 'parent-1', operation: 'spawn' },
      () => 'created'
    )
    expect(committed).toEqual({ authorized: true, value: 'created' })
    expect(
      authority.runAuthorizedMutation(
        receipt,
        { parentSessionId: 'parent-1', operation: 'spawn' },
        () => 'duplicate'
      )
    ).toEqual({ authorized: false })
    expect(
      authority.runAuthorizedMutation(
        {} as LiveDelegationConsentReceipt,
        { parentSessionId: 'parent-1', operation: 'spawn' },
        () => 'forged'
      )
    ).toEqual({ authorized: false })
  })

  it('releases a claimed receipt when the durable mutation fails', () => {
    const authority = new LiveDelegationConsentAuthority()
    const receipt = authority.issue({
      parentSessionId: 'parent-1',
      operation: 'spawn',
      executionId: 'tool-call-1'
    })
    const expectation = { parentSessionId: 'parent-1', operation: 'spawn' } as const

    expect(() =>
      authority.runAuthorizedMutation(receipt, expectation, () => {
        expect(authority.isValid(receipt, expectation)).toBe(false)
        throw new Error('database unavailable')
      })
    ).toThrow('database unavailable')
    expect(authority.isValid(receipt, expectation)).toBe(true)
    expect(authority.runAuthorizedMutation(receipt, expectation, () => 'created')).toEqual({
      authorized: true,
      value: 'created'
    })
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
