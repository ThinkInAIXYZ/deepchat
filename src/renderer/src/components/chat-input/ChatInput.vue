<template>
  <div
    :class="['w-full', variant === 'newThread' ? 'max-w-xl mx-auto' : '']"
    @dragenter.prevent="drag.handleDragEnter"
    @dragover.prevent="drag.handleDragOver"
    @drop.prevent="handleDrop"
    @dragleave.prevent="drag.handleDragLeave"
    @paste="files.handlePaste"
  >
    <TooltipProvider>
      <div
        ref="inputContainer"
        :dir="langStore.dir"
        :style="
          variant === 'newThread'
            ? inputHeight
              ? { height: `${inputHeight}px` }
              : { maxHeight: '50vh' }
            : {}
        "
        :class="['flex flex-col gap-2 relative px-3']"
      >
        <!-- Resize Handle -->
        <ResizeHandle
          v-if="variant === 'agent' || variant === 'acp'"
          @resize="handleResizeHeight"
        />
        <!-- File Area -->
        <div v-if="files.selectedFiles.value.length > 0">
          <TransitionGroup
            name="file-list"
            tag="div"
            class="flex flex-wrap gap-1.5"
            enter-active-class="transition-all duration-300 ease-in-out"
            leave-active-class="transition-all duration-300 ease-in-out"
            enter-from-class="opacity-0 -translate-y-2"
            leave-to-class="opacity-0 -translate-y-2"
            move-class="transition-transform duration-300 ease-in-out"
          >
            <FileItem
              v-for="(file, idx) in files.selectedFiles.value"
              :key="file.metadata.fileName"
              :file-name="file.metadata.fileName"
              :deletable="true"
              :mime-type="file.mimeType"
              :tokens="file.token"
              :thumbnail="file.thumbnail"
              :context="'input'"
              @click="previewFile(file.path)"
              @delete="files.deleteFile(idx)"
            />
          </TransitionGroup>
        </div>

        <div
          class="w-full flex flex-col border border-input outline-1 outline-black/10 p-3 bg-card rounded-lg"
        >
          <!-- Editor -->
          <InputEditor
            ref="editorContainer"
            :editor="editor"
            :variant="variant"
            :show-fake-caret="showFakeCaret"
            :fake-caret-style="fakeCaretStyle"
            @keydown="onKeydown"
          />

          <!-- Footer -->
          <div class="flex items-center justify-between">
            <!-- Tools -->
            <InputToolbar :conversation-id="conversationId" @file-select="files.openFilePicker" />

            <!-- Hidden file input -->
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              multiple
              accept="application/json,application/javascript,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,application/vnd.ms-excel.sheet.binary.macroEnabled.12,application/vnd.apple.numbers,text/markdown,application/x-yaml,application/xml,application/typescript,text/typescript,text/x-typescript,application/x-typescript,application/x-sh,text/*,application/pdf,image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/html,text/css,application/xhtml+xml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.rs,.swift,.kt,.scala,.pl,.lua,.sh,.json,.yaml,.yml,.xml,.html,.htm,.css,.md,audio/mp3,audio/wav,audio/mp4,audio/mpeg,.mp3,.wav,.m4a"
              @change="files.handleFileSelect"
            />

            <!-- Actions -->
            <InputActions
              :variant="variant"
              :should-show-context-length="!!shouldShowContextLength"
              :current-context-length-text="currentContextLengthText"
              :context-length-status-class="contextLengthStatusClass"
              :rate-limit-status="rateLimit.rateLimitStatus.value"
              :rate-limit-status-class="rateLimit.getRateLimitStatusClass()"
              :rate-limit-tooltip="rateLimit.getRateLimitStatusTooltip()"
              :rate-limit-icon="rateLimit.getRateLimitStatusIcon()"
              :rate-limit-queue-text="
                t('chat.input.rateLimitQueue', {
                  count: rateLimit.rateLimitStatus.value?.queueLength ?? 0
                })
              "
              :can-send-immediately="rateLimit.canSendImmediately.value"
              :rate-limit-wait-time="rateLimit.formatWaitTime()"
              :is-streaming="isStreaming"
              :disabled-send="disabledSend"
              @send="emitSend"
              @cancel="handleCancel"
            >
              <template #addon-actions>
                <slot name="addon-actions"></slot>
              </template>
            </InputActions>
          </div>

          <!-- Drag Overlay -->
          <div v-if="drag.isDragging.value" class="absolute inset-0 bg-black/40 rounded-lg">
            <div class="flex flex-col items-center justify-center h-full gap-2">
              <div class="flex items-center gap-1">
                <Icon icon="lucide:file-up" class="w-4 h-4 text-white" />
                <span class="text-sm text-white">{{ t('chat.input.dropFiles') }}</span>
              </div>
              <div class="flex items-center gap-1">
                <Icon icon="lucide:clipboard" class="w-3 h-3 text-white/80" />
                <span class="text-xs text-white/80">{{ t('chat.input.pasteFiles') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Bar -->
      <InputFooter>
        <template #left-area>
          <ModeSelector
            v-if="variant === 'agent' || variant === 'acp'"
            :current-mode="chatMode.currentMode.value"
            :current-label="chatMode.currentLabel.value"
            :current-icon="chatMode.currentIcon.value"
            :acp-agent-options="acpAgentOptions"
            :selected-acp-agent-id="selectedAcpAgentId"
            @mode-select="handleModeSelect"
            @acp-agent-select="handleAcpAgentSelect"
          />
          <AcpModeSelector
            v-if="variant === 'acp' && acpMode.isAcpModel.value && acpMode.hasAgentModes.value"
            :current-mode="acpMode.currentMode.value"
            :current-mode-name="acpMode.currentModeName.value"
            :current-mode-info="acpMode.currentModeInfo.value ?? null"
            :available-modes="acpMode.availableModes.value"
            :loading="acpMode.loading.value"
            @mode-select="handleAcpModeSelect"
          />
        </template>

        <template #right-area>
          <AcpSessionModelSelector
            v-if="showAcpSessionModelSelector"
            :active-model="config.activeModel.value"
            :acp-session-model="{
              hasModels: acpSessionModel.hasModels.value,
              availableModels: acpSessionModel.availableModels.value,
              currentModelId: acpSessionModel.currentModelId.value,
              currentModelName: acpSessionModel.currentModelName.value,
              loading: acpSessionModel.loading.value
            }"
            :is-dark="themeStore.isDark"
            @acp-session-model-select="handleAcpSessionModelSelect"
          />
          <ModelSelector
            v-else-if="variant === 'agent' || variant === 'newThread'"
            :active-model="config.activeModel.value"
            :model-display-name="config.modelDisplayName.value"
            :is-dark="themeStore.isDark"
            @model-update="config.handleModelUpdate"
          />
        </template>

        <!-- <template #config-button>
          <ConfigButton
            v-if="(variant === 'agent' || variant === 'newThread') && !isAcpChatMode"
            :system-prompt="config.configSystemPrompt.value"
            :temperature="config.configTemperature.value"
            :context-length="config.configContextLength.value"
            :max-tokens="config.configMaxTokens.value"
            :artifacts="config.configArtifacts.value"
            :thinking-budget="config.configThinkingBudget.value ?? undefined"
            :enable-search="config.configEnableSearch.value"
            :forced-search="config.configForcedSearch.value"
            :search-strategy="config.configSearchStrategy.value as 'turbo' | 'max' | undefined"
            :reasoning-effort="
              config.configReasoningEffort.value as
                | 'minimal'
                | 'low'
                | 'medium'
                | 'high'
                | undefined
            "
            :verbosity="config.configVerbosity.value as 'low' | 'medium' | 'high' | undefined"
            :context-length-limit="config.configContextLengthLimit.value"
            :max-tokens-limit="config.configMaxTokensLimit.value"
            :model-id="chatStore.chatConfig.modelId"
            :provider-id="chatStore.chatConfig.providerId"
            :model-type="config.configModelType.value"
            @update:system-prompt="config.configSystemPrompt.value = $event"
            @update:temperature="config.configTemperature.value = $event"
            @update:context-length="config.configContextLength.value = $event"
            @update:max-tokens="config.configMaxTokens.value = $event"
            @update:artifacts="config.configArtifacts.value = $event ? 1 : 0"
            @update:thinking-budget="config.configThinkingBudget.value = $event"
            @update:enable-search="config.configEnableSearch.value = $event"
            @update:forced-search="config.configForcedSearch.value = $event"
            @update:search-strategy="config.configSearchStrategy.value = $event"
            @update:reasoning-effort="config.configReasoningEffort.value = $event"
            @update:verbosity="config.configVerbosity.value = $event"
          />
        </template> -->
      </InputFooter>
    </TooltipProvider>

    <!-- ACP Workdir Change Confirmation Dialog -->
    <AlertDialog
      :open="workspace.showWorkdirChangeConfirm.value"
      @update:open="(open) => !open && workspace.cancelWorkdirChange()"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('chat.input.acpWorkdirChangeTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('chat.input.acpWorkdirChangeDescription') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="workspace.cancelWorkdirChange">
            {{ t('chat.input.acpWorkdirChangeCancel') }}
          </AlertDialogCancel>
          <AlertDialogAction @click="workspace.confirmWorkdirChange">
            {{ t('chat.input.acpWorkdirChangeConfirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
// === Vue Core ===
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// === Types ===

// === Components ===
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@shadcn/components/ui/alert-dialog'
import { Editor } from '@tiptap/vue-3'
import { TextSelection } from '@tiptap/pm/state'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import History from '@tiptap/extension-history'
import Placeholder from '@tiptap/extension-placeholder'
import HardBreak from '@tiptap/extension-hard-break'
import FileItem from '../FileItem.vue'
import ResizeHandle from './ResizeHandle.vue'
import InputEditor from './InputEditor.vue'
import InputToolbar from './InputToolbar.vue'
import InputActions from './InputActions.vue'
import InputFooter from './InputFooter.vue'
import ModeSelector from './ModeSelector.vue'
import AcpModeSelector from './AcpModeSelector.vue'
import ModelSelector from './ModelSelector.vue'
import AcpSessionModelSelector from './AcpSessionModelSelector.vue'
import { Icon } from '@iconify/vue'

// === Composables ===
import { useWindowAdapter } from '@/composables/window/useWindowAdapter'
import { useInputHistory } from './composables/useInputHistory'
import { useRateLimitStatus } from './composables/useRateLimitStatus'
import { useDragAndDrop } from './composables/useDragAndDrop'
import { usePromptInputFiles } from './composables/usePromptInputFiles'
import { useMentionData } from './composables/useMentionData'
import { useSlashMentionData } from './composables/useSlashMentionData'
import { useSkillsData } from './composables/useSkillsData'
import { usePromptInputConfig } from './composables/usePromptInputConfig'
import { usePromptInputEditor } from './composables/usePromptInputEditor'
import { useInputSettings } from './composables/useInputSettings'
import { useContextLength } from './composables/useContextLength'
import { useSendButtonState } from './composables/useSendButtonState'
import { useComposerSubmission } from './composables/useComposerSubmission'
import { useComposerDraft } from './composables/useComposerDraft'
import { useAcpWorkdir } from './composables/useAcpWorkdir'
import { useAcpMode } from './composables/useAcpMode'
import { useAcpSessionModel } from './composables/useAcpSessionModel'
import { useChatMode } from './composables/useChatMode'
import { useAgentWorkspace } from './composables/useAgentWorkspace'
import { useWorkspaceMention } from './composables/useWorkspaceMention'
import { useChatInputModeSelection } from './composables/useChatInputModeSelection'

// === Stores ===
import { useChatStore } from '@/stores/chat'
import { useLanguageStore } from '@/stores/language'
import { useModelStore } from '@/stores/modelStore'
import { useThemeStore } from '@/stores/theme'

// === Mention System ===
import { Mention } from '../editor/mention/mention'
import { SlashMention } from '../editor/mention/slashMention'
import suggestion, {
  setPromptFilesHandler,
  setWorkspaceMention
} from '../editor/mention/suggestion'
import slashSuggestion, { setSkillActivationHandler } from '../editor/mention/slashSuggestion'
import { mentionData, type CategorizedData } from '../editor/mention/suggestion'
import { useEventListener } from '@vueuse/core'
import { ModelType } from '@shared/model'

// === Props & Emits ===
const props = withDefaults(
  defineProps<{
    variant: 'agent' | 'newThread' | 'acp'
    contextLength?: number
    maxRows?: number
    rows?: number
    disabled?: boolean
    modelInfo?: { id: string; providerId: string } | null
  }>(),
  {
    variant: 'agent',
    maxRows: 10,
    rows: 1,
    disabled: false,
    modelInfo: null
  }
)

const emit = defineEmits(['send', 'file-upload', 'model-update'])

// === Resize Logic ===
const inputHeight = ref<number | null>(null)

const handleResizeHeight = (newHeight: number) => {
  inputHeight.value = newHeight
}

// === Stores ===
const chatStore = useChatStore()
const langStore = useLanguageStore()
const modelStore = useModelStore()
const themeStore = useThemeStore()

const windowAdapter = useWindowAdapter()

// === i18n ===
const { t } = useI18n()

// === Local State ===
const fileInput = ref<HTMLInputElement>()
const editorContainer = ref<InstanceType<typeof InputEditor> | null>(null)
const caretPosition = ref({ x: 0, y: 0, height: 18 })
const caretVisible = ref(false)
const fakeCaretStyle = computed(() => ({
  transform: `translate(${caretPosition.value.x}px, ${caretPosition.value.y}px)`,
  height: `${caretPosition.value.height}px`
}))
const showFakeCaret = computed(() => caretVisible.value && !props.disabled)

// === Composable Integrations ===

// Initialize settings management
const { settings } = useInputSettings()

// Initialize chat mode management
const chatMode = useChatMode()

// Initialize history composable first (needed for editor placeholder)
const history = useInputHistory(null as any, t)

// Create editor instance (needs to be created before composables that depend on it)
const editor = new Editor({
  editorProps: {
    attributes: {
      class: 'outline-none focus:outline-none focus-within:outline-none min-h-12'
    }
  },
  autofocus: true,
  extensions: [
    Document,
    Paragraph,
    Text,
    History,
    Mention.configure({
      HTMLAttributes: {
        class:
          'mention px-1.5 py-0.5 text-xs rounded-md bg-secondary text-foreground inline-block max-w-64 align-sub truncate!'
      },
      suggestion,
      deleteTriggerWithBackspace: true
    }),
    SlashMention.configure({
      HTMLAttributes: {
        class:
          'slash-mention px-1.5 py-0.5 text-xs rounded-md bg-primary/10 text-primary inline-block max-w-64 align-sub truncate!'
      },
      suggestion: slashSuggestion,
      deleteTriggerWithBackspace: true
    }),
    Placeholder.configure({
      placeholder: () => {
        return history.dynamicPlaceholder.value
      }
    }),
    HardBreak.extend({
      addKeyboardShortcuts() {
        return {
          'Shift-Enter': () => {
            return this.editor.chain().setHardBreak().scrollIntoView().run()
          },
          'Alt-Enter': () => {
            return this.editor.chain().setHardBreak().scrollIntoView().run()
          }
        }
      }
    }).configure({
      keepMarks: true,
      HTMLAttributes: {
        class: 'line-break'
      }
    })
  ]
})

let caretAnimationFrame: number | null = null

const updateFakeCaretPosition = () => {
  const container = editorContainer.value?.editorContainer
  if (!container) return

  if (caretAnimationFrame) {
    cancelAnimationFrame(caretAnimationFrame)
  }

  caretAnimationFrame = requestAnimationFrame(() => {
    if (!container) return

    const view = editor.view
    const position = view.state.selection.$anchor.pos

    let coords
    try {
      coords = view.coordsAtPos(position)
    } catch (error) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const caretHeight = Math.max(coords.bottom - coords.top, 18)

    caretPosition.value = {
      x: coords.left - containerRect.left,
      y: coords.top - containerRect.top,
      height: caretHeight
    }
  })
}

const handleEditorFocus = () => {
  caretVisible.value = true
  updateFakeCaretPosition()
}

const handleEditorBlur = () => {
  caretVisible.value = false
}

// Set the editor instance in history after editor is created
history.setEditor(editor)

const conversationId = computed(() => chatStore.activeThread?.id ?? null)

const rateLimit = useRateLimitStatus(
  computed(() => chatStore.chatConfig),
  t
)
const drag = useDragAndDrop()
const files = usePromptInputFiles(fileInput, emit, t)
useMentionData(files.selectedFiles) // Setup mention data watchers

// Initialize editor composable
const editorComposable = usePromptInputEditor(
  editor,
  files.selectedFiles,
  history.clearHistoryPlaceholder
)
const composerDraft = useComposerDraft({
  conversationId,
  inputText: editorComposable.inputText,
  editor
})

// Setup editor update handler
editor.on('update', editorComposable.onEditorUpdate)
editor.on('selectionUpdate', updateFakeCaretPosition)
editor.on('transaction', updateFakeCaretPosition)
editor.on('focus', handleEditorFocus)
editor.on('blur', handleEditorBlur)

// Initialize context length tracking
const contextLengthTracker = useContextLength({
  inputText: editorComposable.inputText,
  selectedFiles: files.selectedFiles,
  contextLength: toRef(props, 'contextLength')
})

// Initialize send button state
const sendButtonState = useSendButtonState({
  variant: props.variant,
  inputText: editorComposable.inputText,
  currentContextLength: contextLengthTracker.currentContextLength,
  contextLength: toRef(props, 'contextLength')
})
const composerSubmission = useComposerSubmission({
  editor,
  inputText: editorComposable.inputText,
  selectedFiles: files.selectedFiles,
  deepThinking: computed(() => settings.value.deepThinking),
  buildBlocks: editorComposable.tiptapJSONtoMessageBlock
})

// Only initialize config for chat variant
const config =
  props.variant === 'agent' || props.variant === 'newThread'
    ? usePromptInputConfig()
    : ({
        activeModel: ref({ providerId: '', tags: [] }),
        modelDisplayName: ref(''),
        configSystemPrompt: ref(''),
        configTemperature: ref(0.7),
        configContextLength: ref(0),
        configMaxTokens: ref(0),
        configArtifacts: ref(0),
        configThinkingBudget: ref(''),
        configEnableSearch: ref(false),
        configForcedSearch: ref(false),
        configSearchStrategy: ref(''),
        configReasoningEffort: ref(''),
        configVerbosity: ref(''),
        configContextLengthLimit: ref(0),
        configMaxTokensLimit: ref(0),
        configModelType: ref(ModelType.Chat),
        handleModelUpdate: () => {},
        loadModelConfig: async () => {}
      } as any)

const activeModelSource = computed(() => {
  if (props.modelInfo?.id && props.modelInfo.providerId) {
    return props.modelInfo
  }
  return config.activeModel.value
})

const acpWorkdir = useAcpWorkdir({
  activeModel: activeModelSource,
  conversationId
})

// Unified workspace management (for agent and acp agent modes)
const workspace = useAgentWorkspace({
  conversationId,
  activeModel: activeModelSource,
  chatMode
})

const workspaceMention = useWorkspaceMention({
  workspacePath: workspace.workspacePath,
  chatMode: chatMode.currentMode,
  conversationId
})
setWorkspaceMention(workspaceMention)

// Setup slash mention data (skills, prompts, tools)
useSlashMentionData(conversationId)

// Setup skill activation handler for slash mentions
const { activateSkill, pendingSkills, consumePendingSkills } = useSkillsData(conversationId)
setSkillActivationHandler(activateSkill)

// Extract isStreaming first so we can pass it to useAcpMode
const { disabledSend, isStreaming } = sendButtonState

const acpMode = useAcpMode({
  activeModel: activeModelSource,
  conversationId,
  isStreaming,
  workdir: acpWorkdir.workdir
})

const acpSessionModel = useAcpSessionModel({
  activeModel: activeModelSource,
  conversationId,
  isStreaming,
  workdir: acpWorkdir.workdir
})

const {
  acpAgentOptions,
  selectedAcpAgentId,
  showAcpSessionModelSelector,
  handleModeSelect,
  handleAcpAgentSelect,
  handleAcpModeSelect,
  handleAcpSessionModelSelect
} = useChatInputModeSelection({
  variant: props.variant,
  activeModel: activeModelSource,
  conversationId,
  chatMode,
  modelStore,
  config,
  acpMode,
  acpSessionModel,
  updateChatConfig: chatStore.updateChatConfig,
  emitModelUpdate: (payload: unknown, providerId: string) =>
    emit('model-update', payload as any, providerId)
})

// === Computed ===
// Use composable values
const { currentContextLengthText, shouldShowContextLength, contextLengthStatusClass } =
  contextLengthTracker

// === Event Handlers ===
const handleDrop = async (e: DragEvent) => {
  drag.resetDragState()

  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    await files.handleDrop(e.dataTransfer.files)
  }
}

const previewFile = (filePath: string) => {
  windowAdapter.previewFile(filePath)
}

const handleCancel = () => {
  if (!chatStore.getActiveThreadId()) return
  chatStore.cancelGenerating(chatStore.getActiveThreadId()!)
}

const emitSend = async () => {
  const messageContent = await composerSubmission.buildMessageContent()
  if (!messageContent) return

  history.addToHistory(messageContent.text)
  emit('send', messageContent)
  composerDraft.clearDraft(conversationId.value)
  editorComposable.inputText.value = ''
  editor.chain().clearContent().run()

  history.clearHistoryPlaceholder()
  files.clearFiles()

  nextTick(() => {
    editor.commands.focus()
  })
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.code === 'Enter' && !e.shiftKey) {
    editorComposable.handleEditorEnter(e, disabledSend.value, emitSend)
    e.preventDefault()
  }

  // History navigation
  const currentContent = editor.getText().trim()

  if (e.code === 'ArrowUp' && !currentContent) {
    if (history.handleArrowKey('up', currentContent)) {
      e.preventDefault()
    }
  } else if (e.code === 'ArrowDown' && !currentContent) {
    if (history.handleArrowKey('down', currentContent)) {
      e.preventDefault()
    }
  } else if (e.code === 'Tab' && history.currentHistoryPlaceholder.value) {
    e.preventDefault()
    history.confirmHistoryPlaceholder()
  } else if (e.code === 'Escape' && history.currentHistoryPlaceholder.value) {
    e.preventDefault()
    history.clearHistoryPlaceholder()
  } else if (history.currentHistoryPlaceholder.value && e.key.length === 1) {
    history.clearHistoryPlaceholder()
  }
}

const restoreFocus = () => {
  editorComposable.restoreFocus()
}

// === Event Handler Functions ===
// Context menu handler
const handleContextMenuAskAI = (e: any) => {
  editorComposable.inputText.value = e.detail
  editor.commands.setContent(e.detail)
  editor.commands.focus()
}

// Visibility change handler
const handleVisibilityChange = () => {
  if (!document.hidden) {
    setTimeout(() => {
      restoreFocus()
    }, 100)
  }
}

const hasContextMention = () => {
  let found = false
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'mention' && node.attrs?.category === 'context') {
      found = true
      return false
    }
    return true
  })
  return found
}

