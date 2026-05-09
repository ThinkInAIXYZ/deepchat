import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { ToolCallImagePreview } from '@shared/types/core/mcp'
import {
  IMAGE_GENERATE_TOOL_NAME,
  IMAGE_GENERATION_TOOL_SERVER_NAME
} from '@shared/agentImageGenerationTool'

export function prepareToolImagePreviewPresentation(params: {
  toolName: string
  toolSource?: 'mcp' | 'agent'
  serverName?: string
  isError: boolean
  imagePreviews?: ToolCallImagePreview[]
}): {
  toolBlockImagePreviews?: ToolCallImagePreview[]
  promotedBlocks: AssistantMessageBlock[]
} {
  const { toolName, toolSource, serverName, isError, imagePreviews } = params
  if (!imagePreviews) {
    return { promotedBlocks: [] }
  }

  if (
    toolName !== IMAGE_GENERATE_TOOL_NAME ||
    toolSource !== 'agent' ||
    serverName !== IMAGE_GENERATION_TOOL_SERVER_NAME ||
    isError ||
    imagePreviews.length === 0
  ) {
    return {
      toolBlockImagePreviews: imagePreviews,
      promotedBlocks: []
    }
  }

  const timestamp = Date.now()
  const promotedBlocks: AssistantMessageBlock[] = []
  for (const preview of imagePreviews) {
    const { data, mimeType } = preview
    if (!data || !mimeType) {
      continue
    }

    promotedBlocks.push({
      type: 'image',
      content: '',
      status: 'success',
      timestamp,
      image_data: {
        data,
        mimeType
      }
    })
  }

  if (promotedBlocks.length === 0) {
    return {
      toolBlockImagePreviews: imagePreviews,
      promotedBlocks: []
    }
  }

  return {
    toolBlockImagePreviews: [],
    promotedBlocks
  }
}

export function insertBlocksAfterToolCall(
  blocks: AssistantMessageBlock[],
  toolCallId: string,
  newBlocks: AssistantMessageBlock[]
): void {
  if (newBlocks.length === 0) {
    return
  }

  const toolBlockIndex = blocks.findIndex(
    (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
  )
  if (toolBlockIndex === -1) {
    blocks.push(...newBlocks)
    return
  }

  blocks.splice(toolBlockIndex + 1, 0, ...newBlocks)
}
