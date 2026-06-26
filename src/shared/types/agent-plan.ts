import { z } from 'zod'

export const UPDATE_PLAN_TOOL_NAME = 'update_plan'

export const agentPlanStepStatusSchema = z.enum(['pending', 'in_progress', 'completed'])
export const agentPlanTerminalReasonSchema = z.enum(['aborted', 'max_steps', 'error'])
export const agentPlanItemSchema = z.strictObject({
  step: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, 'step must be a non-empty string'),
  status: agentPlanStepStatusSchema
})

export type AgentPlanStepStatus = z.infer<typeof agentPlanStepStatusSchema>
export type AgentPlanTerminalReason = z.infer<typeof agentPlanTerminalReasonSchema>
export type AgentPlanItem = z.infer<typeof agentPlanItemSchema>

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
  messageId?: string
  toolCallId?: string
  revision: number
  updatedAt: string
  terminalReason?: AgentPlanTerminalReason
}

export interface AgentPlanState {
  revision: number
}
