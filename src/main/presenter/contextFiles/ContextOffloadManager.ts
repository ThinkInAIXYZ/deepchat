import type { ContextStore, ContextRef, ContextKind } from './contextStore'
import { nanoid } from 'nanoid'

export interface OffloadOptions {
  conversationId?: string
  content: string
  kind: ContextKind
  mimeType?: string
  threshold: number
  inlinePreviewSize: number
  sourceHint?: string
  refHint?: string
}

export interface OffloadResult {
  inlineContent: string
  contextRefMarkdown?: string
  wasOffloaded: boolean
  ref?: ContextRef
  originalSize: number
}

/**
 * Universal helper for offloading large content to context files.
 *
 * This manager handles:
 * - Checking if content exceeds threshold
 * - Creating context refs
 * - Writing full content to context files
 * - Generating markdown-formatted references
 * - Generating inline preview content
 */
export class ContextOffloadManager {
  constructor(private contextStore: ContextStore) {}

  private generateShortId(): string {
    return nanoid(5)
  }

  private determineCategory(
    sourceHint?: string
  ): 'Bash output' | 'Terminal output' | 'Tool output' {
    if (!sourceHint) {
      return 'Tool output'
    }

    const hint = sourceHint.toLowerCase()
    if (hint.includes('bash') || hint.includes('command') || hint.includes('execute')) {
      return 'Bash output'
    } else if (hint.includes('terminal')) {
      return 'Terminal output'
    } else {
      return 'Tool output'
    }
  }

  /**
   * Offload content if it exceeds threshold.
   *
   * @throws Error if conversationId is missing and offload is needed
   */
  async offload(options: OffloadOptions): Promise<OffloadResult> {
    const shouldOffload = this.shouldOffload(options.content, options.threshold)

    if (!shouldOffload) {
      return {
        inlineContent: options.content,
        wasOffloaded: false,
        originalSize: options.content.length
      }
    }

    if (!options.conversationId) {
      throw new Error('conversationId is required for offloading content')
    }

    const shortId = this.generateShortId()
    const category = this.determineCategory(options.sourceHint)

    const { ref } = await this.contextStore.createRef({
      conversationId: options.conversationId,
      kind: options.kind,
      mimeType: options.mimeType,
      hint: options.refHint || this.generateHint(options.sourceHint, options.content.length),
      strategy: 'eager',
      id: shortId
    })

    await this.contextStore.write(options.conversationId, ref.id, options.content)

    const inlineContent = this.generateInlinePreview(options.content, options.inlinePreviewSize)
    const contextRefMarkdown = this.formatContextRefMarkdown(ref, options.content.length, category)

    return {
      inlineContent,
      contextRefMarkdown,
      wasOffloaded: true,
      ref,
      originalSize: options.content.length
    }
  }

  private shouldOffload(content: string, threshold: number): boolean {
    return content.length > threshold
  }

  private generateInlinePreview(content: string, maxChars: number): string {
    if (content.length <= maxChars) {
      return content
    }

    return content.slice(0, maxChars)
  }

  private formatContextRefMarkdown(
    ref: ContextRef,
    originalSize: number,
    category: 'Bash output' | 'Terminal output' | 'Tool output'
  ): string {
    const sizeStr = this.formatSize(originalSize)

    return `[${category} in context: ${ref.id}] (${sizeStr})`
  }

  private generateHint(sourceHint?: string, size?: number): string {
    const parts: string[] = []

    if (sourceHint) {
      parts.push(sourceHint)
    }

    if (size !== undefined) {
      parts.push(this.formatSize(size))
    }

    return parts.join(' - ') || 'Context file'
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
  }
}
