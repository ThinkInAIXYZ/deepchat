import { approximateTokenSize } from 'tokenx'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ChatMessageRecord, AssistantMessageBlock } from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from './messageStore'

/**
 * Convert a ChatMessageRecord from the DB into one or more ChatMessages for the LLM.
 * An assistant record with tool_call blocks expands into:
 *   assistant message (with text + tool_calls) + tool result messages
 */
function recordToChatMessages(record: ChatMessageRecord): ChatMessage[] {
  if (record.role === 'user') {
    const parsed = JSON.parse(record.content) as { text: string }
    return [{ role: 'user', content: parsed.text }]
  }

  // Assistant: extract text content and tool calls
  const blocks = JSON.parse(record.content) as AssistantMessageBlock[]
  const text = blocks
    .filter((b) => b.type === 'content' || b.type === 'reasoning_content')
    .map((b) => b.content)
    .join('')

  const toolCallBlocks = blocks.filter((b) => b.type === 'tool_call' && b.tool_call)

  if (toolCallBlocks.length === 0) {
    return [{ role: 'assistant', content: text }]
  }

  // Build assistant message with tool_calls
  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: text || undefined,
    tool_calls: toolCallBlocks.map((b) => ({
      id: b.tool_call!.id,
      type: 'function' as const,
      function: { name: b.tool_call!.name, arguments: b.tool_call!.params }
    }))
  }

  const result: ChatMessage[] = [assistantMsg]

  // Append tool result messages
  for (const b of toolCallBlocks) {
    result.push({
      role: 'tool',
      tool_call_id: b.tool_call!.id,
      content: b.tool_call!.response || ''
    })
  }

  return result
}

/**
 * Truncate history messages to fit within the available token budget.
 * Drops oldest messages from the front until the total fits.
 * Tool result messages (role: 'tool') are dropped together with the
 * preceding assistant message that contains their tool_calls to avoid
 * orphaned tool results.
 */
export function truncateContext(history: ChatMessage[], availableTokens: number): ChatMessage[] {
  let total = 0
  for (const msg of history) {
    total += approximateTokenSize(typeof msg.content === 'string' ? msg.content : '')
  }

  if (total <= availableTokens) {
    return history
  }

  // Drop from the front (oldest) until we fit.
  // When dropping, skip past any tool result messages that follow an
  // assistant message with tool_calls so they're removed as a group.
  const result = [...history]
  while (result.length > 0 && total > availableTokens) {
    const removed = result.shift()!
    total -= approximateTokenSize(typeof removed.content === 'string' ? removed.content : '')

    // If we just removed an assistant message with tool_calls, also remove the
    // subsequent tool result messages that belong to it
    if (removed.role === 'assistant' && removed.tool_calls && removed.tool_calls.length > 0) {
      const toolCallIds = new Set(removed.tool_calls.map((tc) => tc.id))
      while (
        result.length > 0 &&
        result[0].role === 'tool' &&
        toolCallIds.has(result[0].tool_call_id!)
      ) {
        const toolMsg = result.shift()!
        total -= approximateTokenSize(typeof toolMsg.content === 'string' ? toolMsg.content : '')
      }
    }
  }

  // If the result starts with orphaned tool messages (shouldn't happen after
  // the above, but guard defensively), drop them
  while (result.length > 0 && result[0].role === 'tool') {
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

  // 2. Convert to ChatMessage format (tool_call records expand to multiple messages)
  const history: ChatMessage[] = sentMessages.flatMap(recordToChatMessages)

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
