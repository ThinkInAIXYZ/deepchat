import type { AssistantMessageBlock, Message } from '@shared/chat'

/**
 * Deep clone a message with its content blocks
 * Uses shallow cloning with selective deep copy for complex blocks
 */
export function cloneMessageWithContent(message: Message): Message {
  const cloned: Message = { ...message }

  if (Array.isArray(message.content)) {
    cloned.content = message.content.map((block) => {
      const clonedBlock: AssistantMessageBlock = { ...(block as AssistantMessageBlock) }
      if (block.type === 'tool_call' && block.tool_call) {
        clonedBlock.tool_call = { ...block.tool_call }
      }
      return clonedBlock
    })
  } else if (message.content && typeof message.content === 'object') {
    // Use structuredClone for better performance than JSON.parse/stringify
    cloned.content = structuredClone(message.content)
  } else {
    cloned.content = message.content
  }

  return cloned
}
