export type AgentSkillImportSource =
  | {
      kind: 'internal'
      agentId: string
    }
  | {
      kind: 'external'
      toolId: string
    }

export interface AgentSkillImportSourceInfo {
  id: string
  source: AgentSkillImportSource
  name: string
  available: boolean
  skillCount: number
}

export type AgentSkillImportPreviewStatus = 'ready' | 'conflict' | 'unavailable'

export interface AgentSkillImportPreviewItem {
  name: string
  description: string
  status: AgentSkillImportPreviewStatus
  suggestedTargetName?: string
  warning?: string
}

export interface AgentSkillImportPreview {
  targetAgentId: string
  source: AgentSkillImportSource
  items: AgentSkillImportPreviewItem[]
}

export type AgentSkillImportConflictStrategy = 'skip' | 'rename' | 'overwrite'

export interface AgentSkillImportSelection {
  skillName: string
  strategy: AgentSkillImportConflictStrategy
}

export interface AgentSkillImportFailure {
  skillName: string
  reason: string
}

export interface AgentSkillImportResult {
  success: boolean
  imported: string[]
  skipped: string[]
  failed: AgentSkillImportFailure[]
}
