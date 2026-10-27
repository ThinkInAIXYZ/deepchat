import { vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import type { AgentToolDependencies } from '@/tool/runtimePorts'
import { AgentInvocationAdmission } from '../../../../src/harness/admission'
import { BackgroundExecService } from '@/agent/shared/process/backgroundExecSessionManager'

export const createBackgroundExecFixture = () =>
  new BackgroundExecService(async () => {
    throw new Error('Background helper launch must be supplied by the test')
  })

export const createAgentToolDependencies = (
  overrides: Record<string, any> = {}
): AgentToolDependencies => ({
  backgroundExec: overrides.backgroundExec ?? createBackgroundExecFixture(),
  agentInvocationAdmission: overrides.agentInvocationAdmission ?? new AgentInvocationAdmission(),
  sessions: {
    resolveConversationWorkdir:
      overrides.resolveConversationWorkdir ?? vi.fn().mockResolvedValue(null),
    resolveConversationSessionInfo:
      overrides.resolveConversationSessionInfo ?? vi.fn().mockResolvedValue(null),
    resolveConversationExecutionAuthorityNow:
      overrides.resolveConversationExecutionAuthorityNow ??
      vi.fn((sessionId: string) => ({
        sessionId,
        agentId: 'deepchat',
        projectDir: null,
        sessionKind: 'regular',
        disabledAgentTools: [],
        enabledMcpServerIds: undefined,
        subagentCapability: { available: false, maxSlots: 0 }
      })),
    resolveConversationExecutionAuthority:
      overrides.resolveConversationExecutionAuthority ?? vi.fn().mockResolvedValue(null)
  },
  tape: {
    getTapeInfo: overrides.getTapeInfo ?? vi.fn(),
    searchTape: overrides.searchTape ?? vi.fn(),
    getTapeContext: overrides.getTapeContext ?? vi.fn(),
    listTapeAnchors: overrides.listTapeAnchors ?? vi.fn(),
    handoffTape: overrides.handoffTape ?? vi.fn()
  },
  memory: {
    isMemoryEnabled: overrides.isMemoryEnabled ?? vi.fn(() => false),
    rememberMemory: overrides.rememberMemory ?? vi.fn(),
    recallMemory: overrides.recallMemory ?? vi.fn().mockResolvedValue([]),
    forgetMemory:
      overrides.forgetMemory ??
      vi.fn().mockResolvedValue({ action: 'rejected', reason: 'unavailable' })
  },
  cronJobs: {
    listCronJobs:
      overrides.listCronJobs ??
      vi.fn().mockResolvedValue({ jobs: [], schedulerStatus: { state: 'idle' } }),
    upsertCronJob: overrides.upsertCronJob ?? vi.fn(),
    deleteCronJob: overrides.deleteCronJob ?? vi.fn(),
    toggleCronJob: overrides.toggleCronJob ?? vi.fn(),
    runCronJobNow: overrides.runCronJobNow ?? vi.fn(),
    listCronJobRuns: overrides.listCronJobRuns ?? vi.fn().mockResolvedValue([]),
    previewCronSchedule:
      overrides.previewCronSchedule ?? vi.fn().mockResolvedValue({ runs: [], error: null })
  },
  subagents: {
    createSubagentSession: overrides.createSubagentSession ?? vi.fn(),
    linkSubagentTape: overrides.linkSubagentTape ?? vi.fn(),
    sendConversationMessage: overrides.sendConversationMessage ?? vi.fn(),
    cancelConversation: overrides.cancelConversation ?? vi.fn(),
    subscribeSessionRuntimeUpdates: overrides.subscribeSessionRuntimeUpdates ?? vi.fn(() => vi.fn())
  },
  liveDelegation:
    overrides.liveDelegation ??
    ({
      spawn: vi.fn(),
      send: vi.fn(),
      followUp: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      inspect: vi.fn(),
      wait: vi.fn().mockResolvedValue({ events: [], cursor: 0, timedOut: true }),
      interrupt: vi.fn()
    } as any),
  skills:
    overrides.skillService ??
    ({
      getActiveSkills: vi.fn().mockResolvedValue([]),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
      listSkillScripts: vi.fn().mockResolvedValue([]),
      getSkillExtension: vi.fn().mockResolvedValue({
        version: 1,
        env: {},
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      })
    } as any),
  skillExecutionAuthority:
    overrides.skillExecutionAuthority ??
    ({
      resolve: vi.fn(),
      assertCurrent: vi.fn()
    } as any),
  browser:
    overrides.browser ??
    ({
      getToolDefinitions: vi.fn().mockReturnValue([]),
      callTool: vi.fn()
    } as any),
  files:
    overrides.fileService ??
    ({
      getMimeType: vi.fn(),
      prepareFileCompletely: vi.fn()
    } as any),
  provider:
    overrides.providerRuntime ??
    ({
      executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
      generateCompletionStandalone: vi.fn(),
      generateImageStandalone: vi.fn()
    } as any),
  desktop: {
    tempDirectory: path.join(os.tmpdir(), 'deepchat-electron-temp'),
    profileTempDirectory: path.join(os.tmpdir(), 'deepchat-electron-user-data', 'temp'),
    readImageSize: overrides.readImageSize ?? vi.fn(async () => ({ width: 128, height: 96 })),
    createSettingsWindow: vi.fn(),
    sendToWindow: vi.fn().mockReturnValue(true),
    sendSettingsNavigation: vi.fn().mockReturnValue(true),
    ...overrides.desktop
  },
  permissions: {
    getApprovedFilePaths: overrides.getApprovedFilePaths ?? vi.fn().mockReturnValue([]),
    consumeSettingsApproval: overrides.consumeSettingsApproval ?? vi.fn().mockReturnValue(false)
  },
  readSession: overrides.readSession ?? vi.fn(),
  cacheImage: overrides.cacheImage ?? vi.fn(async (data: string) => data)
})
