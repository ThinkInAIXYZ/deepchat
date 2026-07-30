import { computed, onMounted, onUnmounted, ref } from 'vue'
import { defineStore } from 'pinia'
import { createMcpClient } from '@api/McpClient'
import type { McpAppConsentRequestPayload } from '@shared/types/mcp'

const MAX_PENDING_APP_CONSENTS = 32

export const useMcpAppConsentStore = defineStore('mcpAppConsent', () => {
  const mcpClient = createMcpClient()
  const queue = ref<McpAppConsentRequestPayload[]>([])
  const isSubmitting = ref(false)
  const eventCleanups: Array<() => void> = []
  const request = computed(() => queue.value[0] ?? null)
  const isOpen = computed(() => request.value !== null)

  const submit = async (approved: boolean) => {
    const current = request.value
    if (!current || isSubmitting.value) {
      return
    }
    isSubmitting.value = true
    try {
      await mcpClient.submitAppConsent(current.requestId, approved)
    } catch (error) {
      console.error('[MCP Apps] Failed to submit consent:', error)
    } finally {
      queue.value = queue.value.filter((entry) => entry.requestId !== current.requestId)
      isSubmitting.value = false
    }
  }

  onMounted(() => {
    eventCleanups.push(
      mcpClient.onAppConsentRequest(({ request: next }) => {
        if (queue.value.some((entry) => entry.requestId === next.requestId)) {
          return
        }
        if (queue.value.length >= MAX_PENDING_APP_CONSENTS) {
          void mcpClient.submitAppConsent(next.requestId, false).catch((error) => {
            console.error('[MCP Apps] Failed to reject queued consent:', error)
          })
          return
        }
        queue.value.push(next)
      })
    )
  })

  onUnmounted(() => {
    while (eventCleanups.length > 0) {
      eventCleanups.pop()?.()
    }
  })

  return {
    request,
    isOpen,
    isSubmitting,
    approve: () => submit(true),
    deny: () => submit(false)
  }
})
