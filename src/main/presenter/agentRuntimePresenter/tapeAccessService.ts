import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeInfo,
  AgentTapeSearchOptions,
  AgentTapeSearchResult
} from '@shared/types/agent-interface'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type { DeepChatMessageStore } from './messageStore'
import type { DeepChatTapeService } from './tapeService'

export class AgentTapeAccessService {
  constructor(
    private readonly tapeService: DeepChatTapeService,
    private readonly messageStore: DeepChatMessageStore
  ) {}

  async getTapeInfo(sessionId: string): Promise<AgentTapeInfo> {
    this.ensureSessionTapeReady(sessionId)
    return this.tapeService.info(sessionId)
  }

  async searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]> {
    this.ensureSessionTapeReady(sessionId)
    return this.tapeService.search(sessionId, query, options)
  }

  async getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult> {
    this.ensureSessionTapeReady(sessionId)
    return this.tapeService.getContext(sessionId, entryIds, options)
  }

  async listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]> {
    this.ensureSessionTapeReady(sessionId)
    return this.tapeService.anchors(sessionId, options)
  }

  async handoffTape(
    sessionId: string,
    name: string,
    state: Record<string, unknown> = {}
  ): Promise<AgentTapeAnchorResult> {
    this.ensureSessionTapeReady(sessionId)
    return this.tapeService.handoffResult(sessionId, name, state)
  }

  async listMessageViewManifests(
    sessionId: string,
    messageId: string
  ): Promise<DeepChatTapeViewManifestRecord[]> {
    this.ensureSessionTapeReady(sessionId)
    return this.tapeService.listViewManifestsByMessage(sessionId, messageId)
  }

  async exportMessageTapeReplaySlice(
    sessionId: string,
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null> {
    this.ensureSessionTapeReady(sessionId)
    return this.tapeService.exportReplaySlice(sessionId, messageId, options)
  }

  async mergeSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    this.ensureSessionTapeReady(parentSessionId)
    this.ensureSessionTapeReady(childSessionId)
    this.tapeService.recordExternalForkMerge(parentSessionId, childSessionId, childSessionId, meta)
  }

  async discardSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    this.ensureSessionTapeReady(parentSessionId)
    this.tapeService.recordExternalForkDiscard(
      parentSessionId,
      childSessionId,
      childSessionId,
      meta
    )
  }

  private ensureSessionTapeReady(sessionId: string): void {
    this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
  }
}
