// Historical tool-call display only. This name is not a tool registration or runtime contract.
export const LEGACY_UPDATE_PLAN_TOOL_NAME = 'update_plan'

type LegacyPlanStatus = 'pending' | 'in_progress' | 'completed'
type LegacyPlanItem = { step: string; status: LegacyPlanStatus }
type Translate = (key: string, params?: Record<string, unknown>) => string

export function normalizeLegacyPlanEntries(value: unknown): LegacyPlanItem[] {
  if (!Array.isArray(value)) return []

  const entries: LegacyPlanItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const rawStep =
      typeof entry.step === 'string' && entry.step.trim()
        ? entry.step
        : typeof entry.content === 'string'
          ? entry.content
          : ''
    const step = rawStep.trim()
    if (!step) continue
    entries.push({
      step,
      status:
        entry.status === 'completed' || entry.status === 'done'
          ? 'completed'
          : entry.status === 'in_progress'
            ? 'in_progress'
            : 'pending'
    })
  }
  return entries
}

export function resolveStepPresentation(status: LegacyPlanStatus) {
  if (status === 'completed') {
    return {
      icon: 'lucide:circle-check',
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

export function entryAriaLabel(t: Translate, entry: LegacyPlanItem): string {
  return t('chat.workspace.plan.itemAriaLabel', {
    status: t(`chat.workspace.plan.status.${entry.status}`),
    step: entry.step
  })
}
