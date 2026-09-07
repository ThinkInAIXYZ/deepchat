import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { ChatMessageProviderReplay } from '@shared/types/core/chat-message'

export type AssistantBlockReplaySegment = {
  blocks: AssistantMessageBlock[]
  startIndex: number
  endIndex: number
  replayAfter: ChatMessageProviderReplay | null
}

export function segmentAssistantBlocksByProviderReplay(
  blocks: AssistantMessageBlock[],
  projectReplay: (block: AssistantMessageBlock) => ChatMessageProviderReplay | null
): AssistantBlockReplaySegment[] {
  const segments: AssistantBlockReplaySegment[] = []
  let segmentStart = 0

  blocks.forEach((block, index) => {
    const replay = projectReplay(block)
    if (!replay) {
      return
    }

    segments.push({
      blocks: blocks.slice(segmentStart, index),
      startIndex: segmentStart,
      endIndex: index,
      replayAfter: replay
    })
    segmentStart = index + 1
  })

  segments.push({
    blocks: blocks.slice(segmentStart),
    startIndex: segmentStart,
    endIndex: blocks.length,
    replayAfter: null
  })
  return segments
}
