import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

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

export type KnowledgeConfigOperationSnapshot = Readonly<
  | { status: 'idle'; version: number }
  | { status: 'pending'; version: number }
  | { status: 'success'; version: number }
  | { status: 'error'; version: number }
>

export function useKnowledgeConfigOperation() {
  const { t } = useI18n()
  const snapshot = ref<KnowledgeConfigOperationSnapshot>({ status: 'idle', version: 0 })
  const source = ref<KnowledgeConfigOperationSource | null>(null)
  const lastError = ref<KnowledgeConfigOperationFailure | null>(null)
  let retryOperation: KnowledgeConfigOperation | null = null

  const pending = computed(() => snapshot.value.status === 'pending')

  const run = async (operation: KnowledgeConfigOperation): Promise<boolean> => {
    if (pending.value) return false

    snapshot.value = { status: 'pending', version: snapshot.value.version + 1 }
    source.value = operation.source
    retryOperation = operation
    lastError.value = null

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
      if (operation.source === 'dialog') {
        // 对话框保存：反馈走按钮态 + 内联错误，不再弹 toast
        lastError.value = failure
      } else {
        notifyRenderer({
          kind: 'error',
          code: `${operation.code}.failed`,
          ...failure
        })
      }
      snapshot.value = { status: 'error', version: snapshot.value.version }
      return false
    }

    try {
      operation.commit()
    } catch (error) {
      console.error(`[KnowledgeConfigOperation] ${operation.code} local commit failed`, error)
    }

    if (operation.source !== 'dialog') {
      notifyRenderer({
        kind: 'success',
        code: `${operation.code}.succeeded`,
        title: t('common.saved')
      })
    }
    retryOperation = null
    snapshot.value = { status: 'idle', version: snapshot.value.version + 1 }
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
    lastError.value = null
    if (snapshot.value.status !== 'idle') {
      snapshot.value = { status: 'idle', version: snapshot.value.version + 1 }
    }
  }

  return Object.freeze({
    snapshot,
    pending,
    source,
    lastError,
    run,
    retry,
    clear
  })
}
