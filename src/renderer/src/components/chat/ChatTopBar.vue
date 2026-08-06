<template>
  <div
    v-bind="attrs"
    class="dc-blur-panel sticky top-0 z-[var(--dc-z-sticky)] flex h-12 items-center justify-between bg-background/60 px-4 window-drag-region transition-[padding] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none"
    :class="{ 'pl-12': showCollapsedNewChatSpacer }"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <Transition name="collapsed-new-chat-button">
        <div
          v-if="showCollapsedNewChatButton"
          class="pointer-events-none absolute inset-x-0 top-0 h-12"
          style="z-index: var(--dc-z-sidepanel)"
        >
          <DcButton
            icon="lucide:plus"
            size="icon-sm"
            :label="t('common.newChat')"
            :tooltip="t('common.newChat')"
            data-testid="collapsed-new-chat-button"
            class="collapsed-new-chat-button pointer-events-auto absolute left-4 top-2.5"
            @click="handleCollapsedNewChat"
          />
        </div>
      </Transition>
      <DcButton
        v-if="parentSessionId"
        variant="ghost"
        size="sm"
        icon="lucide:corner-up-left"
        class="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        :title="t('chat.topbar.backToParent')"
        @click="handleBackToParent"
      >
        <span>{{ t('chat.topbar.backToParent') }}</span>
      </DcButton>
      <div v-if="project" class="flex items-center gap-1.5 text-muted-foreground">
        <Icon icon="lucide:folder" class="w-3.5 h-3.5 shrink-0" />
        <span class="text-xs truncate">{{ projectName }}</span>
        <Icon icon="lucide:chevron-right" class="w-3 h-3 shrink-0" />
      </div>
      <div v-if="isReadOnly" class="min-w-0 flex-1">
        <h2 class="text-sm font-medium truncate">{{ currentTitle }}</h2>
      </div>
      <div
        v-else
        class="title-inline-shell no-drag min-w-0 flex-1"
        :class="{ 'title-inline-shell--editing': isRenaming }"
      >
        <button
          v-if="!isRenaming"
          type="button"
          data-testid="chat-topbar-title-trigger"
          class="title-inline-trigger flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
          :title="t('thread.actions.rename')"
          :aria-label="t('thread.actions.rename')"
          @click="openRenameDialog"
        >
          <span class="truncate text-sm font-medium">{{ currentTitle }}</span>
          <Icon icon="lucide:pencil" class="title-inline-icon h-3.5 w-3.5 shrink-0" />
        </button>

        <div
          v-else
          class="title-inline-editor flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5"
        >
          <input
            ref="renameInputRef"
            v-model="renameValue"
            data-testid="chat-topbar-title-input"
            class="title-inline-input h-7 w-full min-w-0 flex-1 bg-transparent px-1 text-sm font-medium text-foreground outline-none"
            :aria-label="t('thread.actions.rename')"
            @click.stop
            @keydown="handleRenameInputKeydown"
          />

          <div class="flex shrink-0 items-center gap-0.5">
            <DcButton
              icon="lucide:x"
              size="icon-sm"
              :label="t('dialog.cancel')"
              :tooltip="t('dialog.cancel')"
              data-testid="chat-topbar-title-cancel"
              class="title-inline-action"
              @click="handleRenameCancel"
            />
            <DcButton
              icon="lucide:check"
              size="icon-sm"
              :label="t('dialog.confirm')"
              :tooltip="t('dialog.confirm')"
              data-testid="chat-topbar-title-save"
              class="title-inline-action text-primary hover:text-primary disabled:text-muted-foreground"
              :disabled="!canSubmitRename"
              @click="handleRenameConfirm"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-1 no-drag">
      <DcButton
        variant="ghost"
        icon="lucide:folder-tree"
        size="icon-sm"
        :label="t('chat.workspace.title')"
        :tooltip="t('chat.workspace.title')"
        @click="sidepanelStore.toggleWorkspace(props.sessionId)"
      />

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <DcButton
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
            :tooltip="t('chat.topbar.share')"
            :label="t('chat.topbar.share')"
          >
            <Icon icon="lucide:share" class="w-4 h-4" />
          </DcButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" class="w-52">
          <DcDropdownActionItem
            icon="lucide:file-text"
            :label="`${t('artifacts.markdownDocument')} (.md)`"
            @select="handleExport('markdown')"
          />
          <DcDropdownActionItem
            icon="lucide:globe"
            :label="`${t('artifacts.htmlDocument')} (.html)`"
            @select="handleExport('html')"
          />
          <DcDropdownActionItem
            icon="lucide:file-type"
            :label="`${t('thread.actions.exportText')} (.txt)`"
            @select="handleExport('txt')"
          />
          <DcDropdownActionItem
            icon="lucide:brain"
            :label="`${t('thread.actions.exportNowledgeMem')} (.json)`"
            @select="handleExport('nowledge-mem')"
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu v-if="!isReadOnly">
        <DropdownMenuTrigger as-child>
          <DcButton
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
            :tooltip="t('chat.topbar.more')"
          >
            <Icon icon="lucide:ellipsis" class="w-4 h-4" />
          </DcButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" class="w-48">
          <DcDropdownActionItem
            :icon="isPinned ? 'lucide:pin-off' : 'lucide:pin'"
            :label="isPinned ? t('thread.actions.unpin') : t('thread.actions.pin')"
            @select="handleTogglePin"
          />
          <DcDropdownActionItem
            icon="lucide:move-right"
            :label="t('thread.actions.moveConversation')"
            :disabled="!canMoveConversation"
            @select="openMoveDialog"
          />
          <DcDropdownActionItem
            icon="lucide:eraser"
            :label="t('thread.actions.cleanMessages')"
            @select="openClearDialog"
          />
          <DropdownMenuSeparator />
          <DcDropdownActionItem
            icon="lucide:trash-2"
            :label="t('thread.actions.delete')"
            danger
            @select="openDeleteDialog"
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>

  <DcConfirmDialog
    :open="clearDialogOpen"
    :title="t('dialog.cleanMessages.title')"
    :description="t('dialog.cleanMessages.description')"
    :confirm-label="t('dialog.cleanMessages.confirm')"
    :busy="clearDialogBusy"
    @update:open="handleClearDialogOpenChange"
    @confirm="handleClearConfirm"
  >
    <DcInlineError v-if="clearDialogError" :error="clearDialogError" />
  </DcConfirmDialog>

  <DcConfirmDialog
    :open="deleteDialogOpen"
    :title="t('dialog.delete.title')"
    :description="t('dialog.delete.description')"
    :confirm-label="t('dialog.delete.confirm')"
    :busy="deleteDialogBusy"
    @update:open="handleDeleteDialogOpenChange"
    @confirm="handleDeleteConfirm"
  >
    <DcInlineError v-if="deleteDialogError" :error="deleteDialogError" />
  </DcConfirmDialog>

  <AgentTransferDialog
    v-model:open="moveDialogOpen"
    mode="move-session"
    :source-agent-id="currentSession?.agentId ?? ''"
    :source-agent-name="currentAgentName"
    :agents="transferAgents"
    :session-title="currentTitle"
    :busy="moveDialogBusy"
    :error="moveDialogError"
    @confirm-move="handleMoveConfirm"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useAttrs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { DcInlineError } from '@dc-ui/components/inline-error'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { DcDropdownActionItem } from '@dc-ui/components/dropdown-action-item'