const setCaretToEnd = () => {
  if (editor.isDestroyed) return
  const { state, view } = editor
  const endSelection = TextSelection.atEnd(state.doc)
  view.dispatch(state.tr.setSelection(endSelection))
  editor.commands.focus()
}

const scheduleCaretToEnd = () => {
  const delays = [0, 50, 120]
  for (const delay of delays) {
    setTimeout(() => {
      if (editor.isDestroyed) return
      requestAnimationFrame(() => {
        setCaretToEnd()
      })
    }, delay)
  }
}

const appendCustomMention = (mention: CategorizedData) => {
  const shouldInsertAtEnd = mention.category === 'context'
  if (shouldInsertAtEnd && hasContextMention()) {
    scheduleCaretToEnd()
    return true
  }
  if (shouldInsertAtEnd) {
    setCaretToEnd()
  }
  const insertPosition = shouldInsertAtEnd
    ? editor.state.selection.to
    : editor.state.selection.anchor
  const inserted = editorComposable.insertMentionToEditor(mention, insertPosition)
  if (inserted && shouldInsertAtEnd) {
    scheduleCaretToEnd()
  }
  return inserted
}

useEventListener(window, 'resize', updateFakeCaretPosition)

// === Lifecycle Hooks ===
onMounted(async () => {
  // Settings are auto-initialized by useInputSettings composable

  // Initialize history
  history.initHistory()

  // Setup prompt files handler
  setPromptFilesHandler(files.handlePromptFiles)

  // For newThread variant, ensure agent mode is set
  if (props.variant === 'newThread') {
    if (chatMode.currentMode.value !== 'agent') {
      await chatMode.setMode('agent')
    }
  }

  // Load model config (only for chat variant)
  if (props.variant === 'agent' || props.variant === 'newThread') {
    await config.loadModelConfig()
  }

  // Setup editor paste handler
  editorComposable.setupEditorPasteHandler(files.handlePaste)

  // Setup scroll listener for fake caret
  const container = editorContainer.value?.editorContainer
  if (container) {
    useEventListener(container, 'scroll', updateFakeCaretPosition)
  }

  nextTick(updateFakeCaretPosition)
})

