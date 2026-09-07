import { computed, onMounted, onUnmounted, ref } from 'vue'
import { defineStore } from 'pinia'
import { createMcpClient } from '@api/McpClient'
import { createBrowserClient } from '@api/BrowserClient'
import type { McpElicitationDecision, McpElicitationRequestPayload } from '@shared/types/mcp'

type McpElicitationField = {
  name: string
  title: string
  description?: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'single-select' | 'multi-select'
  required: boolean
  options?: Array<{ value: string; title: string }>
  defaultValue?: unknown
  format?: 'date' | 'date-time' | 'email' | 'uri'
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const MAX_PENDING_ELICITATION_REQUESTS = 32

const createFieldMap = <T>(): Record<string, T> => Object.create(null) as Record<string, T>

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const readOptions = (
  rawOptions: unknown,
  legacyTitles?: unknown
): Array<{ value: string; title: string }> | undefined => {
  if (!Array.isArray(rawOptions)) {
    return undefined
  }
  const legacy = Array.isArray(legacyTitles) ? legacyTitles : []
  const options = rawOptions.flatMap((rawOption, index) => {
    if (typeof rawOption === 'string') {
      return [
        {
          value: rawOption,
          title: typeof legacy[index] === 'string' ? legacy[index] : rawOption
        }
      ]
    }
    if (
      isRecord(rawOption) &&
      typeof rawOption.const === 'string' &&
      typeof rawOption.title === 'string'
    ) {
      return [{ value: rawOption.const, title: rawOption.title }]
    }
    return []
  })
  return options.length > 0 ? options : undefined
}

const isValidFormat = (value: string, format: McpElicitationField['format']): boolean => {
  if (!format) {
    return true
  }
  if (format === 'email') {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  }
  if (format === 'date') {
    const timestamp = Date.parse(`${value}T00:00:00Z`)
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === value
    )
  }
  if (format === 'date-time') {
    return Number.isFinite(Date.parse(value))
  }
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

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

  const fields = computed<McpElicitationField[]>(() => {
    const schema = request.value?.requestedSchema
    if (!isRecord(schema) || !isRecord(schema.properties)) {
      return []
    }
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === 'string')
        : []
    )
    return Object.entries(schema.properties).map(([name, rawField]) => {
      const field = isRecord(rawField) ? rawField : {}
      const rawType = typeof field.type === 'string' ? field.type : 'string'
      const itemSchema = isRecord(field.items) ? field.items : undefined
      const singleOptions = readOptions(field.oneOf) ?? readOptions(field.enum, field.enumNames)
      const multiOptions = itemSchema
        ? (readOptions(itemSchema.anyOf) ?? readOptions(itemSchema.enum))
        : undefined
      const type: McpElicitationField['type'] =
        rawType === 'array' && multiOptions
          ? 'multi-select'
          : rawType === 'string' && singleOptions
            ? 'single-select'
            : rawType === 'number' || rawType === 'integer' || rawType === 'boolean'
              ? rawType
              : 'string'
      return {
        name,
        title: typeof field.title === 'string' ? field.title : name,
        description: typeof field.description === 'string' ? field.description : undefined,
        type,
        required: required.has(name),
        options: type === 'multi-select' ? multiOptions : singleOptions,
        defaultValue:
          field.default !== undefined
            ? field.default
            : type === 'boolean'
              ? false
              : type === 'multi-select'
                ? []
                : undefined,
        format:
          field.format === 'date' ||
          field.format === 'date-time' ||
          field.format === 'email' ||
          field.format === 'uri'
            ? field.format
            : undefined,
        minLength: finiteNumber(field.minLength),
        maxLength: finiteNumber(field.maxLength),
        minimum: finiteNumber(field.minimum),
        maximum: finiteNumber(field.maximum),
        minItems: finiteNumber(field.minItems),
        maxItems: finiteNumber(field.maxItems)
      }
    })
  })

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
      if (typeof value === 'string' && !isValidFormat(value, field.format)) {
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

  onMounted(() => {
    eventCleanups.push(
      mcpClient.onElicitationRequest(({ request: next }) => queueOrOpenRequest(next)),
      mcpClient.onElicitationDecision(({ decision }) => {
        finishRequest(decision.requestId)
      }),
      mcpClient.onElicitationCancelled(({ requestId }) => {
        finishRequest(requestId)
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
