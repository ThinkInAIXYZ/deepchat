import type { WorkspaceInvalidationEvent, WorkspaceWatchStatusEvent } from '@shared/types/workspace'

export interface WorkspaceFilePort {
  prepareFileCompletely(
    filePath: string,
    mimeType?: string,
    contentType?: null | 'origin' | 'llm-friendly'
  ): Promise<{
    path: string
    name: string
    mimeType: string
    content?: string
    thumbnail?: string
    metadata: {
      fileName: string
      fileSize: number
      fileDescription?: string
      fileCreated: Date
      fileModified: Date
    }
  }>
}

export interface WorkspaceEventPublisher {
  publishInvalidated(event: WorkspaceInvalidationEvent): void
  publishWatchStatusChanged(event: WorkspaceWatchStatusEvent): void
}
