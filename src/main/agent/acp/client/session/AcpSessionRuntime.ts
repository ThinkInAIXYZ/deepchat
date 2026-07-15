import type { ConfigServicePort } from '@shared/presenter'
import { AcpSessionManager, AcpSessionPersistence } from '@/agent/acp/runtime'
import type { AcpProcessManager } from '@/agent/acp/runtime'

export class AcpSessionRuntime {
  readonly sessionManager: AcpSessionManager

  constructor(input: {
    providerId: string
    processManager: AcpProcessManager
    sessionPersistence: AcpSessionPersistence
    configService: ConfigServicePort
  }) {
    this.sessionManager = new AcpSessionManager(input)
  }
}
