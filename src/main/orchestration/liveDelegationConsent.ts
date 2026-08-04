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

export interface LiveDelegationConsentIssuer {
  issue(binding: LiveDelegationConsentBinding): LiveDelegationConsentReceipt
}

export interface LiveDelegationConsentVerifier {
  isValid(
    receipt: LiveDelegationConsentReceipt,
    expectation: LiveDelegationConsentExpectation
  ): boolean
  consume(
    receipt: LiveDelegationConsentReceipt,
    expectation: LiveDelegationConsentExpectation
  ): boolean
}

export class LiveDelegationConsentAuthority
  implements LiveDelegationConsentIssuer, LiveDelegationConsentVerifier
{
  private readonly bindings = new WeakMap<
    LiveDelegationConsentReceipt,
    LiveDelegationConsentBinding
  >()

  issue(binding: LiveDelegationConsentBinding): LiveDelegationConsentReceipt {
    const normalized = normalizeBinding(binding)
    const receipt = Object.freeze({ [RECEIPT_BRAND]: true }) as LiveDelegationConsentReceipt
    this.bindings.set(receipt, normalized)
    return receipt
  }

  isValid(
    receipt: LiveDelegationConsentReceipt,
    expectation: LiveDelegationConsentExpectation
  ): boolean {
    const binding = this.bindings.get(receipt)
    return Boolean(
      binding &&
      binding.parentSessionId === expectation.parentSessionId.trim() &&
      binding.operation === expectation.operation
    )
  }

  consume(
    receipt: LiveDelegationConsentReceipt,
    expectation: LiveDelegationConsentExpectation
  ): boolean {
    if (!this.isValid(receipt, expectation)) return false
    this.bindings.delete(receipt)
    return true
  }
}

function normalizeBinding(binding: LiveDelegationConsentBinding): LiveDelegationConsentBinding {
  const parentSessionId = binding.parentSessionId.trim()
  const executionId = binding.executionId.trim()
  if (!parentSessionId || !executionId) {
    throw new Error('Live delegation consent requires parent and execution identity.')
  }
  return { ...binding, parentSessionId, executionId }
}
