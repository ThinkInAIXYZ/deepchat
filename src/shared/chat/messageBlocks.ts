import type { AssistantMessageBlock } from '@shared/chat'

export function finalizeAssistantMessageBlocks(blocks: AssistantMessageBlock[] | undefined): void {
  if (!blocks?.length) {
    return
  }

  const lastBlock = blocks[blocks.length - 1]

  if (!lastBlock) {
    return
  }

  if (lastBlock.type === 'action' && lastBlock.action_type === 'tool_call_permission') {
    return
  }

  if (lastBlock.type === 'tool_call' && lastBlock.status === 'loading') {
    return
  }

  if (lastBlock.status === 'loading') {
    lastBlock.status = 'success'
  }
}
