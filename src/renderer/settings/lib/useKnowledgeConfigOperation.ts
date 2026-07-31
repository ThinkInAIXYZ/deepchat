import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'

export type KnowledgeConfigOperationSource = 'confirmation' | 'dialog' | 'panel'

export type KnowledgeConfigOperationFailure = Readonly<{
  title: string
  description?: string
}>

export type KnowledgeConfigOperation = Readonly<{
  code: string
  source: KnowledgeConfigOperationSource
  label: string
  perform: () => Promise<boolean>
  commit: () => void
  failure?: () => KnowledgeConfigOperationFailure
}>

export function useKnowledgeConfigOperation() {
  const { t } = useI18n()
  const controller = createRendererSurfaceFeedbackController('settings')
  const { snapshot } = useSurfaceFeedback(controller)
  const operationId = `settings.knowledgeBase.configuration:${nanoid(8)}`
  const source = ref<KnowledgeConfigOperationSource | null>(null)
  let retryOperation: KnowledgeConfigOperation | null = null

  const pending = computed(() => snapshot.value.status === 'pending')

  const run = async (operation: KnowledgeConfigOperation): Promise<boolean> => {
    if (pending.value) return false

    controller.begin(operationId, operation.label)
    source.value = operation.source
    retryOperation = operation

    let persisted = false
    try {
      persisted = await operation.perform()
    } catch (error) {
      console.error(`[KnowledgeConfigOperation] ${operation.code} failed`, error)
    }
    if (!persisted) {
      let failure: KnowledgeConfigOperationFailure | undefined
      try {
        failure = operation.failure?.()
      } catch (error) {
        console.error(`[KnowledgeConfigOperation] ${operation.code} failure copy failed`, error)
      }
      failure ??= {
        title: t('common.error.operationFailed')
      }
      controller.fail({
        code: `${operation.code}.failed`,
        ...failure
      })
      return false
    }

    try {
      operation.commit()
    } catch (error) {
      console.error(`[KnowledgeConfigOperation] ${operation.code} local commit failed`, error)
    }

    controller.succeed({
      code: `${operation.code}.succeeded`,
      title: t('common.saved')
    })
    retryOperation = null
    controller.clearSettled()
    source.value = null
    return true
  }

  const retry = () => {
    const operation = retryOperation
    if (!operation || pending.value) return
    void run(operation)
  }

  const clear = () => {
    if (pending.value) return
    retryOperation = null
    source.value = null
    if (snapshot.value.status !== 'idle') {
      controller.clearSettled()
    }
  }

  return Object.freeze({
    snapshot,
    pending,
    source,
    run,
    retry,
    clear
  })
}