useEventListener(window, 'context-menu-ask-ai', handleContextMenuAskAI)
useEventListener(document, 'visibilitychange', handleVisibilityChange)

onUnmounted(() => {
  // Cleanup paste handler
  editorComposable.cleanupEditorPasteHandler()

  // Remove editor update listener
  editor.off('update', editorComposable.onEditorUpdate)
  editor.off('selectionUpdate', updateFakeCaretPosition)
  editor.off('transaction', updateFakeCaretPosition)
  editor.off('focus', handleEditorFocus)
  editor.off('blur', handleEditorBlur)

  // Destroy editor instance
  editor.destroy()

  if (caretAnimationFrame) {
    cancelAnimationFrame(caretAnimationFrame)
  }

  setWorkspaceMention(null)
})

// === Watchers ===
watch(history.dynamicPlaceholder, () => {
  history.updatePlaceholder()
})

watch(
  () => props.disabled,
  (newDisabled, oldDisabled) => {
    if (oldDisabled && !newDisabled) {
      setTimeout(() => {
        restoreFocus()
      }, 100)
    }
  }
)

watch(
  () => conversationId.value,
  (nextId, prevId) => {
    if (prevId && prevId !== nextId) {
      composerDraft.persistDraft(prevId)
    }
    if (nextId) {
      composerDraft.restoreDraft(nextId)
    }
  },
  { immediate: true }
)

