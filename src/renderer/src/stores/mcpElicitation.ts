import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { createMcpClient } from '@api/McpClient'
import { createBrowserClient } from '@api/BrowserClient'
import type { McpElicitationDecision, McpElicitationRequestPayload } from '@shared/types/mcp'

import { readElicitationFields, isValidElicitationFormat } from '@shared/types/elicitation'

const MAX_PENDING_ELICITATION_REQUESTS = 32
const createFieldMap = <T>(): Record<string, T> => Object.create(null) as Record<string, T>

export const useMcpElicitationStore = defineStore('mcpElicitation', () => {
  const mcpClient = createMcpClient()
  const browserClient = createBrowserClient()
  const request = ref<McpElicitationRequestPayload | null>(null)
  const values = ref<Record<string, unknown>>(createFieldMap())
  const errors = ref<Record<string, string>>(createFieldMap())
  const isOpen = ref(false)
  const isSubmitting = ref(false)
  const queuedRequests = ref<McpElicitationRequestPayload[]>([])
  const eventCleanups: Array<() => void> = []

  const fields = computed(() => readElicitationFields(request.value?.requestedSchema))

  const clearCurrentRequest = () => {
    request.value = null
    values.value = createFieldMap()
    errors.value = createFieldMap()
    isOpen.value = false
    isSubmitting.value = false
  }

  const open = (next: McpElicitationRequestPayload) => {
    request.value = next
    const defaults = createFieldMap<unknown>()
    for (const field of fields.value) {
      if (field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue
      }
    }
    values.value = defaults
    errors.value = createFieldMap()
    isOpen.value = true
    isSubmitting.value = false
  }

  const openNextRequest = () => {
    const next = queuedRequests.value.shift()
    if (next) {
      open(next)
    }
  }

  const finishRequest = (requestId: string) => {
    if (request.value?.requestId === requestId) {
      clearCurrentRequest()
      openNextRequest()
      return
    }
    queuedRequests.value = queuedRequests.value.filter((queued) => queued.requestId !== requestId)
  }

  const queueOrOpenRequest = (next: McpElicitationRequestPayload) => {
    if (
      request.value?.requestId === next.requestId ||
      queuedRequests.value.some((queued) => queued.requestId === next.requestId)
    ) {
      return
    }
    if (!request.value) {
      open(next)
      return
    }
    if (queuedRequests.value.length >= MAX_PENDING_ELICITATION_REQUESTS - 1) {
      void mcpClient
        .cancelElicitationRequest(next.requestId, 'Too many pending elicitation requests')
        .catch((error) => {
          console.error('[MCP Elicitation] Failed to reject queued request:', error)
        })
      return
    }
    queuedRequests.value.push(next)
  }

  const setValue = (name: string, value: unknown) => {
    const nextValues = Object.assign(createFieldMap<unknown>(), values.value)
    nextValues[name] = value
    values.value = nextValues
    if (errors.value[name]) {
      const next = Object.assign(createFieldMap<string>(), errors.value)
      delete next[name]
      errors.value = next
    }
  }

  const validate = (): Record<string, unknown> | null => {
    const nextErrors = createFieldMap<string>()
    const content = createFieldMap<unknown>()
    for (const field of fields.value) {
      const value = values.value[field.name]
      const missing =
        value === undefined || value === null || (typeof value === 'string' && !value.trim())
      if (field.required && missing) {
        nextErrors[field.name] = 'required'
        continue
      }
      if (missing) {
        continue
      }
      if (field.type === 'number' || field.type === 'integer') {
        const parsed = typeof value === 'number' ? value : Number(value)
        if (!Number.isFinite(parsed) || (field.type === 'integer' && !Number.isInteger(parsed))) {
          nextErrors[field.name] = field.type
          continue
        }
        if (
          (field.minimum !== undefined && parsed < field.minimum) ||
          (field.maximum !== undefined && parsed > field.maximum)
        ) {
          nextErrors[field.name] = 'range'
          continue
        }
        content[field.name] = parsed
        continue
      }
      if (field.type === 'multi-select') {
        if (
          !Array.isArray(value) ||
          !value.every((entry) => typeof entry === 'string') ||
          (field.minItems !== undefined && value.length < field.minItems) ||
          (field.maxItems !== undefined && value.length > field.maxItems) ||
          value.some((entry) => !field.options?.some((option) => option.value === entry))
        ) {
          nextErrors[field.name] = 'selection'
          continue
        }
        content[field.name] = value
        continue
      }
      if (
        field.type === 'single-select' &&
        (typeof value !== 'string' || !field.options?.some((option) => option.value === value))
      ) {
        nextErrors[field.name] = 'selection'
        continue
      }
      if (field.type === 'boolean' && typeof value !== 'boolean') {
        nextErrors[field.name] = 'boolean'
        continue
      }
      if (
        typeof value === 'string' &&
        ((field.minLength !== undefined && value.length < field.minLength) ||
          (field.maxLength !== undefined && value.length > field.maxLength))
      ) {
        nextErrors[field.name] = 'length'
        continue
      }
      if (typeof value === 'string' && !isValidElicitationFormat(value, field.format)) {
        nextErrors[field.name] = 'format'
        continue
      }
      content[field.name] = value
    }
    errors.value = nextErrors
    return Object.keys(nextErrors).length === 0 ? content : null
  }

  const submit = async (decision: McpElicitationDecision) => {
    if (!request.value || request.value.requestId !== decision.requestId || isSubmitting.value) {
      return
    }
    const requestId = request.value.requestId
    isSubmitting.value = true
    try {
      await mcpClient.submitElicitationDecision(decision)
      finishRequest(requestId)
    } catch (error) {
      console.error('[MCP Elicitation] Failed to submit decision:', error)
      await mcpClient
        .cancelElicitationRequest(requestId, 'Elicitation decision submission failed')
        .catch(() => undefined)
      finishRequest(requestId)
    }
  }

  const accept = async () => {
    if (!request.value) {
      return
    }
    const content = request.value.mode === 'form' ? validate() : {}
    if (content === null) {
      return
    }
    await submit({
      requestId: request.value.requestId,
      action: 'accept',
      ...(request.value.mode === 'form' ? { content } : {})
    })
  }

  const decline = async () => {
    if (!request.value) {
      return
    }
    await submit({ requestId: request.value.requestId, action: 'decline' })
  }

  const cancel = async () => {
    if (!request.value) {
      clearCurrentRequest()
      return
    }
    await submit({ requestId: request.value.requestId, action: 'cancel' })
  }

  const openRequestedUrl = async () => {
    if (request.value?.mode === 'url' && request.value.url) {
      await browserClient.openExternal(request.value.url)
    }
  }

  // Subscribe at store setup top level (not in a component lifecycle hook) so the global
  // elicitation listeners are not lost when the first consuming component unmounts.
  const registerEvents = () => {
    const cleanups = [
      mcpClient.onElicitationRequest(({ request: next }) => queueOrOpenRequest(next)),
      mcpClient.onElicitationDecision(({ decision }) => {
        finishRequest(decision.requestId)
      }),
      mcpClient.onElicitationCancelled(({ requestId }) => {
        finishRequest(requestId)
      })
    ].filter((cleanup): cleanup is () => void => typeof cleanup === 'function')

    eventCleanups.push(...cleanups)
  }

  registerEvents()
  if (getCurrentScope()) {
    onScopeDispose(() => {
      while (eventCleanups.length > 0) {
        eventCleanups.pop()?.()
      }
    })
  }

  return {
    request,
    values,
    errors,
    fields,
    isOpen,
    isSubmitting,
    setValue,
    accept,
    decline,
    cancel,
    openRequestedUrl
  }
})
