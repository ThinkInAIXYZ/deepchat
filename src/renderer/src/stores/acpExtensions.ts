import type { AcpExtensionState } from '@shared/types/acp-extensions'
import { onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { createAcpExtensionsClient } from '@api/AcpExtensionsClient'
import { createSessionClient } from '@api/SessionClient'
import type {
  AcpElicitationView,
  AcpElicitationValue,
  AcpElicitationDecision
} from '@shared/types/acp-elicitation'

export const useAcpExtensionsStore = defineStore('acpExtensions', () => {
  const client = createAcpExtensionsClient()
  const states = ref<Record<string, AcpExtensionState | null>>(Object.create(null))
  const stateRequests = new Map<string, number>()
  onScopeDispose(
    createSessionClient().onUpdated(({ reason, sessionIds }) => {
      if (reason !== 'deleted') return
      for (const sessionId of sessionIds) {
        delete states.value[sessionId]
        stateRequests.delete(sessionId)
      }
    })
  )
  async function inspect(sessionId: string, agentId: string) {
    const sequence = (stateRequests.get(sessionId) ?? 0) + 1
    stateRequests.set(sessionId, sequence)
    try {
      const { state } = await client.inspect(sessionId, agentId)
      if (stateRequests.get(sessionId) !== sequence) return
      const previous = states.value[sessionId]
      if (
        state &&
        previous?.connectionId === state.connectionId &&
        previous.revision > state.revision
      )
        return
      states.value[sessionId] = state
    } catch {
      /* Preserve the last known snapshot when disconnected. */
    }
  }
  const unsubscribeState = client.onExtensionsChanged(({ conversationId, agentId }) => {
    void inspect(conversationId, agentId)
  })
  onScopeDispose(unsubscribeState)
  const requests = ref<AcpElicitationView[]>([])
  const values = ref<Record<string, Record<string, AcpElicitationValue>>>(Object.create(null))
  const errors = ref<Record<string, boolean>>(Object.create(null))
  const busy = ref(new Set<string>())
  const dockedConversationId = ref<string | null>(null)
  let refreshSequence = 0

  async function refresh() {
    const sequence = ++refreshSequence
    try {
      const snapshot = await client.listElicitations()
      if (sequence !== refreshSequence) return
      requests.value = snapshot.requests
      const ids = new Set(snapshot.requests.map((request) => request.requestId))
      for (const id of Object.keys(values.value))
        if (!ids.has(id)) {
          delete values.value[id]
          delete errors.value[id]
        }
      for (const request of requests.value) {
        if (values.value[request.requestId]) continue
        const defaults: Record<string, AcpElicitationValue> = Object.create(null)
        for (const field of request.fields) {
          const value = field.defaultValue
          if (
            !field.secret &&
            (typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean' ||
              (Array.isArray(value) && value.every((item) => typeof item === 'string')))
          )
            defaults[field.name] = value
        }
        values.value[request.requestId] = defaults
      }
    } catch {
      // A failed hydration must not discard unanswered forms or user input.
    }
  }

  function setValue(requestId: string, field: string, value: AcpElicitationValue | undefined) {
    const entries = values.value[requestId]
    if (!entries) return
    if (value === undefined) delete entries[field]
    else entries[field] = value
    delete errors.value[requestId]
  }

  async function respond(requestId: string, action: AcpElicitationDecision['action']) {
    if (busy.value.has(requestId)) return
    busy.value.add(requestId)
    delete errors.value[requestId]
    try {
      await client.respond({
        requestId,
        action,
        ...(action === 'accept' ? { content: values.value[requestId] } : {})
      })
      // Accepted answers are never retained for history, export, or a subsequent prompt.
      delete values.value[requestId]
      await refresh()
    } catch {
      errors.value[requestId] = true
    } finally {
      busy.value.delete(requestId)
    }
  }

  const unsubscribe = client.onElicitationChanged(() => {
    void refresh()
  })
  onScopeDispose(() => {
    unsubscribe()
    values.value = Object.create(null)
  })
  void refresh()
  return {
    states,
    inspect,
    requests,
    values,
    errors,
    busy,
    dockedConversationId,
    refresh,
    setValue,
    respond
  }
})
