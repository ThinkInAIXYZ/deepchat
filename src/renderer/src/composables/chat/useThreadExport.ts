import { usePresenter } from '@/composables/usePresenter'
import { downloadBlob } from '@/lib/download'

/**
 * Thread export composable
 * Handles exporting conversations to various formats and nowledge-mem integration
 */
export function useThreadExport() {
  const exporterP = usePresenter('exporter')

  /**
   * Get content type for export format
   */
  const getContentType = (format: string): string => {
    switch (format) {
      case 'markdown':
        return 'text/markdown;charset=utf-8'
      case 'html':
        return 'text/html;charset=utf-8'
      case 'txt':
        return 'text/plain;charset=utf-8'
      case 'nowledge-mem':
        return 'application/json;charset=utf-8'
      default:
        return 'text/plain;charset=utf-8'
    }
  }

  /**
   * Export thread using main process
   */
  const exportWithMainThread = async (threadId: string, format: 'markdown' | 'html' | 'txt') => {
    const result = await exporterP.exportConversation(threadId, format)

    // Trigger download
    const blob = new Blob([result.content], {
      type: getContentType(format)
    })
    downloadBlob(blob, result.filename)

    return result
  }

  /**
   * Submit thread to nowledge-mem API
   */
  const submitToNowledgeMem = async (threadId: string) => {
    const result = await exporterP.submitToNowledgeMem(threadId)

    if (!result.success) {
      throw new Error(result.errors?.join(', ') || 'Submission failed')
    }
  }

  /**
   * Export thread content
   * @param threadId Thread ID
   * @param format Export format
   */
  const exportThread = async (
    threadId: string,
    format: 'markdown' | 'html' | 'txt' | 'nowledge-mem' = 'markdown'
  ) => {
    try {
      // Use nowledge-mem submission for that format
      if (format === 'nowledge-mem') {
        await submitToNowledgeMem(threadId)
        return { filename: '', content: '' }
      }
      return await exportWithMainThread(threadId, format)
    } catch (error) {
      console.error('Failed to export thread:', error)
      throw error
    }
  }

  /**
   * Test nowledge-mem connection
   */
  const testNowledgeMemConnection = async () => {
    try {
      const result = await exporterP.testNowledgeMemConnection()

      if (!result.success) {
        throw new Error(result.error || 'Connection test failed')
      }

      return result
    } catch (error) {
      console.error('Failed to test nowledge-mem connection:', error)
      throw error
    }
  }

  /**
   * Update nowledge-mem configuration
   */
  const updateNowledgeMemConfig = async (config: {
    baseUrl?: string
    apiKey?: string
    timeout?: number
  }) => {
    try {
      await exporterP.updateNowledgeMemConfig(config)
    } catch (error) {
      console.error('Failed to update nowledge-mem config:', error)
      throw error
    }
  }

  /**
   * Get nowledge-mem configuration
   */
  const getNowledgeMemConfig = () => {
    return exporterP.getNowledgeMemConfig()
  }

  return {
    exportThread,
    submitToNowledgeMem,
    testNowledgeMemConnection,
    updateNowledgeMemConfig,
    getNowledgeMemConfig
  }
}
