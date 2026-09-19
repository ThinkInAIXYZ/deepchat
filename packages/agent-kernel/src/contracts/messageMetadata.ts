import type { MessageMetadata } from '@deepchat/shared/types/agent-interface'

/**
 * Parses persisted message metadata. Pure; lives in kernel contracts so runtime modules can read
 * message metadata without importing the host usage-stats module.
 */
export function parseMessageMetadata(raw: string | MessageMetadata): MessageMetadata {
  if (typeof raw !== 'string') {
    return raw ?? {}
  }

  try {
    const parsed = JSON.parse(raw) as MessageMetadata
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
