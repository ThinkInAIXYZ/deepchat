import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { createRendererSurfaceFeedbackController } from '@/services/notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@/services/notifications/useSurfaceFeedback'

export type KnowledgeConfigOperationSource = 'dialog' | 'panel'

export type KnowledgeConfigOperation = Readonly<{
  code: string
  source: KnowledgeConfigOperationSource
  label: string
  perform: () => Promise<boolean>
  commit: () => void
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

    source.value = operation.source
    retryOperation = operation
    controller.begin(operationId, operation.label)

    let persisted = false
    try {
      persisted = await operation.perform()
    } catch (error) {
      console.error(`[KnowledgeConfigOperation] ${operation.code} failed`, {
        name: error instanceof Error ? error.name : 'UnknownError'
      })
    }
    if (!persisted) {
      controller.fail({
        code: `${operation.code}.failed`,
        title: t('common.error.operationFailed')
      })
      return false
    }

    try {
      operation.commit()
    } catch (error) {
      console.error(`[KnowledgeConfigOperation] ${operation.code} local commit failed`, {
        name: error instanceof Error ? error.name : 'UnknownError'
      })
    }

    retryOperation = null
    controller.succeed({
      code: `${operation.code}.succeeded`,
      title: t('common.saved')
    })
    controller.clear()
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
      controller.clear()
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
