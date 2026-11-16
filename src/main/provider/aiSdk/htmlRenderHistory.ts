import { HTML_RENDER_SECTION_TOOL_NAME, HTML_RENDER_TOOL_NAME } from '@shared/agentHtmlRenderTool'
import type { ChatMessage, ChatMessageToolCall } from '@shared/types/core/chat-message'
import { tryParseJson } from './toolProtocol'

function renderReceipt(
  call: ChatMessageToolCall,
  content: ChatMessage['content']
): ChatMessage['content'] {
  // HTML tools throw on failure; dispatch serializes those errors with this prefix.
  if (typeof content !== 'string' || !content.startsWith('Error:')) return content

  const args = tryParseJson(call.function.arguments)
  const fields = call.function.name === HTML_RENDER_TOOL_NAME ? ['title'] : ['panelId', 'sectionId']
  const target: string[] = []
  if (args && typeof args === 'object') {
    for (const field of fields) {
      const value = (args as Record<string, unknown>)[field]
      if (typeof value === 'string' && value) target.push(`${field}: ${value}`)
    }
  }
  if (target.length === 0) target.push(`toolCallId: ${call.id}`)

  return `${call.function.name} failed. ${target.join('; ')}\n${content}`
}

export function projectHtmlRenderHistory(messages: ChatMessage[]): ChatMessage[] {
  const projected = [...messages]
  const replacedResults = new Set<number>()
  const receiptsAfter = new Map<number, ChatMessage[]>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const toolCalls = message.role === 'assistant' ? message.tool_calls : undefined
    const htmlCalls = toolCalls?.filter(
      (call) =>
        call.function.name === HTML_RENDER_TOOL_NAME ||
        call.function.name === HTML_RENDER_SECTION_TOOL_NAME
    )
    if (!toolCalls || !htmlCalls?.length) continue

    // Provider replay can split one assistant round before its tool results.
    let resultStart = index + 1
    while (messages[resultStart]?.role === 'assistant') resultStart += 1
    let end = resultStart
    while (messages[end]?.role === 'tool') end += 1
    const resultsById = new Map(
      messages
        .slice(resultStart, end)
        .map((result, offset) => [
          result.tool_call_id,
          { message: result, index: resultStart + offset }
        ])
    )
    if (!toolCalls.every((call) => resultsById.has(call.id))) continue

    const receipts = receiptsAfter.get(end - 1) ?? []
    for (const call of htmlCalls) {
      const result = resultsById.get(call.id)!
      replacedResults.add(result.index)
      receipts.push({ role: 'user', content: renderReceipt(call, result.message.content) })
    }
    // Receipts follow the whole batch so they cannot interrupt other tools' call/result pairs.
    receiptsAfter.set(end - 1, receipts)
    const htmlCallIds = new Set(htmlCalls.map((call) => call.id))
    const remainingCalls = toolCalls.filter((call) => !htmlCallIds.has(call.id))
    const assistant = { ...message }
    if (remainingCalls.length > 0) {
      assistant.tool_calls = remainingCalls
    } else {
      delete assistant.tool_calls
    }
    projected[index] = assistant
  }

  if (replacedResults.size === 0) return messages
  return projected.flatMap((message, index) => [
    ...(replacedResults.has(index) ? [] : [message]),
    ...(receiptsAfter.get(index) ?? [])
  ])
}
