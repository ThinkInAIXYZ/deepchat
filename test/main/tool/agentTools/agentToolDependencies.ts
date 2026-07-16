import { vi } from 'vitest'
import type { AgentToolDependencies } from '@/tool/runtimePorts'

export const createAgentToolDependencies = (
  overrides: Record<string, any> = {}
): AgentToolDependencies => ({
  sessions: {
    resolveConversationWorkdir:
      overrides.resolveConversationWorkdir ?? vi.fn().mockResolvedValue(null),
    resolveConversationSessionInfo:
      overrides.resolveConversationSessionInfo ?? vi.fn().mockResolvedValue(null)
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
    forgetMemory: overrides.forgetMemory ?? vi.fn().mockResolvedValue(false)
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
    mergeSubagentTape: overrides.mergeSubagentTape ?? vi.fn(),
    discardSubagentTape: overrides.discardSubagentTape ?? vi.fn(),
    sendConversationMessage: overrides.sendConversationMessage ?? vi.fn(),
    cancelConversation: overrides.cancelConversation ?? vi.fn(),
    subscribeSessionRuntimeUpdates: overrides.subscribeSessionRuntimeUpdates ?? vi.fn(() => vi.fn())
  },
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
  desktop: overrides.desktop ?? {
    createSettingsWindow: vi.fn(),
    sendToWindow: vi.fn().mockReturnValue(true),
    sendSettingsNavigation: vi.fn().mockReturnValue(true)
  },
  permissions: {
    getApprovedFilePaths: overrides.getApprovedFilePaths ?? vi.fn().mockReturnValue([]),
    consumeSettingsApproval: overrides.consumeSettingsApproval ?? vi.fn().mockReturnValue(false)
  },
  cacheImage: overrides.cacheImage ?? vi.fn(async (data: string) => data)
})
