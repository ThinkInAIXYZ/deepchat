/**
 * Memory ingestion cursor surface the built-in kernel needs. The host `deepchat_sessions` table
 * satisfies this structural port; each method is a complete write unit.
 */
export interface MemoryCursorStorePort {
  getMemoryCursorOrderSeq(sessionId: string): number | null
  updateMemoryCursorOrderSeq(sessionId: string, orderSeq: number): void
  rewindMemoryCursorOrderSeq(sessionId: string, orderSeq: number): void
}
