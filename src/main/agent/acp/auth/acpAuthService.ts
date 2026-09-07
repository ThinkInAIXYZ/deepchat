import type { AcpAgentConfig, AcpAuthChallenge, AcpAuthRunStatus } from '@shared/types/acp'
import type { AgentSettingsPort } from '@/agent/settings'
import type { AcpRuntimeOwner } from '../client'
import { AcpTerminalAuthRunner, type AcpTerminalAuthExit } from './acpTerminalAuthRunner'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'

type AcpAuthEventName = 'acpAuth.output' | 'acpAuth.stateChanged'
type AcpAuthStatusInput = Omit<AcpAuthRunStatus, 'version'>
type StoredAuthStatus = AcpAuthRunStatus & { ownerWebContentsId: number }

const MAX_AUTH_STATUS_ENTRIES = 100

export interface AcpAuthServiceDependencies {
  owner: AcpRuntimeOwner
  agentSettings: Pick<AgentSettingsPort, 'getAcpAgents'>
  sendToRenderer(webContentsId: number, name: AcpAuthEventName, payload: unknown): void
  onRendererDestroyed(webContentsId: number, callback: () => void): () => void
}

export class AcpAuthService {
  private readonly runner = new AcpTerminalAuthRunner()
  private readonly statuses = new Map<string, StoredAuthStatus>()
  private readonly detachRendererListeners = new Map<string, () => void>()
  private lastEventVersion = 0
  private disposed = false

  constructor(private readonly dependencies: AcpAuthServiceDependencies) {}

  async inspect(
    agentId: string,
    workdir: string | undefined,
    ownerWebContentsId: number
  ): Promise<AcpAuthChallenge> {
    this.ensureActive()
    const agent = await this.resolveAgent(agentId)
    const challenge = await this.dependencies.owner
      .getOrCreate()
      .processManager.inspectAuthentication(agent, workdir)
    this.ensureActive()
    this.rememberStatus({
      challengeId: challenge.id,
      state: 'required',
      version: this.nextEventVersion(),
      ownerWebContentsId
    })
    return challenge
  }

  async start(
    challengeId: string,
    methodId: string,
    ownerWebContentsId: number
  ): Promise<AcpAuthRunStatus> {
    this.ensureActive()
    const current = this.statuses.get(challengeId)
    if (current && current.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('ACP authentication is owned by another renderer')
    }
    if (current?.state === 'running' || current?.state === 'reconnecting') {
      return this.publicStatus(current)
    }

    const processManager = this.dependencies.owner.getOrCreate().processManager
    const challenge = processManager.getAuthChallenge(challengeId)
    const method = challenge.methods.find((candidate) => candidate.id === methodId)
    if (!method) throw new Error('ACP authentication method is unavailable')
    if (method.type === 'unsupported') {
      throw new Error('ACP authentication method is not supported by DeepChat')
    }

    if (method.type === 'agent') {
      this.setStatus(ownerWebContentsId, { challengeId, state: 'running' })
      const controller = new AbortController()
      const detachRendererListener = this.dependencies.onRendererDestroyed(ownerWebContentsId, () =>
        controller.abort(new Error('ACP authentication renderer was destroyed'))
      )
      try {
        await processManager.authenticateAgent(challengeId, methodId, controller.signal)
        return this.setStatus(ownerWebContentsId, { challengeId, state: 'succeeded' })
      } catch (error) {
        return this.setStatus(ownerWebContentsId, {
          challengeId,
          state: 'failed',
          error: this.toSafeError(error)
        })
      } finally {
        detachRendererListener()
      }
    }

    const prepared = await processManager.prepareTerminalAuthentication(challengeId, methodId)
    let started: ReturnType<AcpTerminalAuthRunner['start']>
    try {
      this.ensureActive()
      started = this.runner.start({
        ownerWebContentsId,
        launch: prepared.launch,
        onData: (runId, data) => {
          if (this.disposed) return
          this.dependencies.sendToRenderer(ownerWebContentsId, 'acpAuth.output', {
            challengeId,
            runId,
            data,
            version: this.nextEventVersion()
          })
        }
      })
    } catch (error) {
      processManager.abandonAuthentication(challengeId)
      return this.setStatus(ownerWebContentsId, {
        challengeId,
        state: 'failed',
        error: this.toSafeError(error)
      })
    }

    const status = this.setStatus(ownerWebContentsId, {
      challengeId,
      runId: started.runId,
      state: 'running'
    })
    this.detachRendererListeners.set(
      started.runId,
      this.dependencies.onRendererDestroyed(ownerWebContentsId, () => {
        this.runner.cancel(started.runId, ownerWebContentsId)
      })
    )
    void this.finishTerminalAuthentication(
      challengeId,
      started.runId,
      ownerWebContentsId,
      started.completion
    )
    return status
  }

