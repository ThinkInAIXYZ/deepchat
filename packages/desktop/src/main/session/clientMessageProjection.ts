import { projectBlocksForClient } from '@deepchat/agent-kernel/contracts/rendererBlocks'
import type {
  ChatMessagePageResult,
  ChatMessageRecord
} from '@deepchat/shared/types/agent-interface'

export { cloneBlocksForRenderer } from '@deepchat/agent-kernel/contracts/rendererBlocks'

function projectMessageRecordForClient(message: ChatMessageRecord): ChatMessageRecord {
  if (message.role !== 'assistant' || !message.content.includes('"providerReplayJson"')) {
    return message
  }

  try {
    const blocks: unknown = JSON.parse(message.content)
    if (!Array.isArray(blocks)) {
      throw new Error('Assistant content is not a block array.')
    }
    return {
      ...message,
      content: JSON.stringify(projectBlocksForClient(blocks))
    }
  } catch (error) {
    console.warn('[ClientMessageProjection] Redacted invalid assistant blocks:', error)
    return { ...message, content: '[]' }
  }
}

export function projectMessagePageForClient(page: ChatMessagePageResult): ChatMessagePageResult {
  return {
    ...page,
    messages: page.messages.map(projectMessageRecordForClient)
  }
}
