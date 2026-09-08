import { AssistantMessageBlockSchema } from '@shared/contracts/common'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import type {
  AssistantMessageBlock,
  ChatMessagePageResult,
  ChatMessageRecord
} from '@shared/types/agent-interface'

const RenderedAssistantBlocksSchema = AssistantMessageBlockSchema.array()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stripProviderReplayJson(block: unknown): unknown {
  if (!isRecord(block) || !isRecord(block.extra)) {
    return block
  }
  if (!Object.hasOwn(block.extra, 'providerReplayJson')) {
    return block
  }

  const { providerReplayJson: _providerReplayJson, ...visibleExtra } = block.extra
  return {
    ...block,
    extra: Object.keys(visibleExtra).length > 0 ? visibleExtra : undefined
  }
}

function projectBlocksForClient(blocks: readonly unknown[]): unknown[] {
  return blocks.map(stripProviderReplayJson)
}

export function cloneBlocksForRenderer(
  blocks: AssistantMessageBlock[]
): DeepchatEventPayload<'chat.stream.updated'>['blocks'] {
  const rendererBlocks = projectBlocksForClient(blocks)
  // Hot path (streaming flush every ~120ms): Zod's parse already builds a fresh
  // object tree, so the JSON round-trip is redundant for well-formed blocks.
  const direct = RenderedAssistantBlocksSchema.safeParse(rendererBlocks)
  if (direct.success) {
    return direct.data
  }
  // Blocks can carry undefined-valued keys (e.g. inside `extra`) that JSON encoding
  // normalizes away; only pay the round-trip in that rare case.
  return RenderedAssistantBlocksSchema.parse(JSON.parse(JSON.stringify(rendererBlocks)))
}

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
