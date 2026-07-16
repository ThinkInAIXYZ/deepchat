import { approximateTokenSize } from 'tokenx'
import type { ChatMessage } from '@shared/types/core/chat-message'

const IMAGE_TOKEN_ESTIMATE = 512
const AUDIO_TOKEN_ESTIMATE = 512

export function estimateMessageTokens(message: ChatMessage): number {
  if (typeof message.content === 'string') {
    return approximateTokenSize(message.content)
  }
  if (!Array.isArray(message.content)) {
    return 0
  }
  let total = 0
  for (const part of message.content) {
    if (part.type === 'text') {
      total += approximateTokenSize(part.text)
    } else if (part.type === 'image_url') {
      total += IMAGE_TOKEN_ESTIMATE
    } else if (part.type === 'input_audio') {
      total += part.input_audio.estimated_tokens ?? AUDIO_TOKEN_ESTIMATE
    }
  }
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      total += approximateTokenSize(toolCall.function.name)
      total += approximateTokenSize(toolCall.function.arguments)
    }
  }
  if (message.reasoning_content) {
    total += approximateTokenSize(message.reasoning_content)
  }
  return total
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
}
