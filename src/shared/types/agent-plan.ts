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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function normalizeAgentPlanStatus(value: unknown): AgentPlanStepStatus {
  if (value === 'completed' || value === 'done') {
    return 'completed'
  }
  if (value === 'in_progress') {
    return 'in_progress'
  }
  return 'pending'
}

export function normalizeAgentPlanEntry(value: unknown): AgentPlanDisplayItem | null {
  if (!isRecord(value)) {
    return null
  }

  const rawStep =
    typeof value.step === 'string' && value.step.trim()
      ? value.step
      : typeof value.content === 'string'
        ? value.content
        : ''
  const step = typeof rawStep === 'string' ? rawStep.trim() : ''
  if (!step) {
    return null
  }

  return {
    step,
    status: normalizeAgentPlanStatus(value.status),
    ...(typeof value.priority === 'string' ? { priority: value.priority } : {})
  }
}

export function normalizeAgentPlanEntries(value: unknown): AgentPlanItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeAgentPlanEntry)
    .filter((entry): entry is AgentPlanDisplayItem => entry !== null)
    .map((entry) => ({
      step: entry.step || '',
      status: normalizeAgentPlanStatus(entry.status)
    }))
    .filter((entry) => entry.step.length > 0)
}

export function normalizeAgentPlanTerminalReason(
  value: unknown
): AgentPlanTerminalReason | undefined {
  if (value === 'aborted' || value === 'max_steps' || value === 'error') {
    return value
  }
  return undefined
}
