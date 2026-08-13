import type { ChatMessage } from '@shared/types/core/chat-message'

interface ProviderProjectionEvidence {
  readonly identity: string
  readonly requiredText: string
}

const providerProjectionEvidence = new WeakMap<ChatMessage, readonly ProviderProjectionEvidence[]>()

function messageContainsText(message: ChatMessage, requiredText: string): boolean {
  if (typeof message.content === 'string') return message.content.includes(requiredText)
  if (!Array.isArray(message.content)) return false
  return message.content.some((part) => part.type === 'text' && part.text.includes(requiredText))
}

function assertProjectionContent(
  message: ChatMessage,
  evidence: readonly ProviderProjectionEvidence[]
): void {
  if (evidence.some(({ requiredText }) => !messageContainsText(message, requiredText))) {
    throw new Error('Provider projection clone removed its bound Skill context.')
  }
}

export function bindProviderProjectionIdentity(
  message: ChatMessage,
  identity: string,
  requiredText: string
): void {
  if (!identity || !requiredText) {
    throw new Error('Provider projection identity and content must be non-empty.')
  }
  const existing = providerProjectionEvidence.get(message) ?? []
  const matching = existing.find((item) => item.identity === identity)
  if (matching) {
    if (matching.requiredText !== requiredText) {
      throw new Error('Provider projection identity was rebound to conflicting content.')
    }
    return
  }
  const evidence = Object.freeze({ identity, requiredText })
  assertProjectionContent(message, [evidence])
  providerProjectionEvidence.set(message, Object.freeze([...existing, evidence]))
}

export function inheritProviderProjectionIdentities(
  source: ChatMessage,
  projection: ChatMessage
): ChatMessage {
  const evidence = providerProjectionEvidence.get(source)
  if (evidence) {
    assertProjectionContent(projection, evidence)
    providerProjectionEvidence.set(projection, evidence)
  }
  return projection
}

export function getProviderProjectionIdentities(message: ChatMessage): readonly string[] {
  return providerProjectionEvidence.get(message)?.map(({ identity }) => identity) ?? []
}
