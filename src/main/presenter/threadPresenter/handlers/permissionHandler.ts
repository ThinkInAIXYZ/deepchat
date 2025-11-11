import type { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import type { ILlmProviderPresenter, IMCPPresenter } from '@shared/presenter'
import type { MessageManager } from '../messageManager'
import type { GeneratingMessageState } from '../types'
import type { StreamGenerationHandler } from './streamGenerationHandler'

export class PermissionHandler {
  private readonly generatingMessages: Map<string, GeneratingMessageState>
  private readonly messageManager: MessageManager
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly mcpPresenter: IMCPPresenter
  private readonly streamGenerationHandler: StreamGenerationHandler

  constructor(options: {
    generatingMessages: Map<string, GeneratingMessageState>
    messageManager: MessageManager
    llmProviderPresenter: ILlmProviderPresenter
    mcpPresenter: IMCPPresenter
    streamGenerationHandler: StreamGenerationHandler
  }) {
    this.generatingMessages = options.generatingMessages
    this.messageManager = options.messageManager
    this.llmProviderPresenter = options.llmProviderPresenter
    this.mcpPresenter = options.mcpPresenter
    this.streamGenerationHandler = options.streamGenerationHandler
    this.assertDependencies()
  }

  private assertDependencies(): void {
    void this.generatingMessages
    void this.messageManager
    void this.llmProviderPresenter
    void this.mcpPresenter
    void this.streamGenerationHandler
  }

  async handlePermissionResponse(
    _messageId: string,
    _toolCallId: string,
    _granted: boolean,
    _permissionType: 'read' | 'write' | 'all',
    _remember?: boolean
  ): Promise<void> {
    throw new Error('PermissionHandler.handlePermissionResponse not implemented yet')
  }

  async restartAgentLoopAfterPermission(_messageId: string): Promise<void> {
    throw new Error('PermissionHandler.restartAgentLoopAfterPermission not implemented yet')
  }

  async continueAfterPermissionDenied(_messageId: string): Promise<void> {
    throw new Error('PermissionHandler.continueAfterPermissionDenied not implemented yet')
  }

  async resumeStreamCompletion(_conversationId: string, _messageId: string): Promise<void> {
    throw new Error('PermissionHandler.resumeStreamCompletion not implemented yet')
  }

  async resumeAfterPermissionWithPendingToolCall(
    _state: GeneratingMessageState,
    _message: AssistantMessage,
    _conversationId: string
  ): Promise<void> {
    throw new Error(
      'PermissionHandler.resumeAfterPermissionWithPendingToolCall not implemented yet'
    )
  }

  async waitForMcpServiceReady(_serverName: string): Promise<void> {
    throw new Error('PermissionHandler.waitForMcpServiceReady not implemented yet')
  }

  findPendingToolCallAfterPermission(_message: AssistantMessage): AssistantMessageBlock | null {
    throw new Error('PermissionHandler.findPendingToolCallAfterPermission not implemented yet')
  }
}
