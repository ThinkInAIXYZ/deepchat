import type { IConfigPresenter } from '@shared/presenter'
import { AcpSessionManager, AcpSessionPersistence } from '@/presenter/llmProviderPresenter/acp'
import type { AcpProcessManager } from '@/presenter/llmProviderPresenter/acp'

export class AcpSessionRuntime {
  readonly sessionManager: AcpSessionManager

  constructor(input: {
    providerId: string
    processManager: AcpProcessManager
    sessionPersistence: AcpSessionPersistence
    configPresenter: IConfigPresenter
  }) {
    this.sessionManager = new AcpSessionManager(input)
  }
}
