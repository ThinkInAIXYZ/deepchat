const RECEIPT_BRAND = Symbol('live-delegation-consent')

export type LiveDelegationStartOperation = 'spawn' | 'follow_up'

export type LiveDelegationConsentReceipt = Readonly<{
  [RECEIPT_BRAND]: true
}>

export interface LiveDelegationConsentBinding {
  parentSessionId: string
  operation: LiveDelegationStartOperation
  executionId: string
}

export interface LiveDelegationConsentExpectation {
  parentSessionId: string
  operation: LiveDelegationStartOperation
}

export type LiveDelegationAuthorizedMutation<T> =
  | { authorized: true; value: T }
  | { authorized: false }

export interface LiveDelegationConsentIssuer {
  issue(binding: LiveDelegationConsentBinding): LiveDelegationConsentReceipt
}

export interface LiveDelegationConsentVerifier {
  isValid(
    receipt: LiveDelegationConsentReceipt,
    expectation: LiveDelegationConsentExpectation
  ): boolean
  runAuthorizedMutation<T>(
    receipt: LiveDelegationConsentReceipt,
    expectation: LiveDelegationConsentExpectation,
    mutation: () => T
  ): LiveDelegationAuthorizedMutation<T>
}

interface LiveDelegationConsentState {
  binding: LiveDelegationConsentBinding
  claimed: boolean
}

export class LiveDelegationConsentAuthority
  implements LiveDelegationConsentIssuer, LiveDelegationConsentVerifier
{
  private readonly receiptStates = new WeakMap<
    LiveDelegationConsentReceipt,
    LiveDelegationConsentState
  >()

  issue(binding: LiveDelegationConsentBinding): LiveDelegationConsentReceipt {
    const normalized = normalizeBinding(binding)
    const receipt = Object.freeze({ [RECEIPT_BRAND]: true }) as LiveDelegationConsentReceipt
    this.receiptStates.set(receipt, { binding: normalized, claimed: false })
    return receipt
  }

  isValid(
    receipt: LiveDelegationConsentReceipt,
    expectation: LiveDelegationConsentExpectation
  ): boolean {
    const state = this.receiptStates.get(receipt)
    return Boolean(state && !state.claimed && matchesExpectation(state.binding, expectation))
  }

  runAuthorizedMutation<T>(
    receipt: LiveDelegationConsentReceipt,
    expectation: LiveDelegationConsentExpectation,
    mutation: () => T
  ): LiveDelegationAuthorizedMutation<T> {
    const state = this.receiptStates.get(receipt)
    if (!state || state.claimed || !matchesExpectation(state.binding, expectation)) {
      return { authorized: false }
    }

    state.claimed = true
    try {
      const value = mutation()
      this.receiptStates.delete(receipt)
      return { authorized: true, value }
    } catch (error) {
      state.claimed = false
      throw error
    }
  }
}

function matchesExpectation(
  binding: LiveDelegationConsentBinding,
  expectation: LiveDelegationConsentExpectation
): boolean {
  return (
    binding.parentSessionId === expectation.parentSessionId.trim() &&
    binding.operation === expectation.operation
  )
}

function normalizeBinding(binding: LiveDelegationConsentBinding): LiveDelegationConsentBinding {
  const parentSessionId = binding.parentSessionId.trim()
  const executionId = binding.executionId.trim()
  if (!parentSessionId || !executionId) {
    throw new Error('Live delegation consent requires parent and execution identity.')
  }
  return { ...binding, parentSessionId, executionId }
}