import AgentTransferDialog from '@/components/agent/AgentTransferDialog.vue'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useSidebarStore } from '@/stores/ui/sidebar'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

defineOptions({
  inheritAttrs: false
})

const props = defineProps<{
  sessionId: string
  title: string
  project: string
  isReadOnly?: boolean
}>()

const attrs = useAttrs()
const { t } = useI18n()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const sidepanelStore = useSidepanelStore()
const sidebarStore = useSidebarStore()

const isRenaming = ref(false)
const clearDialogOpen = ref(false)
const clearDialogBusy = ref(false)
const clearDialogError = ref<string | null>(null)
const deleteDialogOpen = ref(false)
const deleteDialogBusy = ref(false)
const deleteDialogError = ref<string | null>(null)
const moveDialogOpen = ref(false)
const moveDialogBusy = ref(false)
const moveDialogError = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

const showCollapsedNewChatButton = computed(
  () => sidebarStore.collapsed && Boolean(sessionStore.newConversationTargetAgentId)
)

const projectName = computed(() => props.project.split('/').pop() ?? props.project)
const currentSession = computed(
  () => sessionStore.sessions.find((session) => session.id === props.sessionId) ?? null
)
const currentTitle = computed(() => currentSession.value?.title ?? props.title)
const showCollapsedNewChatSpacer = computed(
  () => sidebarStore.collapsed && Boolean(sessionStore.newConversationTargetAgentId)
)
const parentSessionId = computed(() => currentSession.value?.parentSessionId ?? null)
const isPinned = computed(() => Boolean(currentSession.value?.isPinned))
const isReadOnly = computed(() => props.isReadOnly === true)
const currentAgent = computed(
  () => agentStore.agents.find((agent) => agent.id === currentSession.value?.agentId) ?? null
)
const currentAgentName = computed(
  () => currentAgent.value?.name ?? currentSession.value?.agentId ?? ''
)
const transferAgents = computed(() =>
  agentStore.enabledAgents
    .filter((agent) => agent.type === 'deepchat')
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      enabled: agent.enabled
    }))
)
const canMoveConversation = computed(
  () =>
    !isReadOnly.value &&
    currentSession.value?.sessionKind === 'regular' &&
    currentSession.value?.status !== 'working'
)
const normalizedRenameValue = computed(() => renameValue.value.trim())
const canSubmitRename = computed(
  () =>
    normalizedRenameValue.value.length > 0 &&
    normalizedRenameValue.value !== currentTitle.value.trim()
)

