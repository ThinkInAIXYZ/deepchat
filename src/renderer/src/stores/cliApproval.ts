import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { createApprovalClient } from '@api/ApprovalClient'
import type { DeepchatEventPayload } from '@shared/contracts/events'

const MAX_PENDING_CLI_APPROVALS = 32

type ApprovalRequest = DeepchatEventPayload<'approvals.requested'>

export const useCliApprovalStore = defineStore('cliApproval', () => {
  const client = createApprovalClient()
  const queue = shallowRef<ApprovalRequest[]>([])
  const isSubmitting = ref(false)
  const cleanups: Array<() => void> = []
  const request = computed(() => queue.value[0] ?? null)
  const isOpen = computed(() => request.value !== null)

  const remove = (requestId: string) => {
    queue.value = queue.value.filter((entry) => entry.requestId !== requestId)
  }

  const submit = async (decision: 'approved' | 'denied') => {
    const current = request.value
    if (!current || isSubmitting.value) return
    isSubmitting.value = true
    try {
      await client.resolve(current.requestId, decision)
      remove(current.requestId)
    } catch (error) {
      console.error('[CLI Approval] Failed to resolve approval:', error)
    } finally {
      isSubmitting.value = false
    }
  }

  onMounted(() => {
    cleanups.push(
      client.onRequested((next) => {
        if (queue.value.some((entry) => entry.requestId === next.requestId)) return
        if (queue.value.length >= MAX_PENDING_CLI_APPROVALS) {
          void client.resolve(next.requestId, 'denied').catch((error) => {
            console.error('[CLI Approval] Failed to reject queued approval:', error)
          })
          return
        }
        queue.value = [...queue.value, next]
      }),
      client.onClosed(({ requestId }) => remove(requestId))
    )
  })

  onUnmounted(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
  })

  return {
    request,
    isOpen,
    isSubmitting,
    approve: () => submit('approved'),
    deny: () => submit('denied')
  }
})
