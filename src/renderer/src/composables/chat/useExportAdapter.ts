import { usePresenter } from '@/composables/usePresenter'

/**
 * Export adapter for conversation export and KnowledgeMem integration.
 */
export function useExportAdapter() {
  const exporterPresenter = usePresenter('exporter')

  const exportConversation = (conversationId: string, format: 'markdown' | 'html' | 'txt') => {
    return exporterPresenter.exportConversation(conversationId, format)
  }

  const submitToNowledgeMem = (conversationId: string) => {
    return exporterPresenter.submitToNowledgeMem(conversationId)
  }

  const testNowledgeMemConnection = () => {
    return exporterPresenter.testNowledgeMemConnection()
  }

  const updateNowledgeMemConfig = (config: {
    baseUrl?: string
    apiKey?: string
    timeout?: number
  }) => {
    return exporterPresenter.updateNowledgeMemConfig(config)
  }

  const getNowledgeMemConfig = () => {
    return exporterPresenter.getNowledgeMemConfig()
  }

  return {
    exportConversation,
    submitToNowledgeMem,
    testNowledgeMemConnection,
    updateNowledgeMemConfig,
    getNowledgeMemConfig
  }
}
