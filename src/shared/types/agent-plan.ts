export type AgentPlanStepStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentPlanItem {
  step: string
  status: AgentPlanStepStatus
}

export interface AgentPlanDisplayItem {
  step?: string
  content?: string
  status?: AgentPlanStepStatus | string | null
  priority?: string | null
}

export interface UpdatePlanArgs {
  explanation?: string
  plan: AgentPlanItem[]
}

export interface AgentPlanSnapshot extends UpdatePlanArgs {
  sessionId: string
  toolCallId?: string
  revision: number
  updatedAt: string
}

export interface AgentPlanState {
  current: UpdatePlanArgs | null
  revision: number
  updatedAt: string | null
}