const handleCollapsedNewChat = () => {
  void sessionStore.startNewConversation({ refresh: true })
}

const openRenameDialog = async () => {
  if (isReadOnly.value) {
    return
  }
  renameValue.value = currentTitle.value
  isRenaming.value = true
  await nextTick()
  renameInputRef.value?.focus()
  renameInputRef.value?.select()
}

const resetRenameState = () => {
  renameValue.value = currentTitle.value
  isRenaming.value = false
}

const handleRenameCancel = () => {
  resetRenameState()
}

const handleRenameInputKeydown = (event: KeyboardEvent) => {
  if (event.isComposing) {
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    void handleRenameConfirm()
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    handleRenameCancel()
  }
}

const openClearDialog = () => {
  if (isReadOnly.value) {
    return
  }
  clearDialogError.value = null
  clearDialogOpen.value = true
}

const openDeleteDialog = () => {
  if (isReadOnly.value) {
    return
  }
  deleteDialogError.value = null
  deleteDialogOpen.value = true
}

const openMoveDialog = async () => {
  if (!canMoveConversation.value) {
    return
  }
  moveDialogError.value = null
  if (agentStore.agents.length === 0) {
    await agentStore.fetchAgents()
  }
  moveDialogOpen.value = true
}

const handleTogglePin = async () => {
  if (isReadOnly.value) {
    return
  }
  try {
    await sessionStore.toggleSessionPinned(props.sessionId, !isPinned.value)
  } catch (error) {
    console.error('Failed to toggle pin status:', error)
    notifyRenderer({
      kind: 'error',
      code: 'chat.session.pinFailed',
      title: t('common.error.operationFailed'),
      description: t('common.error.requestFailed')
    })
  }
}

const handleRenameConfirm = async () => {
  if (isReadOnly.value) {
    return
  }

  const normalized = normalizedRenameValue.value
  if (!normalized) {
    resetRenameState()
    return
  }

  if (normalized === currentTitle.value.trim()) {
    resetRenameState()
    return
  }

  try {
    await sessionStore.renameSession(props.sessionId, normalized)
    isRenaming.value = false
  } catch (error) {
    console.error(t('common.error.renameChatFailed'), error)
    notifyRenderer({
      kind: 'error',
      code: 'chat.session.renameFailed',
      title: t('common.error.operationFailed'),
      description: t('common.error.renameChatFailed')
    })
  }
}

watch(
  () => props.sessionId,
  () => {
    resetRenameState()
  }
)

watch(
  () => props.isReadOnly,
  (readOnly) => {
    if (readOnly) {
      resetRenameState()
    }
  }
)

const handleClearConfirm = async () => {
  if (isReadOnly.value || clearDialogBusy.value) {
    return
  }
  clearDialogBusy.value = true
  clearDialogError.value = null
  try {
    await sessionStore.clearSessionMessages(props.sessionId)
    clearDialogOpen.value = false
  } catch (error) {
    console.error(t('common.error.cleanMessagesFailed'), error)
    clearDialogError.value = t('common.error.requestFailed')
  } finally {
    clearDialogBusy.value = false
  }
}

