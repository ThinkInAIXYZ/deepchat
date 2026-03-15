import type { IMCPPresenter } from '@shared/presenter'

export interface ProviderMcpRuntimePort {
  mcpToolsToAnthropicTools: IMCPPresenter['mcpToolsToAnthropicTools']
  mcpToolsToGeminiTools: IMCPPresenter['mcpToolsToGeminiTools']
  mcpToolsToOpenAITools: IMCPPresenter['mcpToolsToOpenAITools']
  mcpToolsToOpenAIResponsesTools: IMCPPresenter['mcpToolsToOpenAIResponsesTools']
  getNpmRegistry?: IMCPPresenter['getNpmRegistry']
  getUvRegistry?: IMCPPresenter['getUvRegistry']
}