watch(editorComposable.inputText, () => {
  composerDraft.persistDraft(conversationId.value)
})

watch(
  () => chatStore.chatConfig.providerId,
  () => {
    rateLimit.loadRateLimitStatus()
  }
)

watch(
  () => [conversationId.value, chatStore.chatConfig.chatMode] as const,
  async ([activeId, storedMode]) => {
    if (!activeId) return
    try {
      if (!storedMode) {
        await chatStore.updateChatConfig({ chatMode: chatMode.currentMode.value })
        return
      }
      if (chatMode.currentMode.value !== storedMode) {
        await chatMode.setMode(storedMode)
      }
    } catch (error) {
      console.warn('Failed to sync chat mode for conversation:', error)
    }
  },
  { immediate: true }
)

// === Expose ===
defineExpose({
  clearContent: editorComposable.clearContent,
  appendText: editorComposable.appendText,
  appendMention: (name: string) => editorComposable.appendMention(name, mentionData),
  appendCustomMention,
  restoreFocus,
  getAgentWorkspacePath: () => {
    const mode = chatMode.currentMode.value
    if (mode !== 'agent') return null
    return workspace.workspacePath.value
  },
  getChatMode: () => chatMode.currentMode.value,
  getPendingSkills: () => [...pendingSkills.value],
  consumePendingSkills
})
</script>

<style scoped>
@reference '../../assets/style.css';

.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.duration-300 {
  transition-duration: 300ms;
}

:deep(.tiptap) {
  caret-color: transparent;
}

.fake-caret {
  position: absolute;
  top: 0;
  left: 0;
  width: 2px;
  border-radius: 9999px;
  background: var(--primary);
  box-shadow: 0 0 10px var(--primary);
  animation: fake-caret-blink 1.2s steps(1) infinite;
  transition:
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
    height 140ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 120ms ease;
  pointer-events: none;
  will-change: transform, height, opacity;
  opacity: 0.9;
}

@keyframes fake-caret-blink {
  0%,
  55% {
    opacity: 0.9;
  }
  55%,
  100% {
    opacity: 0.35;
  }
}
</style>

<style>
@reference '../../assets/style.css';

.tiptap p.is-editor-empty:first-child::before {
  color: var(--muted-foreground);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.dark .tiptap p.is-editor-empty:first-child::before,
[data-theme='dark'] .tiptap p.is-editor-empty:first-child::before {
  color: #ffffff80;
}
</style>
