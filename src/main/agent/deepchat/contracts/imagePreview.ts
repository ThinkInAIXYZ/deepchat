import type { MCPContentItem, ToolCallImagePreview } from '@shared/types/core/mcp'

export type CacheImageOptions = {
  signal?: AbortSignal
  allowPrivateNetwork?: boolean
}

export type CacheImageCallback = (data: string, options?: CacheImageOptions) => Promise<string>

/**
 * Tool-call image preview pipeline surface the built-in kernel needs. The host wraps the shared
 * preview helpers over the Desktop image cache; kernel modules receive this port instead of
 * importing the host module.
 */
export interface ToolImagePreviewPort {
  extractToolCallImagePreviews(params: {
    toolName?: string
    toolArgs?: string
    content: string | MCPContentItem[]
    cacheImage?: CacheImageCallback
    signal?: AbortSignal
  }): Promise<ToolCallImagePreview[]>
  cacheToolCallImagePreviews(params: {
    imagePreviews: ToolCallImagePreview[]
    cacheImage?: CacheImageCallback
    signal?: AbortSignal
  }): Promise<ToolCallImagePreview[]>
}
