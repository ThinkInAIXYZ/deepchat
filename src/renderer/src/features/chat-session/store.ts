import { defineStore, storeToRefs } from 'pinia'
import { ref, computed, watch, onScopeDispose } from 'vue'
import { createChatClient } from '@api/ChatClient'
import { createSessionClient } from '@api/SessionClient'
import { getRuntimeWebContentsId } from '@api/runtime'
import type {
  CreateSessionInput,
  SessionWithState,
  SendMessageInput
} from '@shared/types/agent-interface'
import {
  useSessionStore,
  type UISession,
  type NewConversationProjectDirIntent,
  type StartNewConversationOptions,
  type CloseSessionOptions
} from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useDraftStore } from '@/stores/ui/draft'
import { useMessageStore } from '@/stores/ui/message'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { useAttachmentPreparationStore } from '@/stores/ui/attachmentPreparation'
import { bindSessionStoreIpc, type SessionStoreIpcBinding } from '@/stores/ui/sessionIpc'
import { completeOnboardingStep } from '@/lib/onboardingResume'
import { isAbortError } from '@/lib/errors'

type SubmissionRequestOptions = {
  submissionId?: string
  isCancellationRequested?: () => boolean
}

export const useChatSessionStore = defineStore('chat-session', () => {
  const projection = useSessionStore()
  const {
    sessions,
    activeSessionId,
    activeSessionSummary,
    bootstrapActiveSession,
    hasActiveSession,
    error
  } = storeToRefs(projection)
  const { clearActiveSessionSummary, commitSessionSnapshot, setSearchIntent, applySessionStatus } =
    projection
  const sessionClient = createSessionClient()
  const chatClient = createChatClient()
  const agentStore = useAgentStore()
  const draftStore = useDraftStore()
  const messageStore = useMessageStore()
  const pageRouter = usePageRouterStore()
  const attachmentPreparationStore = useAttachmentPreparationStore()
  const webContentsId = ref<number | null>(null)
  let activationNavigationRequestId = 0
  let newConversationProjectDirIntentId = 0
  const newConversationProjectDirIntent = ref<NewConversationProjectDirIntent | null>(null)
  let binding: SessionStoreIpcBinding | null = null
  let connectionGeneration = 0

  const setActiveSessionId = (id: string | null): void => {
    projection.setActiveSessionId(id)
    messageStore.setCurrentSessionId(id)
  }
  const applyRestoredSession = (session: SessionWithState | null): void => {
    projection.applyRestoredSession(session)
    syncSelectedAgentToSession(activeSessionId.value)
  }

  const createActivationNavigationRequest = (): number => {
    activationNavigationRequestId += 1
    return activationNavigationRequestId
  }

  const isCurrentActivationNavigation = (requestId: number, sessionId: string): boolean =>
    activationNavigationRequestId === requestId && activeSessionId.value === sessionId

  const newConversationTargetAgentId = computed(() => {
    return agentStore.enabledAgents.some((agent) => agent.id === draftStore.agentId)
      ? draftStore.agentId
      : 'deepchat'
  })

  const syncSelectedAgentToSession = (
    sessionId: string | null,
    availableSessions: UISession[] = sessions.value
  ): void => {
    if (!sessionId) {
      return
    }

    const targetSession =
      availableSessions.find((session) => session.id === sessionId) ??
      (bootstrapActiveSession.value?.id === sessionId ? bootstrapActiveSession.value : null)
    const targetAgentId = targetSession?.agentId?.trim()
    if (!targetAgentId || agentStore.selectedAgentId === targetAgentId) {
      return
    }

    agentStore.setSelectedAgent(targetAgentId)
  }

  const hydrateActiveSessionSummary = async (
    sessionId: string,
    activationRequestId: number
  ): Promise<void> => {
    try {
      const active = await sessionClient.getActive()
      if (
        isCurrentActivationNavigation(activationRequestId, sessionId) &&
        active.session?.id === sessionId
      ) {
        applyRestoredSession(active.session)
      }
    } catch (restoreError) {
      console.warn('[sessionStore] Failed to hydrate selected session:', restoreError)
    }
  }

  async function createSession(input: CreateSessionInput, options?: SubmissionRequestOptions) {
    error.value = null
    const requestId = createActivationNavigationRequest()
    try {
      const result = options?.submissionId
        ? await sessionClient.create(input, { submissionId: options.submissionId })
        : await sessionClient.create(input)
      const session = result.session
      setSearchIntent(session.id, input.search === true)
      const hasInitialTurn =
        input.message.trim().length > 0 ||
        (input.files?.length ?? 0) > 0 ||
        input.inlineItems?.some((item) => item.type === 'session') === true
      const attachmentPreparation = result.initialTurn?.attachmentPreparation
      const initialTurnNeedsUserAction = attachmentPreparation?.status === 'needs_user_action'
      const hasAcceptedInitialTurn = hasInitialTurn && !initialTurnNeedsUserAction
      if (initialTurnNeedsUserAction) {
        attachmentPreparationStore.stageInitialDraftRecovery({
          sessionId: session.id,
          input: {
            text: input.message,
            ...(input.files ? { files: input.files } : {}),
            ...(input.search === true ? { search: true } : {}),
            ...(input.activeSkills ? { activeSkills: input.activeSkills } : {}),
            ...(input.inlineItems ? { inlineItems: input.inlineItems } : {})
          },
          summary: attachmentPreparation
        })
      }
      // Creation is durable even if the user has navigated elsewhere while it was pending.
      commitSessionSnapshot(session)
      if (activationNavigationRequestId === requestId) {
        setActiveSessionId(session.id)
        applyRestoredSession(session)
        syncSelectedAgentToSession(session.id)
        pageRouter.goToChat(session.id)
      }
      if (hasAcceptedInitialTurn) {
        applySessionStatus(session.id, 'generating')
        await completeOnboardingStep('first-chat')
      }
      return result
    } catch (createError) {
      if (input.draftSessionId) {
        try {
          // A failed reply can still leave an accepted first message; open its conversation.
          const recovered = await sessionClient.restore(input.draftSessionId, 1)
          const session = recovered.session
          if (session && !session.isDraft && recovered.messages.length > 0) {
            commitSessionSnapshot(session)
            setSearchIntent(session.id, input.search === true)
            if (activationNavigationRequestId === requestId) {
              setActiveSessionId(session.id)
              applyRestoredSession(session)
              syncSelectedAgentToSession(session.id)
              pageRouter.goToChat(session.id)
            }
            await completeOnboardingStep('first-chat')
            return { session }
          }
        } catch (recoveryError) {
          console.warn('[sessionStore] Failed to recover adopted draft:', recoveryError)
        }
      }
      if (
        activationNavigationRequestId === requestId &&
        !(options?.isCancellationRequested?.() && isAbortError(createError))
      ) {
        error.value = `Failed to create session: ${createError}`
      }
      throw createError
    }
  }

  async function sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: SubmissionRequestOptions
  ): Promise<void> {
    error.value = null
    const previousStatus =
      sessions.value.find((session) => session.id === sessionId)?.status ??
      (activeSessionSummary.value?.id === sessionId ? activeSessionSummary.value.status : 'none')
    applySessionStatus(sessionId, 'generating')
    try {
      if (options?.submissionId) {
        await chatClient.sendMessage(sessionId, content, { submissionId: options.submissionId })
      } else {
        await chatClient.sendMessage(sessionId, content)
      }
      await completeOnboardingStep('first-chat')
    } catch (sendError) {
      if (options?.isCancellationRequested?.() && isAbortError(sendError)) {
        applySessionStatus(sessionId, previousStatus)
      } else {
        applySessionStatus(sessionId, 'error')
        error.value = `Failed to send message: ${sendError}`
      }
      throw sendError
    }
  }

  async function setSessionModel(
    sessionId: string,
    providerId: string,
    modelId: string
  ): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.setSessionModel(sessionId, providerId, modelId)
      commitSessionSnapshot(updated)
      if (activeSessionId.value === sessionId) {
        applyRestoredSession(updated)
        projection.synchronizeContextOccupancy(sessionId)
      }
      await completeOnboardingStep('switch-model')
    } catch (updateError) {
      error.value = `Failed to set session model: ${updateError}`
      throw updateError
    }
  }

  async function applyActivatedSession(sessionId: string, requestId: number): Promise<void> {
    if (activationNavigationRequestId !== requestId) return
    if (activeSessionId.value && activeSessionId.value !== sessionId)
      messageStore.clearStreamingState()
    if (activeSessionSummary.value?.id !== sessionId) clearActiveSessionSummary()
    syncSelectedAgentToSession(sessionId)
    setActiveSessionId(sessionId)
    await hydrateActiveSessionSummary(sessionId, requestId)
    if (isCurrentActivationNavigation(requestId, sessionId)) pageRouter.goToChat(sessionId)
  }

  function applyDeactivatedSession(options: CloseSessionOptions = {}): void {
    messageStore.clearStreamingState()
    clearActiveSessionSummary()
    setActiveSessionId(null)
    agentStore.setSelectedAgent(newConversationTargetAgentId.value)
    pageRouter.goToNewThread(options.refresh ? { refresh: true } : {})
  }

  async function selectSession(
    sessionId: string,
    expectedTapeIncarnationId?: string
  ): Promise<void> {
    error.value = null
    const requestId = createActivationNavigationRequest()
    if (expectedTapeIncarnationId !== undefined) {
      // Reference validation is part of navigation, so newer selections/close cancel it too.
      try {
        await sessionClient.resolveReference({ sessionId, expectedTapeIncarnationId })
      } catch (referenceError) {
        if (activationNavigationRequestId === requestId) throw referenceError
        return
      }
      if (activationNavigationRequestId !== requestId) return
    }
    try {
      await sessionClient.activate(sessionId)
      await applyActivatedSession(sessionId, requestId)
    } catch (selectError) {
      if (activationNavigationRequestId === requestId) {
        error.value = `Failed to select session: ${selectError}`
      }
    }
  }

  async function closeSession(options: CloseSessionOptions = {}): Promise<void> {
    error.value = null
    const requestId = createActivationNavigationRequest()
    try {
      await sessionClient.deactivate()
      if (activationNavigationRequestId !== requestId) {
        return
      }
      applyDeactivatedSession(options)
    } catch (closeError) {
      if (activationNavigationRequestId === requestId) {
        error.value = `Failed to close session: ${closeError}`
      }
    }
  }

  async function startNewConversation(options: StartNewConversationOptions = {}): Promise<void> {
    error.value = null

    createActivationNavigationRequest()
    if (options.agentId) {
      draftStore.agentId = options.agentId
    }
    const targetAgentId = newConversationTargetAgentId.value
    draftStore.agentId = targetAgentId

    newConversationProjectDirIntent.value = Object.prototype.hasOwnProperty.call(
      options,
      'projectDir'
    )
      ? {
          id: ++newConversationProjectDirIntentId,
          projectDir: options.projectDir?.trim() || null,
          consumed: false
        }
      : null

    if (hasActiveSession.value) {
      await closeSession({ refresh: options.refresh ?? true })
      return
    }

    if (agentStore.selectedAgentId !== targetAgentId) {
      agentStore.setSelectedAgent(targetAgentId)
    }

    pageRouter.goToNewThread({ refresh: options.refresh ?? true })
  }

  function consumeNewConversationProjectDirIntent(intentId: number): void {
    const intent = newConversationProjectDirIntent.value
    if (!intent || intent.id !== intentId || intent.consumed) {
      return
    }

    newConversationProjectDirIntent.value = { ...intent, consumed: true }
  }

  watch(
    () => projection.activeSession?.agentId,
    () => syncSelectedAgentToSession(activeSessionId.value),
    { flush: 'sync' }
  )

  const applyBootstrapShell = async (
    input: Parameters<typeof projection.applyBootstrapShell>[0]
  ): Promise<void> => {
    if (activeSessionId.value && activeSessionId.value !== input.activeSessionId)
      messageStore.clearStreamingState()
    await projection.applyBootstrapShell(input)
    messageStore.setCurrentSessionId(projection.activeSessionId)
    syncSelectedAgentToSession(projection.activeSessionId)
  }

  const removeSessions = (ids: string[]): void => {
    const removedActive = activeSessionId.value !== null && ids.includes(activeSessionId.value)
    projection.removeSessions(ids)
    if (removedActive) {
      createActivationNavigationRequest()
      messageStore.clearStreamingState()
      messageStore.setCurrentSessionId(null)
      pageRouter.goToNewThread()
    }
  }

  function disconnect(): void {
    connectionGeneration += 1
    createActivationNavigationRequest()
    binding?.cleanup()
    binding = null
    webContentsId.value = null
  }

  function connect(): () => void {
    if (binding) return disconnect
    const generation = ++connectionGeneration
    binding = bindSessionStoreIpc({
      webContentsId: () => webContentsId.value,
      fetchSessions: projection.fetchSessions,
      refreshSessionsByIds: projection.refreshSessionsByIds,
      removeSessions,
      onSynchronized: async (ids) => {
        for (const id of ids) messageStore.invalidateRecentSessionView(id)
        const id = activeSessionId.value
        if (id && ids.includes(id)) await messageStore.loadMessages(id)
      },
      onImported: async (mode) => {
        const replacedIds = mode === 'overwrite' ? sessions.value.map((session) => session.id) : []
        if (mode === 'overwrite' && activeSessionId.value) replacedIds.push(activeSessionId.value)
        if (replacedIds.length) removeSessions(replacedIds)
        projection.invalidateHistory(mode)
        await projection.fetchSessions()
      },
      onActivated: (sessionId) =>
        applyActivatedSession(sessionId, createActivationNavigationRequest()),
      onDeactivated: () => {
        createActivationNavigationRequest()
        applyDeactivatedSession()
      },
      onStatusChanged: (sessionId, status, version) => {
        const applied = projection.applySessionStatus(sessionId, status, version)
        if (applied && activeSessionId.value === sessionId && status !== 'generating')
          projection.synchronizeContextOccupancy(sessionId)
      },
      onCompactionChanged: projection.handleCompactionChanged
    })
    void getRuntimeWebContentsId()
      .then((id) => {
        if (connectionGeneration !== generation || !binding) return
        webContentsId.value = id
        binding.flushPendingTargetedUpdate()
      })
      .catch((error) =>
        console.warn('[ChatSession] Failed to resolve runtime webContents id:', error)
      )
    return () => {
      if (connectionGeneration === generation) disconnect()
    }
  }
  onScopeDispose(disconnect)

  return {
    createSession,
    sendMessage,
    setSessionModel,
    selectSession,
    closeSession,
    startNewConversation,
    consumeNewConversationProjectDirIntent,
    newConversationProjectDirIntent,
    newConversationTargetAgentId,
    applyBootstrapShell,
    connect
  }
})
