import type { AgentMemoryCategory } from '@shared/types/agent-memory'
import type { MemoryAuditEvent, MemoryItem } from '@shared/contracts/routes'

export const ADD_CATEGORY_NONE = 'none'

export type MemoryCategoryFilter = AgentMemoryCategory | 'all' | 'uncategorized'
export type MemoryImportanceChoice = 'low' | 'medium' | 'high'

export const IMPORTANCE_VALUES: Record<MemoryImportanceChoice, number> = {
  low: 0.3,
  medium: 0.5,
  high: 0.8
}

export function importanceChoice(value: number): MemoryImportanceChoice {
  if (value >= 0.7) return 'high'
  if (value >= 0.45) return 'medium'
  return 'low'
}

export function importanceDots(value: number): string {
  const level = importanceChoice(value)
  if (level === 'high') return '●●●'
  if (level === 'medium') return '●●○'
  return '●○○'
}

export function sourceLabelKey(memory: MemoryItem): string {
  return memory.sourceSession
    ? 'settings.memory.redesign.sourceConversation'
    : 'settings.memory.redesign.sourceManual'
}

export function matchesCategoryFilter(memory: MemoryItem, filter: MemoryCategoryFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'uncategorized') return memory.category == null
  return memory.category === filter
}

export function categoryLabelKey(category: AgentMemoryCategory | null | undefined): string {
  if (category == null) return 'settings.deepchatAgents.memoryManager.categoryUncategorized'
  return `settings.deepchatAgents.memoryManager.category.${category}`
}

type MemoryToast = (options: {
  variant?: 'destructive'
  title: string
  description?: string
}) => void

export function notifyMemoryActionFailed(
  toast: MemoryToast,
  t: (key: string) => string,
  error?: unknown
): void {
  toast({
    variant: 'destructive',
    title: t('settings.deepchatAgents.memoryManager.actionFailed'),
    description: error instanceof Error ? error.message : error ? String(error) : undefined
  })
}

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>()

export function formatRelativeTime(ms: number, locale: string): string {
  const diffMs = ms - Date.now()
  const absMs = Math.abs(diffMs)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['week', 7 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000]
  ]
  const [unit, unitMs] = units.find(([, size]) => absMs >= size) ?? ['second', 1000]
  const value = Math.round(diffMs / unitMs)
  let formatter = relativeTimeFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeTimeFormatters.set(locale, formatter)
  }
  return formatter.format(value, unit)
}

export function shortDate(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms))
}

export function auditSentenceKey(event: Pick<MemoryAuditEvent, 'eventType'> | string): string {
  const eventType = typeof event === 'string' ? event : event.eventType
  const normalized = eventType
    .trim()
    .toLowerCase()
    .replace(/[\\/_\s\u2010-\u2015\u2212-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `settings.memory.redesign.audit.${normalized}`
}
