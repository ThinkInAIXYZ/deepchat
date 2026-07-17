import type { AssistantMessageBlock } from '@shared/types/agent-interface'

declare const tapeSessionIdBrand: unique symbol

export type TapeSessionId = string & { readonly [tapeSessionIdBrand]: 'TapeSessionId' }

export const toTapeSessionId = (value: string): TapeSessionId => value as TapeSessionId

export interface TapeEntryRef {
  sessionId: TapeSessionId
  entryId: number
}

export interface TapeFactProvenance {
  source: 'message' | 'tool_call' | 'tool_result' | 'runtime_event'
  sourceId: string
  sequence: number
}

export interface TapeToolFactInput {
  sessionId: TapeSessionId
  messageId: string
  orderSeq: number
  blockIndex: number
  block: AssistantMessageBlock
  provenance: TapeFactProvenance
}

export type TapeFactSource = 'live' | 'backfill' | 'repair'
