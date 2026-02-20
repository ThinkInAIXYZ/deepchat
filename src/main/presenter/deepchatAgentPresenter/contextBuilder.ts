import { approximateTokenSize } from 'tokenx'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ChatMessageRecord, AssistantMessageBlock } from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from './messageStore'

/**
 * Convert a ChatMessageRecord from the DB into a ChatMessage for the LLM.
 */
function recordToChatMessage(record: ChatMessageRecord): ChatMessage {
  if (record.role === 'user') {
    const parsed = JSON.parse(record.content) as { text: string }
    return { role: 'user', content: parsed.text }
  }

  // Assistant: concatenate text from content and reasoning_content blocks
  const blocks = JSON.parse(record.content) as AssistantMessageBlock[]
  const text = blocks
    .filter((b) => b.type === 'content' || b.type === 'reasoning_content')
    .map((b) => b.content)
    .join('')

  return { role: 'assistant', content: text }
}

/**
 * Truncate history messages to fit within the available token budget.
 * Drops oldest messages from the front until the total fits.
 */
export function truncateContext(history: ChatMessage[], availableTokens: number): ChatMessage[] {
  let total = 0
  for (const msg of history) {
    total += approximateTokenSize(typeof msg.content === 'string' ? msg.content : '')
  }

  if (total <= availableTokens) {
    return history
  }

  // Drop from the front (oldest) until we fit
  const result = [...history]
  while (result.length > 0 && total > availableTokens) {
    const removed = result.shift()!
    total -= approximateTokenSize(typeof removed.content === 'string' ? removed.content : '')
  }

  return result
}

/**
 * Build the full ChatMessage[] array for an LLM call, including:
 * - System prompt (if non-empty)
 * - Conversation history (truncated to fit context window)
 * - The new user message
 */
export function buildContext(
  sessionId: string,
  newUserContent: string,
  systemPrompt: string,
  contextLength: number,
  maxTokens: number,
  messageStore: DeepChatMessageStore
): ChatMessage[] {
  // 1. Fetch all sent messages (excludes pending/error)
  const allMessages = messageStore.getMessages(sessionId)
  const sentMessages = allMessages.filter((m) => m.status === 'sent')

  // 2. Convert to ChatMessage format
  const history: ChatMessage[] = sentMessages.map(recordToChatMessage)

  // 3. Calculate available token budget
  const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt) : 0
  const newUserTokens = approximateTokenSize(newUserContent)
  const available = contextLength - systemPromptTokens - newUserTokens - maxTokens

  // 4. Truncate history to fit
  const truncatedHistory = available > 0 ? truncateContext(history, available) : []

  // 5. Assemble final messages
  const messages: ChatMessage[] = []

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }

  messages.push(...truncatedHistory)
  messages.push({ role: 'user', content: newUserContent })

  return messages
}
