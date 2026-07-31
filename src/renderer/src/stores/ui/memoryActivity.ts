import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { createMemoryClient, type MemoryUpdatedPayload } from '@api/MemoryClient'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { MemoryAddResult, MemoryItem, MemoryViewManifest } from '@shared/contracts/routes'
import { useAgentStore, type UIAgent } from './agent'
import { useMessageStore } from './message'
import { useSessionStore } from './session'

const MEMORY_DETAILS_BATCH_LIMIT = 50
const AMEND_SUCCESS_ACTIONS = new Set<MemoryAddResult['action']>([
  'created',
  'updated',
  'superseded',
  'challenged'
])

export type MemoryActivityItem = {
  id: string
  memory: MemoryItem
  busy: boolean
  error: string | null
}

export type MemoryChipDraft = {
  memoryId: string
  text: string
  carryoverItem: MemoryActivityItem | null
}

export type MemoryTurnDetail = {
  id: string
  memory: MemoryItem | null
}

export type MemoryTurnState = {
  messageId: string
  userMessageId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  manifest: MemoryViewManifest | null
  details: MemoryTurnDetail[]
  error: string | null
  stale: boolean
}

type OpenTurnMemoriesOptions = {
  force?: boolean
  background?: boolean
}

function registerStoreCleanup(cleanup: () => void): void {
  if (getCurrentScope()) {
    onScopeDispose(cleanup)
  }
}

function resolveAgentType(agent: UIAgent | undefined): 'deepchat' | 'acp' | null {
  if (!agent) return null
  return agent.agentType ?? agent.type
}

function createIdleTurnState(messageId: string): MemoryTurnState {
  return {
    messageId,
    userMessageId: null,
    status: 'idle',
    manifest: null,
    details: [],
    error: null,
    stale: false
  }
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique
}

