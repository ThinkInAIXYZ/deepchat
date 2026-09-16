import type { AssistantMessageBlock } from '../shared/types/agent-interface.js'

function shouldConvertPendingBlockToError(
  status: AssistantMessageBlock['status']
): status is 'pending' | 'loading' {
  return status === 'pending' || status === 'loading'
}

/**
 * Builds terminal error blocks for an interrupted assistant message. Pure; lives in kernel
 * contracts so runtime modules can finalize interrupted messages without importing the
 * SQLite-backed transcript module.
 */
export function buildTerminalErrorBlocks(
  blocks: AssistantMessageBlock[],
  errorMessage: string
): AssistantMessageBlock[] {
  const normalizedBlocks: AssistantMessageBlock[] = Array.isArray(blocks)
    ? blocks.map(
        (block): AssistantMessageBlock =>
          shouldConvertPendingBlockToError(block.status)
            ? { ...block, status: 'error' as const }
            : block
      )
    : []

  const lastBlock = normalizedBlocks[normalizedBlocks.length - 1]
  if (lastBlock?.type === 'error' && lastBlock.content === errorMessage) {
    return normalizedBlocks
  }

  normalizedBlocks.push({
    type: 'error',
    content: errorMessage,
    status: 'error',
    timestamp: Date.now()
  })

  return normalizedBlocks
}
