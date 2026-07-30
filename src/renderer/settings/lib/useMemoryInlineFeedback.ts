import { readonly, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT } from '@shared/types/agent-memory'
import type { MemoryDirectiveCommandResult } from '@shared/contracts/routes'

export type MemoryInlineFeedbackTone = 'error' | 'warning' | 'info'

export type MemoryInlineFeedbackState = Readonly<{
  tone: MemoryInlineFeedbackTone
  title: string
  description?: string
}>

export function useMemoryInlineFeedback(scope: string) {
  const { t } = useI18n()
  const feedback = shallowRef<MemoryInlineFeedbackState | null>(null)
  const diagnosticScope = scope.trim() || 'Memory'

  const show = (tone: MemoryInlineFeedbackTone, title: string, description?: string): void => {
    const normalizedTitle = title.trim() || t('settings.deepchatAgents.memoryManager.actionFailed')
    const normalizedDescription = description?.trim()
    feedback.value = Object.freeze({
      tone,
      title: normalizedTitle,
      ...(normalizedDescription ? { description: normalizedDescription } : {})
    })
  }

  const clear = (): void => {
    feedback.value = null
  }

  const fail = (error?: unknown): void => {
    if (error !== undefined) {
      console.error(`[${diagnosticScope}] Action failed`, error)
    }
    show('error', t('settings.deepchatAgents.memoryManager.actionFailed'))
  }

  const rejectDirective = (
    reason: Extract<MemoryDirectiveCommandResult, { action: 'rejected' }>['reason']
  ): void => {
    if (reason !== 'capacity') {
      fail()
      return
    }
    show(
      'error',
      t('settings.memory.redesign.directiveCapacityTitle'),
      t('settings.memory.redesign.directiveCapacityDescription', {
        max: AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
      })
    )
  }

  return Object.freeze({
    feedback: readonly(feedback),
    show,
    clear,
    fail,
    rejectDirective
  })
}
