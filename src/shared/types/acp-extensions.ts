import type { Cost } from '@agentclientprotocol/sdk'
import type {
  LodyActivityMeta,
  LodyExtensionCapabilities,
  LodyGoalSnapshot,
  LodyNotice,
  LodySubagentProgress,
  LodySubagentSnapshot,
  LodySubagentTask,
  LodyTaskMeta,
  ModelUsage,
  RateLimitsSnapshot
} from 'acp-extension-core'
import type { AssistantMessageBlock } from './agent-interface'

export type AcpUsageLedger = {
  scopes: Record<string, Record<string, ModelUsage>>
  modelUsage: Record<string, ModelUsage>
  total: ModelUsage
  latest?: ModelUsage
  incomplete: boolean
  unscopedConnectionId?: string
  inheritedBaseline?: Record<string, ModelUsage>
  sinceFork?: ModelUsage
}

export type AcpSubagentRun = {
  runId: string
  snapshot?: LodySubagentSnapshot
  progress?: LodySubagentProgress
  blocks: AssistantMessageBlock[]
  outputIncomplete?: boolean
  taskId?: string
}

export type AcpExtensionState = {
  version: 1
  revision: number
  connectionId: string
  remoteSessionId: string
  connected: boolean
  capabilities: LodyExtensionCapabilities
  inheritedUsageUnknown?: boolean
  history?: AcpHistorySnapshot
  context?: { used: number; size: number; cost?: Cost | null; stale?: boolean }
  tasksStale?: boolean
  freshTaskIds?: string[]
  usage?: AcpUsageLedger
  rateLimits?: RateLimitsSnapshot
  goal?: LodyGoalSnapshot | null
  activity?: LodyActivityMeta
  notice?: LodyNotice
  title?: string | null
  titleSource?: 'explicit' | 'generated' | 'fallback' | 'unset'
  tasks: Record<string, LodyTaskMeta>
  remoteTasks: LodySubagentTask[]
  runs: Record<string, AcpSubagentRun>
  steers: Record<string, 'accepted' | 'applied' | 'failed' | 'unknown'>
}

export type AcpHistorySnapshot = {
  digest: string
  verifiedComplete: boolean
  readAt: number
  entries: Array<{
    id: string
    role: 'user' | 'assistant'
    turnId?: string
    text: string
    blocks: AssistantMessageBlock[]
  }>
}
