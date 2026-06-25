import {
  normalizeAgentPlanStatus,
  normalizeAgentPlanEntry as normalizeSharedAgentPlanEntry
} from '@shared/types/agent-plan-block'
import type {
  AgentPlanDisplayItem,
  AgentPlanItem,
  AgentPlanStepStatus
} from '@shared/types/agent-plan'

type Translate = (key: string, params?: Record<string, unknown>) => string

export type AgentPlanStepPresentation = {
  icon: string
  iconClass: string
  badgeClass: string
  textClass: string
}

export type NormalizedAgentPlanEntry = AgentPlanItem & {
  priority?: string | null
}

export function normalizePlanEntry(value: unknown): NormalizedAgentPlanEntry | null {
  const entry = normalizeSharedAgentPlanEntry(value) as AgentPlanDisplayItem | null
  if (!entry?.step) {
    return null
  }

  return {
    step: entry.step,
    status: normalizeAgentPlanStatus(entry.status),
    ...(entry.priority ? { priority: entry.priority } : {})
  }
}

export function resolveStepPresentation(
  status: AgentPlanStepStatus,
  options: { terminal?: boolean } = {}
): AgentPlanStepPresentation {
  if (status === 'completed') {
    return {
      icon: 'lucide:circle-check',
      iconClass: 'text-muted-foreground',
      badgeClass: 'border-border/70 bg-muted/45',
      textClass: 'text-foreground'
    }
  }

  if (status === 'in_progress' && options.terminal) {
    return {
      icon: 'lucide:circle-pause',
      iconClass: 'text-muted-foreground',
      badgeClass: 'border-border/70 bg-muted/45',
      textClass: 'text-foreground'
    }
  }

  if (status === 'in_progress') {
    return {
      icon: 'lucide:loader-circle',
      iconClass: 'animate-spin text-primary',
      badgeClass: 'border-primary/25 bg-primary/10',
      textClass: 'text-foreground'
    }
  }

  return {
    icon: 'lucide:circle',
    iconClass: 'text-muted-foreground',
    badgeClass: 'border-border/70',
    textClass: 'text-foreground'
  }
}

export function entryAriaLabel(
  t: Translate,
  entry: Pick<AgentPlanItem, 'step' | 'status'>,
  options: { terminal?: boolean } = {}
): string {
  const statusKey =
    entry.status === 'in_progress' && options.terminal
      ? 'chat.workspace.plan.status.interrupted'
      : `chat.workspace.plan.status.${entry.status}`
  return t('chat.workspace.plan.itemAriaLabel', {
    status: t(statusKey),
    step: entry.step
  })
}
