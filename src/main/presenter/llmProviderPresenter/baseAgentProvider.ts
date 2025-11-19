import { BaseLLMProvider } from './baseProvider'
import type {
  AgentPermissionRequest,
  AgentPermissionResult,
  AgentProcessManager,
  AgentSessionManager
} from './agent/types'

/**
 * Base class for Agent-specific providers.
 * Ensures that session/process lifecycle management is centralized
 * while allowing subclasses to supply concrete managers.
 */
export abstract class BaseAgentProvider<
  TSessionManager extends AgentSessionManager = AgentSessionManager,
  TProcessManager extends AgentProcessManager = AgentProcessManager,
  TPermissionRequest extends AgentPermissionRequest = AgentPermissionRequest,
  TPermissionResult extends AgentPermissionResult = AgentPermissionResult
> extends BaseLLMProvider {
  protected abstract getSessionManager(): TSessionManager
  protected abstract getProcessManager(): TProcessManager
  protected abstract requestPermission(params: TPermissionRequest): Promise<TPermissionResult>

  /**
   * Default cleanup hook invoked when provider instances are torn down.
   * Clears in-memory sessions and tears down any running agent processes.
   */
  public cleanup(): void {
    try {
      this.getSessionManager().clearAllSessions()
    } catch (error) {
      console.warn(
        `[AgentProvider] Failed to clear sessions for provider "${this.provider.id}":`,
        error
      )
    }

    void this.getProcessManager()
      .shutdown()
      .catch((error) => {
        console.warn(
          `[AgentProvider] Failed to shutdown process manager for provider "${this.provider.id}":`,
          error
        )
      })
  }
}