export const useMemoryActivityStore = defineStore('memoryActivity', () => {
  const memoryClient = createMemoryClient()
  const sessionStore = useSessionStore()
  const agentStore = useAgentStore()
  const messageStore = useMessageStore()

  const chipItems = ref<MemoryActivityItem[]>([])
  const chipDraft = ref<MemoryChipDraft | null>(null)
  const selectedTurnMessageId = ref<string | null>(null)
  const turnCache = ref<Record<string, MemoryTurnState>>({})
  let chipRequestSeq = 0
  let turnRequestSeq = 0
  const turnRequestIds = new Map<string, number>()
  const turnInFlight = new Map<string, number>()
  const turnInvalidationVersions = new Map<string, number>()
  const turnFailedRefreshVersions = new Map<string, number>()
  const memoryMutationIds = new Set<string>()
  let turnRefreshQueued = false

  const activeSessionId = computed(() => sessionStore.activeSessionId)
  const activeAgentId = computed(() => sessionStore.activeSession?.agentId ?? null)
  const readOnly = computed(() => sessionStore.activeSession?.sessionKind === 'subagent')
  const activeAgent = computed(() =>
    activeAgentId.value
      ? agentStore.agents.find((agent) => agent.id === activeAgentId.value)
      : undefined
  )
  const enabled = computed(() => {
    const agent = activeAgent.value
    return resolveAgentType(agent) === 'deepchat' && agent?.config?.memoryEnabled === true
  })
  const displayChipItems = computed(() => {
    const draft = chipDraft.value
    if (!draft?.carryoverItem) return chipItems.value
    if (chipItems.value.some((item) => item.id === draft.memoryId)) return chipItems.value
    return [draft.carryoverItem, ...chipItems.value]
  })
  const hasChip = computed(() => enabled.value && displayChipItems.value.length > 0)
  const selectedTurn = computed(() =>
    selectedTurnMessageId.value ? turnCache.value[selectedTurnMessageId.value] : null
  )
  const isTurnPanelOpen = computed(() => selectedTurnMessageId.value !== null)

  function clearChip(): void {
    chipRequestSeq += 1
    chipItems.value = []
    chipDraft.value = null
  }

  function clearTurnCache(): void {
    turnRequestSeq += 1
    turnRequestIds.clear()
    turnInFlight.clear()
    turnInvalidationVersions.clear()
    turnFailedRefreshVersions.clear()
    turnRefreshQueued = false
    selectedTurnMessageId.value = null
    turnCache.value = {}
  }

  function updateChipItems(mapper: (item: MemoryActivityItem) => MemoryActivityItem): void {
    chipItems.value = chipItems.value.map(mapper)
    const draft = chipDraft.value
    if (draft?.carryoverItem) {
      chipDraft.value = {
        ...draft,
        carryoverItem: mapper(draft.carryoverItem)
      }
    }
  }

  function setChipItemBusy(
    memoryId: string,
    busy: boolean,
    options: { clearError?: boolean } = {}
  ): void {
    const clearError = options.clearError ?? true
    updateChipItems((item) =>
      item.id === memoryId ? { ...item, busy, error: clearError ? null : item.error } : item
    )
  }

  function setChipItemError(memoryId: string, error: string): void {
    updateChipItems((item) => (item.id === memoryId ? { ...item, busy: false, error } : item))
  }

  function removeChipItem(memoryId: string): void {
    chipItems.value = chipItems.value.filter((item) => item.id !== memoryId)
    if (chipDraft.value?.memoryId === memoryId) {
      chipDraft.value = null
    }
  }

  function markMemoryStatusInViews(memoryId: string, status: MemoryItem['status']): void {
    updateChipItems((item) =>
      item.id === memoryId ? { ...item, memory: { ...item.memory, status } } : item
    )
    const nextCache: Record<string, MemoryTurnState> = {}
    for (const [messageId, state] of Object.entries(turnCache.value)) {
      nextCache[messageId] = {
        ...state,
        details: state.details.map((detail) =>
          detail.id === memoryId && detail.memory
            ? { ...detail, memory: { ...detail.memory, status } }
            : detail
        )
      }
    }
    turnCache.value = nextCache
  }

  function markMemoryArchivedInViews(memoryId: string): void {
    markMemoryStatusInViews(memoryId, 'archived')
  }

  function isMemoryArchivedInViews(memoryId: string): boolean {
    if (
      displayChipItems.value.some(
        (item) => item.id === memoryId && item.memory.status === 'archived'
      )
    ) {
      return true
    }
    return Object.values(turnCache.value).some((state) =>
      state.details.some((detail) => detail.id === memoryId && detail.memory?.status === 'archived')
    )
  }

  function getChipItem(memoryId: string): MemoryActivityItem | undefined {
    return displayChipItems.value.find((item) => item.id === memoryId)
  }

  function isMemoryMutationBusy(memoryId: string): boolean {
    if (memoryMutationIds.has(memoryId)) return true
    return displayChipItems.value.some((item) => item.id === memoryId && item.busy)
  }

  function startChipEdit(item: MemoryActivityItem): void {
    if (item.busy || item.memory.status === 'archived') return
    chipDraft.value = {
      memoryId: item.id,
      text: item.memory.content,
      carryoverItem: null
    }
  }

  function setChipDraftText(text: string): void {
    const draft = chipDraft.value
    if (!draft) return
    chipDraft.value = { ...draft, text }
  }

  function cancelChipEdit(): void {
    chipDraft.value = null
  }

  function bumpTurnInvalidation(messageId: string): number {
    const nextVersion = (turnInvalidationVersions.get(messageId) ?? 0) + 1
    turnInvalidationVersions.set(messageId, nextVersion)
    turnFailedRefreshVersions.delete(messageId)
    return nextVersion
  }

  function shouldRefreshTurnCache(payload: MemoryUpdatedPayload): boolean {
    return payload.agentId === activeAgentId.value && enabled.value
  }

  function scheduleSelectedTurnRefresh(): void {
    const openMessageId = selectedTurnMessageId.value
    if (!openMessageId || !enabled.value || turnRefreshQueued) return
    const currentVersion = turnInvalidationVersions.get(openMessageId) ?? 0
    if (turnFailedRefreshVersions.get(openMessageId) === currentVersion) return
    turnRefreshQueued = true
    queueMicrotask(() => {
      turnRefreshQueued = false
      const nextOpenMessageId = selectedTurnMessageId.value
      if (!nextOpenMessageId || !enabled.value || !turnCache.value[nextOpenMessageId]?.stale) return
      const nextVersion = turnInvalidationVersions.get(nextOpenMessageId) ?? 0
      if (turnFailedRefreshVersions.get(nextOpenMessageId) === nextVersion) return
      void openTurnMemories(nextOpenMessageId, { force: true, background: true })
    })
  }

  function invalidateTurnCacheForUpdate(payload: MemoryUpdatedPayload): void {
    if (!shouldRefreshTurnCache(payload)) return
    const nextCache: Record<string, MemoryTurnState> = {}
    for (const [messageId, state] of Object.entries(turnCache.value)) {
      bumpTurnInvalidation(messageId)
      nextCache[messageId] = { ...state, stale: true }
    }
    turnCache.value = nextCache
    scheduleSelectedTurnRefresh()
  }

  async function loadChipMemories(
    agentId: string,
    sessionId: string,
    memoryIds: string[],
    requestId: number
  ): Promise<void> {
    try {
      const memories = await memoryClient.getByIds(agentId, uniqueIds(memoryIds))
      if (
        requestId !== chipRequestSeq ||
        activeAgentId.value !== agentId ||
        activeSessionId.value !== sessionId
      ) {
        return
      }
      const draft = chipDraft.value
      const draftItem = draft ? (getChipItem(draft.memoryId) ?? null) : null
      chipItems.value = memories.map((memory) => ({
        id: memory.id,
        memory,
        busy: false,
        error: null
      }))
      if (draft) {
        chipDraft.value = {
          ...draft,
          carryoverItem: chipItems.value.some((item) => item.id === draft.memoryId)
            ? null
            : draftItem
        }
      }
    } catch (error) {
      console.warn('[MemoryActivity] failed to load created memories', error)
    }
  }

  function handleMemoryUpdated(payload: MemoryUpdatedPayload): void {
    if (payload.agentId !== activeAgentId.value) return
    if (payload.reason === 'clear') {
      clearChip()
    } else if (payload.reason === 'delete') {
      if (payload.memoryId) {
        chipRequestSeq += 1
        removeChipItem(payload.memoryId)
      } else {
        clearChip()
      }
    }
    invalidateTurnCacheForUpdate(payload)
    if (!enabled.value || payload.reason !== 'extract') return
    const sessionId = activeSessionId.value
    const agentId = activeAgentId.value
    if (!sessionId || !agentId) return
    if (payload.agentId !== agentId || payload.sessionId !== sessionId) return
    if (!payload.createdIds?.length) return
    const requestId = ++chipRequestSeq
    void loadChipMemories(
      agentId,
      sessionId,
      uniqueIds(payload.createdIds).slice(0, MEMORY_DETAILS_BATCH_LIMIT),
      requestId
    )
  }

  function findTurnUserMessageId(assistantMessageId: string): string | null {
    const messages = [...(messageStore.messages as ChatMessageRecord[])].sort(
      (left, right) => left.orderSeq - right.orderSeq
    )
    const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId)
    if (assistantIndex < 0) return null
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role === 'user') return message.id
    }
    return null
  }

  function closeTurnPanel(): void {
    selectedTurnMessageId.value = null
  }

  async function openTurnMemories(
    messageId: string,
    options: OpenTurnMemoriesOptions = {}
  ): Promise<void> {
    selectedTurnMessageId.value = messageId
    if (!enabled.value) {
      turnCache.value = { ...turnCache.value, [messageId]: createIdleTurnState(messageId) }
      return
    }
    const cached = turnCache.value[messageId]
    const inFlightRequestId = turnInFlight.get(messageId)
    if (
      !options.force &&
      !cached?.stale &&
      (cached?.status === 'ready' ||
        (cached?.status === 'loading' && inFlightRequestId !== undefined))
    ) {
      return
    }
    if (
      options.background &&
      cached?.stale &&
      cached.status !== 'loading' &&
      inFlightRequestId !== undefined
    ) {
      return
    }
    const agentId = activeAgentId.value
    const sessionId = activeSessionId.value
    if (!agentId || !sessionId) return
    const userMessageId = findTurnUserMessageId(messageId)
    if (!userMessageId) {
      turnCache.value = {
        ...turnCache.value,
        [messageId]: {
          ...createIdleTurnState(messageId),
          status: 'error',
          error: 'user_message_unavailable'
        }
      }
      return
    }

    const requestId = ++turnRequestSeq
    const requestInvalidationVersion = turnInvalidationVersions.get(messageId) ?? 0
    turnRequestIds.set(messageId, requestId)
    turnInFlight.set(messageId, requestId)
    if (!options.background) {
      turnFailedRefreshVersions.delete(messageId)
    }
    const preserveReadyState =
      cached?.status === 'ready' && (options.background === true || cached.stale)
    if (preserveReadyState) {
      turnCache.value = {
        ...turnCache.value,
        [messageId]: {
          ...cached,
          userMessageId,
          error: null,
          stale: true
        }
      }
    } else {
      turnCache.value = {
        ...turnCache.value,
        [messageId]: {
          ...createIdleTurnState(messageId),
          userMessageId,
          status: 'loading'
        }
      }
    }

    try {
      const manifests = await memoryClient.listViewManifests(agentId, {
        sessionId,
        messageId: userMessageId,
        limit: 1
      })
      const manifest = manifests[0] ?? null
      let details: MemoryTurnDetail[] = []
      if (manifest?.selectedIds?.length) {
        const selectedIds = uniqueIds(manifest.selectedIds).slice(0, MEMORY_DETAILS_BATCH_LIMIT)
        const memories = await memoryClient.getByIds(agentId, selectedIds)
        const memoryById = new Map(memories.map((memory) => [memory.id, memory]))
        details = selectedIds.map((id) => ({ id, memory: memoryById.get(id) ?? null }))
      }
      if (
        turnRequestIds.get(messageId) !== requestId ||
        activeAgentId.value !== agentId ||
        activeSessionId.value !== sessionId
      ) {
        return
      }
      if ((turnInvalidationVersions.get(messageId) ?? 0) !== requestInvalidationVersion) {
        const current = turnCache.value[messageId]
        turnCache.value = {
          ...turnCache.value,
          [messageId]: current
            ? { ...current, stale: true }
            : { ...createIdleTurnState(messageId), stale: true }
        }
        return
      }
      turnCache.value = {
        ...turnCache.value,
        [messageId]: {
          messageId,
          userMessageId,
          status: 'ready',
          manifest,
          details,
          error: null,
          stale: false
        }
      }
    } catch (error) {
      console.warn('[MemoryActivity] failed to load turn memories', error)
      if (
        turnRequestIds.get(messageId) !== requestId ||
        activeAgentId.value !== agentId ||
        activeSessionId.value !== sessionId
      ) {
        return
      }
      const current = turnCache.value[messageId]
      const errorMessage = error instanceof Error ? error.message : String(error)
      if ((turnInvalidationVersions.get(messageId) ?? 0) !== requestInvalidationVersion) {
        turnCache.value = {
          ...turnCache.value,
          [messageId]: current
            ? { ...current, error: errorMessage, stale: true }
            : {
                ...createIdleTurnState(messageId),
                userMessageId,
                status: 'error',
                error: errorMessage,
                stale: true
              }
        }
        return
      }
      if (preserveReadyState && current?.status === 'ready') {
        turnFailedRefreshVersions.set(messageId, requestInvalidationVersion)
        turnCache.value = {
          ...turnCache.value,
          [messageId]: {
            ...current,
            error: errorMessage,
            stale: true
          }
        }
      } else {
        turnCache.value = {
          ...turnCache.value,
          [messageId]: {
            ...createIdleTurnState(messageId),
            userMessageId,
            status: 'error',
            error: errorMessage,
            stale: false
          }
        }
      }
    } finally {
      if (turnInFlight.get(messageId) === requestId) {
        turnInFlight.delete(messageId)
        if (selectedTurnMessageId.value === messageId && turnCache.value[messageId]?.stale) {
          scheduleSelectedTurnRefresh()
        }
      }
    }
  }

  async function undoCreated(memoryId: string): Promise<boolean> {
    const agentId = activeAgentId.value
    const item = getChipItem(memoryId)
    if (
      !agentId ||
      readOnly.value ||
      !item ||
      item.busy ||
      item.memory.status === 'archived' ||
      memoryMutationIds.has(memoryId)
    ) {
      return false
    }
    memoryMutationIds.add(memoryId)
    setChipItemBusy(memoryId, true)
    try {
      const result = await memoryClient.remove(agentId, memoryId)
      const ok = result.action === 'applied'
      if (ok) removeChipItem(memoryId)
      else setChipItemError(memoryId, 'delete_failed')
      return ok
    } catch (error) {
      console.warn('[MemoryActivity] failed to undo memory', error)
      setChipItemError(memoryId, error instanceof Error ? error.message : String(error))
      return false
    } finally {
      memoryMutationIds.delete(memoryId)
    }
  }

  async function forget(memoryId: string): Promise<boolean> {
    const agentId = activeAgentId.value
    if (!agentId || readOnly.value || isMemoryArchivedInViews(memoryId)) return false
    if (isMemoryMutationBusy(memoryId)) return false
    memoryMutationIds.add(memoryId)
    setChipItemBusy(memoryId, true)
    try {
      const result = await memoryClient.archive(agentId, memoryId)
      const ok = result.action === 'applied'
      if (ok) {
        markMemoryArchivedInViews(memoryId)
        setChipItemBusy(memoryId, false)
      } else {
        setChipItemError(memoryId, 'archive_failed')
      }
      return ok
    } catch (error) {
      console.warn('[MemoryActivity] failed to archive memory', error)
      setChipItemError(memoryId, error instanceof Error ? error.message : String(error))
      return false
    } finally {
      memoryMutationIds.delete(memoryId)
    }
  }

  async function amend(memoryId: string, content: string): Promise<MemoryAddResult | null> {
    const agentId = activeAgentId.value
    const sessionId = activeSessionId.value
    const normalized = content.trim()
    const item = getChipItem(memoryId)
    if (!agentId || !sessionId || !normalized || readOnly.value || !item) return null
    if (item.busy || item.memory.status === 'archived' || memoryMutationIds.has(memoryId)) {
      return null
    }
    memoryMutationIds.add(memoryId)
    setChipItemBusy(memoryId, true)
    let archived = false
    try {
      const archiveResult = await memoryClient.archive(agentId, memoryId)
      if (archiveResult.action === 'rejected') {
        setChipItemError(memoryId, 'archive_failed')
        return null
      }
      archived = true
      markMemoryArchivedInViews(memoryId)
      const addInput: Parameters<typeof memoryClient.add>[1] =
        item.memory.category != null
          ? {
              content: normalized,
              sessionId,
              importance: item.memory.importance,
              category: item.memory.category
            }
          : item.memory.kind === 'semantic' || item.memory.kind === 'episodic'
            ? {
                content: normalized,
                sessionId,
                importance: item.memory.importance,
                kind: item.memory.kind
              }
            : {
                content: normalized,
                sessionId,
                importance: item.memory.importance
              }
      const result = await memoryClient.add(agentId, addInput)
      if (AMEND_SUCCESS_ACTIONS.has(result.action)) {
        removeChipItem(memoryId)
        return result
      }
      const restoreResult = await memoryClient.restore(agentId, memoryId)
      if (restoreResult.action === 'applied') {
        markMemoryStatusInViews(memoryId, 'pending_embedding')
        setChipItemError(memoryId, 'amend_failed_retry')
      } else {
        setChipItemError(memoryId, 'amend_restore_failed')
      }
      return null
    } catch (error) {
      console.warn('[MemoryActivity] failed to amend memory', error)
      if (archived) {
        try {
          const restoreResult = await memoryClient.restore(agentId, memoryId)
          if (restoreResult.action === 'applied') {
            markMemoryStatusInViews(memoryId, 'pending_embedding')
            setChipItemError(memoryId, 'amend_failed_retry')
          } else {
            setChipItemError(memoryId, 'amend_restore_failed')
          }
        } catch (restoreError) {
          console.warn(
            '[MemoryActivity] failed to restore memory after amend failure',
            restoreError
          )
          setChipItemError(memoryId, 'amend_restore_failed')
        }
      } else {
        setChipItemError(memoryId, error instanceof Error ? error.message : String(error))
      }
      return null
    } finally {
      memoryMutationIds.delete(memoryId)
    }
  }

  async function rememberSelection(content: string): Promise<MemoryAddResult | null> {
    const agentId = activeAgentId.value
    const sessionId = activeSessionId.value
    const normalized = content.trim()
    if (!enabled.value || readOnly.value || !agentId || !sessionId || !normalized) return null
    try {
      return await memoryClient.add(agentId, { content: normalized, sessionId })
    } catch (error) {
      console.warn('[MemoryActivity] failed to remember selection', error)
      return null
    }
  }

  watch(activeSessionId, () => {
    clearChip()
    clearTurnCache()
  })

  watch(enabled, (nextEnabled) => {
    if (!nextEnabled) {
      clearChip()
      clearTurnCache()
    }
  })

  registerStoreCleanup(memoryClient.onUpdated(handleMemoryUpdated))

  return {
    chipItems,
    displayChipItems,
    chipDraft,
    selectedTurnMessageId,
    selectedTurn,
    isTurnPanelOpen,
    enabled,
    readOnly,
    hasChip,
    clearChip,
    startChipEdit,
    setChipDraftText,
    cancelChipEdit,
    openTurnMemories,
    closeTurnPanel,
    undoCreated,
    forget,
    amend,
    rememberSelection
  }
})
