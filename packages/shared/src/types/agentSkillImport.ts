export interface AgentSkillImportSource {
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

export type AgentSkillImportPreviewStatus = 'ready' | 'same' | 'conflict' | 'unavailable'

export interface AgentSkillImportPreviewItem {
  name: string
  description: string
  status: AgentSkillImportPreviewStatus
  suggestedTargetName?: string
  affectedAgentIds?: string[]
  warning?: string
}

export interface AgentSkillImportPreview {
  source: AgentSkillImportSource
  items: AgentSkillImportPreviewItem[]
}

export type AgentSkillImportConflictStrategy = 'skip' | 'rename' | 'overwrite'

export interface AgentSkillImportSelection {
  skillName: string
  strategy: AgentSkillImportConflictStrategy
  acknowledgedAgentIds?: string[]
}

export interface AgentSkillImportFailure {
  skillName: string
  reason: string
}

export interface AgentSkillImportResult {
  success: boolean
  imported: string[]
  reused: string[]
  skipped: string[]
  failed: AgentSkillImportFailure[]
}
