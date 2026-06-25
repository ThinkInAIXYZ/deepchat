import type {
  AgentPlanDisplayItem,
  AgentPlanItem,
  AgentPlanSnapshot,
  AgentPlanStepStatus,
  AgentPlanTerminalReason
} from './agent-plan'

export type AgentPlanBlockLike = {
  type: string
  content?: string
  extra?: Record<string, unknown>
}

export type AgentPlanHydratedSnapshot = AgentPlanSnapshot & {
  messageId: string
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

  const rawStep = typeof value.step === 'string' ? value.step : value.content
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

export function snapshotFromAgentPlanBlock(
  sessionId: string,
  messageId: string,
  block: AgentPlanBlockLike
): AgentPlanHydratedSnapshot | null {
  if (block.type !== 'plan') {
    return null
  }

  const plan = normalizeAgentPlanEntries(block.extra?.plan_entries)
  if (plan.length === 0) {
    return null
  }

  const rawRevision = block.extra?.plan_revision
  const revision = typeof rawRevision === 'number' && rawRevision > 0 ? rawRevision : 1
  const rawUpdatedAt = block.extra?.plan_updated_at
  const updatedAt = typeof rawUpdatedAt === 'string' && rawUpdatedAt ? rawUpdatedAt : ''
  const rawExplanation = block.extra?.plan_explanation
  const explanation =
    typeof rawExplanation === 'string' && rawExplanation.trim()
      ? rawExplanation.trim()
      : block.content?.trim() || undefined
  const terminalReason = normalizeAgentPlanTerminalReason(block.extra?.plan_terminal_reason)

  return {
    sessionId,
    messageId,
    plan,
    ...(explanation ? { explanation } : {}),
    revision,
    updatedAt: updatedAt || new Date(0).toISOString(),
    ...(terminalReason ? { terminalReason } : {})
  }
}
