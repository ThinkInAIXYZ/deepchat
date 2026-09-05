import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { JSONContent } from '@tiptap/core'
import type { MessageFile } from '@shared/types/agent-interface'
import { useDraftStore } from '@/stores/ui/draft'
import {
  applyAcceptedComposerSubmission,
  composerDocumentsMatch,
  composerDraftFingerprint,
  copyComposerDraft,
  createComposerTextDocument,
  type ComposerSessionDraft,
  type ComposerSubmissionSnapshot
} from '@/features/chat-page/model/composerDraftState'
import {
  DRAFT_PERSISTENCE_DEBOUNCE_MS,
  saveComposerDraftToStorage
} from '@/features/chat-page/model/composerDraftPersistence'

type ComposerHandle = {
  getDocumentSnapshot?: () => JSONContent
  restoreDocumentSnapshot?: (document: JSONContent) => void
  getPendingSkillsSnapshot?: () => string[]
  setPendingSkills?: (skills: string[]) => void
  clearPendingSkills?: () => void
}

export function useNewThreadComposerDraft(
  agentId: () => string | null,
  input: Ref<ComposerHandle | null>
) {
  const store = useDraftStore()
  const activeAgentId = ref(agentId() ?? 'deepchat')
  store.getNewThreadComposerDraft(activeAgentId.value)
  const draft = computed(() => store.newThreadComposerDrafts.get(activeAgentId.value)!)
  let restoring = true
  let disposed = false
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  function updateDraft(patch: Partial<ComposerSessionDraft>) {
    const next = { ...draft.value, ...patch }
    if (composerDraftFingerprint(next) === composerDraftFingerprint(draft.value)) return
    store.setNewThreadComposerDraft(activeAgentId.value, {
      ...next,
      revision: draft.value.revision + 1
    })
  }

  const message = computed({
    get: () => draft.value.rawMessage,
    set: (rawMessage: string) => {
      updateDraft({ rawMessage, document: createComposerTextDocument(rawMessage) })
    }
  })
  const attachedFiles = computed({
    get: () => draft.value.files,
    set: (files: MessageFile[]) => updateDraft({ files })
  })

  function recordComposerChange() {
    if (restoring || disposed || !input.value) return
    updateDraft({
      document: input.value.getDocumentSnapshot?.() ?? draft.value.document,
      activeSkills: input.value.getPendingSkillsSnapshot?.() ?? draft.value.activeSkills
    })
  }

  function onMessageChange(rawMessage: string) {
    if (restoring || disposed) return
    updateDraft({
      rawMessage,
      document: input.value?.getDocumentSnapshot?.() ?? createComposerTextDocument(rawMessage)
    })
  }

  function onPendingSkillsChange(activeSkills: string[]) {
    if (!restoring && !disposed) updateDraft({ activeSkills })
  }

  function persistDraft() {
    recordComposerChange()
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    saveComposerDraftToStorage(`new-thread:${activeAgentId.value}`, draft.value)
  }

  watch(
    draft,
    (next, previous) => {
      const document = input.value?.getDocumentSnapshot?.()
      if (
        next.document !== previous.document &&
        document &&
        !composerDocumentsMatch(document, next.document)
      ) {
        restoring = true
      }
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(persistDraft, DRAFT_PERSISTENCE_DEBOUNCE_MS)
    },
    { flush: 'sync' }
  )

  watch(
    agentId,
    (nextAgentId) => {
      persistDraft()
      if (!nextAgentId || nextAgentId === activeAgentId.value) return
      restoring = true
      store.getNewThreadComposerDraft(nextAgentId)
      activeAgentId.value = nextAgentId
    },
    { flush: 'sync' }
  )

  watch(
    [draft, input],
    () => {
      const handle = input.value
      if (!handle || disposed) return
      const snapshot = copyComposerDraft(draft.value)
      if (
        JSON.stringify(handle.getPendingSkillsSnapshot?.()) !==
        JSON.stringify(snapshot.activeSkills)
      ) {
        if (snapshot.activeSkills.length === 0) {
          handle.clearPendingSkills?.()
        } else {
          handle.setPendingSkills?.(snapshot.activeSkills)
        }
      }
      const document = handle.getDocumentSnapshot?.()
      if (!document || !composerDocumentsMatch(document, snapshot.document)) {
        handle.restoreDocumentSnapshot?.(snapshot.document)
      }
      restoring = false
    },
    { flush: 'post' }
  )

  function captureDraft(): ComposerSessionDraft {
    recordComposerChange()
    return copyComposerDraft(draft.value)
  }

  function acceptSubmission(targetAgentId: string, snapshot: ComposerSubmissionSnapshot) {
    const current = store.getNewThreadComposerDraft(targetAgentId)
    const next = applyAcceptedComposerSubmission(current, snapshot)
    store.setNewThreadComposerDraft(targetAgentId, next)
    saveComposerDraftToStorage(`new-thread:${targetAgentId}`, next)
  }

  window.addEventListener('pagehide', persistDraft)
  window.addEventListener('beforeunload', persistDraft)
  onBeforeUnmount(() => {
    persistDraft()
    disposed = true
    window.removeEventListener('pagehide', persistDraft)
    window.removeEventListener('beforeunload', persistDraft)
  })

  return {
    message,
    attachedFiles,
    onMessageChange,
    onPendingSkillsChange,
    recordComposerChange,
    captureDraft,
    acceptSubmission
  }
}
