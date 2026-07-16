import { describe, expect, it, vi } from 'vitest'
import type { CronJob, CronJobRun } from '@shared/cronJobs'
import {
  createCronJobRunSessionStarter,
  type CronJobAgentCatalogPort,
  type CronJobSessionLifecyclePort,
  type CronJobSessionTurnPort
} from '@/presenter/cronJobs'

const createPorts = () => {
  const lifecycle: CronJobSessionLifecyclePort = {
    createDetachedSession: vi.fn(async () => ({ id: 'session-1' }))
  }
  const turn: CronJobSessionTurnPort = {
    sendMessage: vi.fn(async () => ({ requestId: 'request-1', messageId: 'message-1' })),
    cancelGeneration: vi.fn(async () => undefined)
  }
  const agentCatalog: CronJobAgentCatalogPort = {
    getAgentType: vi.fn(async () => 'deepchat')
  }

  return { lifecycle, turn, agentCatalog }
}

const createRun = (): CronJobRun =>
  ({
    id: 'run-1',
    scheduledAt: 123
  }) as CronJobRun

describe('createCronJobRunSessionStarter', () => {
  it('creates detached sessions with cron source metadata', async () => {
    const ports = createPorts()
    const starter = createCronJobRunSessionStarter(ports)
    const job = {
      id: 'cron-1',
      name: 'Morning job',
      agentId: 'deepchat',
      agentSnapshot: null,
      modelPolicy: 'follow_agent',
      permissionPolicy: 'follow_agent',
      toolPolicy: 'follow_agent',
      taskSystemInstruction: null
    } as CronJob

    await expect(starter.createSessionForRun({ job, run: createRun() })).resolves.toEqual({
      sessionId: 'session-1'
    })

    expect(ports.lifecycle.createDetachedSession).toHaveBeenCalledWith({
      agentId: 'deepchat',
      title: 'Morning job',
      metadata: {
        source: 'cron_job',
        cronJobId: 'cron-1',
        cronJobRunId: 'run-1',
        scheduledAt: 123
      }
    })
  })

  it('applies pinned snapshots and task system prompt precedence', async () => {
    const ports = createPorts()
    const starter = createCronJobRunSessionStarter(ports)
    const job = {
      id: 'cron-1',
      name: 'Morning job',
      agentId: 'deepchat',
      agentSnapshot: {
        version: 1,
        capturedAt: 100,
        agent: { id: 'deepchat', name: 'DeepChat', type: 'deepchat' },
        config: {
          defaultModelPreset: { providerId: 'anthropic', modelId: 'claude-sonnet' },
          permissionMode: 'full_access',
          disabledAgentTools: ['write_file'],
          subagentEnabled: false,
          systemPrompt: 'Snapshot system prompt'
        }
      },
      modelPolicy: 'pin_current',
      permissionPolicy: 'snapshot',
      toolPolicy: 'snapshot',
      taskSystemInstruction: '  Task-specific system prompt  '
    } as CronJob

    await starter.createSessionForRun({ job, run: createRun() })

    expect(ports.lifecycle.createDetachedSession).toHaveBeenCalledWith({
      agentId: 'deepchat',
      title: 'Morning job',
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      permissionMode: 'full_access',
      disabledAgentTools: ['write_file'],
      generationSettings: { systemPrompt: 'Task-specific system prompt' },
      metadata: {
        source: 'cron_job',
        cronJobId: 'cron-1',
        cronJobRunId: 'run-1',
        scheduledAt: 123
      }
    })
  })

  it('routes ACP runs through lifecycle and turn ports', async () => {
    const ports = createPorts()
    vi.mocked(ports.agentCatalog.getAgentType).mockResolvedValue('acp')
    vi.mocked(ports.lifecycle.createDetachedSession).mockResolvedValue({ id: 'acp-session-1' })
    vi.mocked(ports.turn.sendMessage).mockResolvedValue({
      requestId: 'request-2',
      messageId: 'message-2'
    })
    const starter = createCronJobRunSessionStarter(ports)
    const job = {
      id: 'cron-acp',
      name: 'ACP job',
      agentId: 'manual-acp',
      agentSnapshot: null,
      modelPolicy: 'follow_agent',
      permissionPolicy: 'follow_agent',
      toolPolicy: 'follow_agent',
      taskSystemInstruction: null,
      taskPrompt: 'Review the workspace',
      runtime: { maxTurns: 7 }
    } as CronJob
    const run = { id: 'run-acp', scheduledAt: 123 } as CronJobRun

    await expect(starter.createSessionForRun({ job, run })).resolves.toEqual({
      sessionId: 'acp-session-1'
    })
    await expect(
      starter.startSessionRun({ job, run, sessionId: 'acp-session-1' })
    ).resolves.toEqual({ outputMessageId: 'message-2' })

    expect(ports.lifecycle.createDetachedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'manual-acp',
        providerId: 'acp',
        modelId: 'manual-acp'
      })
    )
    expect(ports.turn.sendMessage).toHaveBeenCalledWith('acp-session-1', 'Review the workspace', {
      maxProviderRounds: 7
    })

    await starter.cancelSessionRun?.({
      job,
      run,
      sessionId: 'acp-session-1',
      reason: 'Cron job exceeded max duration.'
    })
    expect(ports.turn.cancelGeneration).toHaveBeenCalledWith('acp-session-1')
  })
})
