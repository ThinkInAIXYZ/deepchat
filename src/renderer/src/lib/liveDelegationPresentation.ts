import type { LiveDelegationStatus } from '@shared/orchestration/liveDelegation'

export type LiveDelegationDisplayStatus = LiveDelegationStatus | 'tool_error'

type LiveDelegationStatusPresentation = Readonly<{
  labelKey: string
  dotClass: string
  badgeClass: string
  active: boolean
  actionRequired: boolean
}>

const ACTIVE_PRESENTATION = {
  dotClass: 'bg-blue-500',
  badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  active: true,
  actionRequired: false
} as const

const WAITING_PRESENTATION = {
  dotClass: 'bg-amber-500',
  badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  active: true,
  actionRequired: true
} as const

const UNKNOWN_PRESENTATION: LiveDelegationStatusPresentation = {
  labelKey: 'chat.toolCall.subagents.status.error',
  dotClass: 'bg-muted-foreground',
  badgeClass: 'bg-muted text-muted-foreground',
  active: false,
  actionRequired: false
}

const STATUS_PRESENTATIONS: Record<LiveDelegationDisplayStatus, LiveDelegationStatusPresentation> =
  {
    queued: {
      labelKey: 'chat.toolCall.subagents.status.queued',
      ...ACTIVE_PRESENTATION
    },
    running: {
      labelKey: 'chat.toolCall.subagents.status.running',
      ...ACTIVE_PRESENTATION
    },
    waiting_permission: {
      labelKey: 'chat.toolCall.subagents.status.waiting_permission',
      ...WAITING_PRESENTATION
    },
    waiting_question: {
      labelKey: 'chat.toolCall.subagents.status.waiting_question',
      ...WAITING_PRESENTATION
    },
    idle: {
      labelKey: 'chat.toolCall.subagents.status.completed',
      dotClass: 'bg-emerald-500',
      badgeClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      active: false,
      actionRequired: false
    },
    failed: {
      labelKey: 'chat.toolCall.subagents.status.error',
      dotClass: 'bg-destructive',
      badgeClass: 'bg-destructive/10 text-destructive',
      active: false,
      actionRequired: false
    },
    interrupted: {
      labelKey: 'chat.toolCall.subagents.status.cancelled',
      dotClass: 'bg-amber-500',
      badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      active: false,
      actionRequired: false
    },
    tool_error: {
      labelKey: 'chat.toolCall.subagents.status.error',
      dotClass: 'bg-destructive',
      badgeClass: 'bg-destructive/10 text-destructive',
      active: false,
      actionRequired: false
    }
  }

export function getLiveDelegationStatusPresentation(
  status: LiveDelegationDisplayStatus
): LiveDelegationStatusPresentation {
  return STATUS_PRESENTATIONS[status] ?? UNKNOWN_PRESENTATION
}