const handleDeleteConfirm = async () => {
  if (isReadOnly.value || deleteDialogBusy.value) {
    return
  }
  deleteDialogBusy.value = true
  deleteDialogError.value = null
  try {
    await sessionStore.deleteSession(props.sessionId)
    deleteDialogOpen.value = false
  } catch (error) {
    console.error(t('common.error.deleteChatFailed'), error)
    deleteDialogError.value = t('common.error.requestFailed')
  } finally {
    deleteDialogBusy.value = false
  }
}

const handleClearDialogOpenChange = (open: boolean) => {
  if (!open && clearDialogBusy.value) return
  clearDialogOpen.value = open
  if (open) clearDialogError.value = null
}

const handleDeleteDialogOpenChange = (open: boolean) => {
  if (!open && deleteDialogBusy.value) return
  deleteDialogOpen.value = open
  if (open) deleteDialogError.value = null
}

const handleMoveConfirm = async (payload: { targetAgentId: string }) => {
  if (!canMoveConversation.value) {
    return
  }
  moveDialogBusy.value = true
  moveDialogError.value = null
  try {
    await sessionStore.moveSessionToAgent(props.sessionId, payload.targetAgentId)
    moveDialogOpen.value = false
  } catch (error) {
    moveDialogError.value = error instanceof Error ? error.message : String(error)
  } finally {
    moveDialogBusy.value = false
  }
}

const handleExport = async (format: 'markdown' | 'html' | 'txt' | 'nowledge-mem') => {
  try {
    await sessionStore.exportSession(props.sessionId, format)

    const isNowledgeMem = format === 'nowledge-mem'
    notifyRenderer({
      kind: 'success',
      code: 'chat.session.exported',
      title: isNowledgeMem ? t('thread.export.nowledgeMemSuccess') : t('thread.export.success'),
      description: isNowledgeMem
        ? t('thread.export.nowledgeMemSuccessDesc')
        : t('thread.export.successDesc')
    })
  } catch (error) {
    console.error('Export failed:', error)
    notifyRenderer({
      kind: 'error',
      code: 'chat.session.exportFailed',
      title: t('thread.export.failed'),
      description: t('thread.export.failedDesc')
    })
  }
}

const handleBackToParent = async () => {
  if (!parentSessionId.value) {
    return
  }

  try {
    await sessionStore.selectSession(parentSessionId.value)
  } catch (error) {
    console.error('Failed to navigate to parent session:', error)
  }
}
</script>

<style scoped>
.collapsed-new-chat-button-enter-active,
.collapsed-new-chat-button-leave-active {
  transition:
    opacity var(--dc-motion-fast) var(--dc-ease-out-soft),
    transform var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.collapsed-new-chat-button-enter-from,
.collapsed-new-chat-button-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.collapsed-new-chat-button-enter-to,
.collapsed-new-chat-button-leave-from {
  opacity: 1;
  transform: translateX(0);
}

@media (prefers-reduced-motion: reduce) {
  .collapsed-new-chat-button-enter-active,
  .collapsed-new-chat-button-leave-active {
    transition: none;
  }
}

.collapsed-new-chat-button {
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

.window-drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.title-inline-shell {
  border: 1px solid transparent;
  border-radius: 0.625rem;
  overflow: hidden;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.title-inline-shell:hover,
.title-inline-shell:focus-within {
  border-color: color-mix(in srgb, var(--border) 78%, transparent);
  background-color: color-mix(in srgb, var(--muted) 34%, transparent);
}

.title-inline-shell--editing {
  border-color: color-mix(in srgb, var(--border) 88%, transparent);
  background-color: color-mix(in srgb, var(--background) 90%, var(--muted) 10%);
  box-shadow: 0 14px 28px -24px rgb(15 23 42 / 0.65);
}

.title-inline-trigger {
  -webkit-app-region: no-drag;
}

.title-inline-icon {
  color: hsl(var(--muted-foreground));
  opacity: 0;
  transform: translateX(-2px);
  transition:
    opacity 160ms ease,
    transform 160ms ease,
    color 160ms ease;
}

.title-inline-shell:hover .title-inline-icon,
.title-inline-shell:focus-within .title-inline-icon {
  opacity: 1;
  transform: translateX(0);
}

.title-inline-editor,
.title-inline-input,
.title-inline-action {
  -webkit-app-region: no-drag;
}

.title-inline-input::placeholder {
  color: hsl(var(--muted-foreground));
}

button {
  -webkit-app-region: no-drag;
}
</style>
