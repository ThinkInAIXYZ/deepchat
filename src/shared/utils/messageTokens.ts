import { estimateTokenCount } from 'tokenx'
import type { ChatMessage } from '@shared/types/core/chat-message'

const IMAGE_TOKEN_ESTIMATE = 512
const AUDIO_TOKEN_ESTIMATE = 512

export function estimateMessageTokens(message: ChatMessage): number {
  let total = message.provider_replay ? estimateTokenCount(message.provider_replay.payload) : 0
  if (typeof message.content === 'string') {
    total += estimateTokenCount(message.content)
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') {
        total += estimateTokenCount(part.text)
      } else if (part.type === 'image_url') {
        total += IMAGE_TOKEN_ESTIMATE
      } else if (part.type === 'input_audio') {
        total += part.input_audio.estimated_tokens ?? AUDIO_TOKEN_ESTIMATE
      }
    }
  }
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      total += estimateTokenCount(toolCall.function.name)
      total += estimateTokenCount(toolCall.function.arguments)
    }
  }
  if (message.reasoning_content) {
    total += estimateTokenCount(message.reasoning_content)
  }
  return total
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
}