  getStatus(challengeId: string, ownerWebContentsId: number): AcpAuthRunStatus {
    const status = this.statuses.get(challengeId)
    if (!status) {
      return { challengeId, state: 'required', version: this.nextEventVersion() }
    }
    if (status.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('ACP authentication is owned by another renderer')
    }
    return this.publicStatus(status)
  }

  write(runId: string, ownerWebContentsId: number, data: string): void {
    this.runner.write(runId, ownerWebContentsId, data)
  }

  cancel(runId: string, ownerWebContentsId: number): boolean {
    return this.runner.cancel(runId, ownerWebContentsId)
  }

  shutdown(): void {
    if (this.disposed) return
    this.disposed = true
    this.runner.shutdown()
    this.detachRendererListeners.forEach((detach) => detach())
    this.detachRendererListeners.clear()
    this.statuses.clear()
  }

  private async finishTerminalAuthentication(
    challengeId: string,
    runId: string,
    ownerWebContentsId: number,
    completion: Promise<AcpTerminalAuthExit>
  ): Promise<void> {
    const processManager = this.dependencies.owner.getOrCreate().processManager
    try {
      const exit = await completion
      if (exit.reason === 'cancelled') {
        processManager.abandonAuthentication(challengeId)
        this.setStatus(ownerWebContentsId, {
          challengeId,
          runId,
          state: 'cancelled'
        })
        return
      }
      if (exit.reason === 'timed_out') {
        processManager.abandonAuthentication(challengeId)
        this.setStatus(ownerWebContentsId, {
          challengeId,
          runId,
          state: 'failed',
          error: 'Authentication process timed out'
        })
        return
      }
      if (exit.reason === 'output_limit') {
        processManager.abandonAuthentication(challengeId)
        this.setStatus(ownerWebContentsId, {
          challengeId,
          runId,
          state: 'failed',
          error: 'Authentication process exceeded the output limit'
        })
        return
      }
      if (exit.signal) {
        processManager.abandonAuthentication(challengeId)
        this.setStatus(ownerWebContentsId, {
          challengeId,
          runId,
          state: 'failed',
          error: `Authentication process terminated by signal ${exit.signal}`
        })
        return
      }
      if (exit.exitCode !== 0) {
        processManager.abandonAuthentication(challengeId)
        this.setStatus(ownerWebContentsId, {
          challengeId,
          runId,
          state: 'failed',
          error: `Authentication process exited with code ${exit.exitCode}`
        })
        return
      }

      this.setStatus(ownerWebContentsId, {
        challengeId,
        runId,
        state: 'reconnecting'
      })
      await processManager.completeTerminalAuthentication(challengeId)
      this.setStatus(ownerWebContentsId, {
        challengeId,
        runId,
        state: 'succeeded'
      })
    } catch (error) {
      processManager.abandonAuthentication(challengeId)
      this.setStatus(ownerWebContentsId, {
        challengeId,
        runId,
        state: 'failed',
        error: this.toSafeError(error)
      })
    } finally {
      this.detachRendererListeners.get(runId)?.()
      this.detachRendererListeners.delete(runId)
    }
  }

  private async resolveAgent(agentId: string): Promise<AcpAgentConfig> {
    const canonicalId = resolveAcpAgentAlias(agentId)
    const agent = (await this.dependencies.agentSettings.getAcpAgents()).find(
      (candidate) => candidate.id === canonicalId
    )
    if (!agent) throw new Error(`ACP agent not found: ${canonicalId}`)
    return agent
  }

  private setStatus(ownerWebContentsId: number, status: AcpAuthStatusInput): AcpAuthRunStatus {
    const publicStatus: AcpAuthRunStatus = {
      ...status,
      version: this.nextEventVersion()
    }
    if (this.disposed) return publicStatus
    this.rememberStatus({ ...publicStatus, ownerWebContentsId })
    this.dependencies.sendToRenderer(ownerWebContentsId, 'acpAuth.stateChanged', publicStatus)
    return publicStatus
  }

  private rememberStatus(status: StoredAuthStatus): void {
    this.statuses.delete(status.challengeId)
    this.statuses.set(status.challengeId, status)
    if (this.statuses.size <= MAX_AUTH_STATUS_ENTRIES) return

    for (const [challengeId, candidate] of this.statuses) {
      if (candidate.state === 'running' || candidate.state === 'reconnecting') continue
      this.statuses.delete(challengeId)
      if (this.statuses.size <= MAX_AUTH_STATUS_ENTRIES) return
    }
  }

  private publicStatus(status: StoredAuthStatus): AcpAuthRunStatus {
    const { ownerWebContentsId: _ownerWebContentsId, ...result } = status
    return result
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error('ACP authentication service is shut down')
  }

  private nextEventVersion(): number {
    this.lastEventVersion = Math.max(Date.now(), this.lastEventVersion + 1)
    return this.lastEventVersion
  }

  private toSafeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
  }
}
