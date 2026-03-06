import type { Message } from '@shared/chat'

export type DisplayMessage = Message & {
  orderSeq: number
  messageType?: 'normal' | 'compaction'
  compactionStatus?: 'compacting' | 'compacted'
  summaryUpdatedAt?: number | null
}

export type MessageListItem = DisplayMessage

export function isCompactionMessageItem(item: MessageListItem): boolean {
  return item.messageType === 'compaction'
}
