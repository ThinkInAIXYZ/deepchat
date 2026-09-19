import { onUnmounted, ref } from 'vue'

export type DcFormSubmitStatus = 'idle' | 'submitting' | 'success' | 'error'

export interface DcFormSubmitOptions {
  /** 成功后保持 ✅ 反馈的时长（默认 1800ms） */
  successDuration?: number
  /** 失败后保持 ⚠ 反馈的时长（默认 1200ms） */
  errorDuration?: number
  onSuccess?: () => void
  onError?: (error: unknown) => void
}

export function useDcFormSubmit(options: DcFormSubmitOptions = {}) {
  const status = ref<DcFormSubmitStatus>('idle')
  const successDuration = options.successDuration ?? 1800
  const errorDuration = options.errorDuration ?? 1200
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const settle = (next: DcFormSubmitStatus, duration: number) => {
    status.value = next
    clearTimer()
    timer = setTimeout(() => {
      status.value = 'idle'
    }, duration)
  }

  const run = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (status.value === 'submitting') {
      return undefined
    }
    clearTimer()
    status.value = 'submitting'
    try {
      const result = await fn()
      settle('success', successDuration)
      options.onSuccess?.()
      return result
    } catch (error) {
      settle('error', errorDuration)
      options.onError?.(error)
      throw error
    }
  }

  const reset = () => {
    clearTimer()
    status.value = 'idle'
  }

  onUnmounted(clearTimer)

  return { status, run, reset }
}
