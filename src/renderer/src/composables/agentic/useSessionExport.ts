/**
 * useSessionExport - SessionId-Based Export
 *
 * Provides export functionality for sessions using sessionId.
 * Replaces useThreadExport with sessionId-based export.
 *
 * @example
 * ```ts
 * const {
 *   exportAsMarkdown,
 *   exportAsHtml,
 *   exportAsTxt
 * } = useSessionExport()
 *
 * await exportAsMarkdown(sessionId, 'my-conversation.md')
 * ```
 */

import { ref } from 'vue'
import { usePresenter } from '@/composables/usePresenter'

export type ExportFormat = 'markdown' | 'html' | 'txt'

export interface ExportResult {
  filename: string
  content: string
}

export interface ExportOptions {
  format?: ExportFormat
  filename?: string
}

/**
 * useSessionExport - Session export composable
 */
export function useSessionExport() {
  const sessionPresenter = usePresenter('sessionPresenter')
  const isExporting = ref(false)
  const exportError = ref<Error | null>(null)

  /**
   * Export a session to the specified format
   * @param sessionId - The session ID to export
   * @param options - Export options (format, filename)
   * @returns Export result with filename and content
   */
  const exportSession = async (
    sessionId: string,
    options: ExportOptions = {}
  ): Promise<ExportResult> => {
    const { format = 'markdown' } = options

    isExporting.value = true
    exportError.value = null

    try {
      const result = await sessionPresenter.exportConversation(sessionId, format)

      return {
        filename: options.filename || result.filename,
        content: result.content
      }
    } catch (error) {
      exportError.value = error as Error
      console.error('[useSessionExport] Failed to export session:', error)
      throw error
    } finally {
      isExporting.value = false
    }
  }

  /**
   * Export session as Markdown
   * @param sessionId - The session ID to export
   * @param filename - Optional filename
   * @returns Export result with filename and content
   */
  const exportAsMarkdown = async (sessionId: string, filename?: string): Promise<ExportResult> => {
    return exportSession(sessionId, { format: 'markdown', filename })
  }

  /**
   * Export session as HTML
   * @param sessionId - The session ID to export
   * @param filename - Optional filename
   * @returns Export result with filename and content
   */
  const exportAsHtml = async (sessionId: string, filename?: string): Promise<ExportResult> => {
    return exportSession(sessionId, { format: 'html', filename })
  }

  /**
   * Export session as plain text
   * @param sessionId - The session ID to export
   * @param filename - Optional filename
   * @returns Export result with filename and content
   */
  const exportAsTxt = async (sessionId: string, filename?: string): Promise<ExportResult> => {
    return exportSession(sessionId, { format: 'txt', filename })
  }

  /**
   * Download export result as a file
   * @param result - The export result to download
   */
  const downloadExport = (result: ExportResult): void => {
    const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = result.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  /**
   * Export and download session in one step
   * @param sessionId - The session ID to export
   * @param options - Export options
   */
  const exportAndDownload = async (
    sessionId: string,
    options: ExportOptions = {}
  ): Promise<void> => {
    const result = await exportSession(sessionId, options)
    downloadExport(result)
  }

  return {
    // State
    isExporting,
    exportError,

    // Methods
    exportSession,
    exportAsMarkdown,
    exportAsHtml,
    exportAsTxt,
    downloadExport,
    exportAndDownload
  }
}

export type UseSessionExportReturn = ReturnType<typeof useSessionExport>
