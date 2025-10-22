<template>
  <div
    :class="['w-full', variant === 'newThread' ? 'max-w-4xl mx-auto' : '']"
    @dragenter.prevent="drag.handleDragEnter"
    @dragover.prevent="drag.handleDragOver"
    @drop.prevent="handleDrop"
    @dragleave.prevent="drag.handleDragLeave"
    @paste="files.handlePaste"
  >
    <TooltipProvider>
      <div
        :dir="langStore.dir"
        :class="[
          'flex flex-col gap-2 relative',
          variant === 'newThread'
            ? 'bg-card rounded-lg border p-2 shadow-sm'
            : 'border-t px-4 py-3 gap-3'
        ]"
      >
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

        <!-- Editor -->
        <editor-content
          :editor="editor"
          :class="['text-sm', variant === 'chat' ? 'dark:text-white/80' : 'p-2']"
          @keydown="onKeydown"
        />

        <!-- Footer -->
        <div class="flex items-center justify-between">
          <!-- Tools -->
          <div class="flex gap-1.5">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon"
                  :class="[
                    'w-7 h-7 text-xs rounded-lg',
                    variant === 'chat' ? 'text-accent-foreground' : ''
                  ]"
                  @click="files.openFilePicker"
                >
                  <Icon icon="lucide:paperclip" class="w-4 h-4" />
                  <input
                    ref="fileInput"
                    type="file"
                    class="hidden"
                    multiple
                    accept="application/json,application/javascript,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,application/vnd.ms-excel.sheet.binary.macroEnabled.12,application/vnd.apple.numbers,text/markdown,application/x-yaml,application/xml,application/typescript,text/typescript,text/x-typescript,application/x-typescript,application/x-sh,text/*,application/pdf,image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/html,text/css,application/xhtml+xml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.rs,.swift,.kt,.scala,.pl,.lua,.sh,.json,.yaml,.yml,.xml,.html,.htm,.css,.md,audio/mp3,audio/wav,audio/mp4,audio/mpeg,.mp3,.wav,.m4a"
                    @change="files.handleFileSelect"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('chat.input.fileSelect') }}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  :class="[
                    'w-7 h-7 text-xs rounded-lg',
                    variant === 'chat' ? 'text-accent-foreground' : '',
                    settings.webSearch ? 'text-primary' : ''
                  ]"
                  :dir="langStore.dir"
                  size="icon"
                  @click="onWebSearchClick"
                >
                  <Icon icon="lucide:globe" class="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('chat.features.webSearch') }}</TooltipContent>
            </Tooltip>

            <McpToolsList />
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 flex-wrap">
            <!-- NewThread model selector and settings (right-aligned) -->
            <slot name="addon-actions"></slot>
            <div
              v-if="shouldShowContextLength"
              :class="[
                'text-xs',
                variant === 'chat'
                  ? 'text-muted-foreground dark:text-white/60'
                  : 'text-muted-foreground',
                contextLengthStatusClass
              ]"
            >
              {{ currentContextLengthText }}
            </div>

            <div
              v-if="rateLimit.rateLimitStatus.value?.config.enabled"
              :class="[
                'flex items-center gap-1 text-xs',
                variant === 'chat' ? 'dark:text-white/60' : '',
                rateLimit.getRateLimitStatusClass()
              ]"
              :title="rateLimit.getRateLimitStatusTooltip()"
            >
              <Icon
                :icon="rateLimit.getRateLimitStatusIcon()"
                class="w-3 h-3"
                :class="{ 'animate-pulse': rateLimit.rateLimitStatus.value.queueLength > 0 }"
              />
              <span v-if="rateLimit.rateLimitStatus.value.queueLength > 0">
                {{
                  t('chat.input.rateLimitQueue', {
                    count: rateLimit.rateLimitStatus.value.queueLength
                  })
                }}
              </span>
              <span v-else-if="!rateLimit.canSendImmediately.value">
                {{ rateLimit.formatWaitTime() }}
              </span>
            </div>

            <!-- Model Selector (only in chat mode) -->
            <Popover v-if="variant === 'chat'" v-model:open="modelSelectOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                  size="sm"
                >
                  <ModelIcon
                    :model-id="config.activeModel.value.providerId"
                    :is-dark="themeStore.isDark"
                    custom-class="w-4 h-4"
                  />
                  <span
                    class="text-xs font-semibold truncate max-w-[140px] text-foreground"
                    :title="config.modelDisplayName.value"
                  >
                    {{ config.modelDisplayName.value }}
                  </span>
                  <Badge
                    v-for="tag in config.activeModel.value.tags"
                    :key="tag"
                    variant="outline"
                    class="py-0 px-1 rounded-lg text-[10px]"
                  >
                    {{ t(`model.tags.${tag}`) }}
                  </Badge>
                  <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" class="w-80 border-none bg-transparent p-0 shadow-none">
                <ModelChooser
                  :type="[ModelType.Chat, ModelType.ImageGeneration]"
                  @update:model="config.handleModelUpdate"
                />
              </PopoverContent>
            </Popover>

            <!-- Config Button (only in chat mode) -->
            <ScrollablePopover
              v-if="variant === 'chat'"
              align="end"
              content-class="w-80"
              :enable-scrollable="true"
            >
              <template #trigger>
                <Button
                  class="h-7 w-7 rounded-md border border-border/60 hover:border-border dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-white/25 dark:hover:bg-white/15 dark:hover:text-white"
                  size="icon"
                  variant="outline"
                >
                  <Icon icon="lucide:settings-2" class="w-4 h-4" />
                </Button>
              </template>
              <ChatConfig
                v-model:system-prompt="config.configSystemPrompt.value"
                v-model:temperature="config.configTemperature.value"
                v-model:context-length="config.configContextLength.value"
                v-model:max-tokens="config.configMaxTokens.value"
                v-model:artifacts="config.configArtifacts.value"
                v-model:thinking-budget="config.configThinkingBudget.value"
                v-model:enable-search="config.configEnableSearch.value"
                v-model:forced-search="config.configForcedSearch.value"
                v-model:search-strategy="config.configSearchStrategy.value"
                v-model:reasoning-effort="config.configReasoningEffort.value"
                v-model:verbosity="config.configVerbosity.value"
                :context-length-limit="config.configContextLengthLimit.value"
                :max-tokens-limit="config.configMaxTokensLimit.value"
                :model-id="chatStore.chatConfig.modelId"
                :provider-id="chatStore.chatConfig.providerId"
                :model-type="config.configModelType.value"
              />
            </ScrollablePopover>

            <!-- Send/Stop Button -->
            <Button
              v-if="!isStreaming || variant === 'newThread'"
              variant="default"
              size="icon"
              class="w-7 h-7 text-xs rounded-lg"
              :disabled="disabledSend"
              @click="emitSend"
            >
              <Icon icon="lucide:arrow-up" class="w-4 h-4" />
            </Button>
            <Button
              v-else-if="isStreaming && variant === 'chat'"
              key="cancel"
              variant="outline"
              size="icon"
              class="w-7 h-7 text-xs rounded-lg bg-card backdrop-blur-lg"
              @click="handleCancel"
            >
              <Icon
                icon="lucide:square"
                class="w-6 h-6 bg-red-500 p-1 text-primary-foreground rounded-full"
              />
            </Button>
          </div>
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
    </TooltipProvider>
  </div>
</template>

<script setup lang="ts">
// === Vue Core ===
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// === Types ===
import { UserMessageContent } from '@shared/chat'
import { ModelType } from '@shared/model'

// === Components ===
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Icon } from '@iconify/vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import History from '@tiptap/extension-history'
import Placeholder from '@tiptap/extension-placeholder'
import HardBreak from '@tiptap/extension-hard-break'
import FileItem from '../FileItem.vue'
import ScrollablePopover from '../ScrollablePopover.vue'
import ChatConfig from '../ChatConfig.vue'
import ModelChooser from '../ModelChooser.vue'
import ModelIcon from '../icons/ModelIcon.vue'
import McpToolsList from '../McpToolsList.vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { useInputHistory } from './composables/useInputHistory'
import { useRateLimitStatus } from './composables/useRateLimitStatus'
import { useDragAndDrop } from './composables/useDragAndDrop'
import { usePromptInputFiles } from './composables/usePromptInputFiles'
import { useMentionData } from './composables/useMentionData'
import { usePromptInputConfig } from './composables/usePromptInputConfig'
import { usePromptInputEditor } from './composables/usePromptInputEditor'
import { useInputSettings } from './composables/useInputSettings'
import { useContextLength } from './composables/useContextLength'
import { useSendButtonState } from './composables/useSendButtonState'

// === Stores ===
import { useChatStore } from '@/stores/chat'
import { useLanguageStore } from '@/stores/language'
import { useThemeStore } from '@/stores/theme'

// === Mention System ===
import { Mention } from '../editor/mention/mention'
import suggestion, { setPromptFilesHandler } from '../editor/mention/suggestion'
import { mentionData } from '../editor/mention/suggestion'

// === Props & Emits ===
const props = withDefaults(
  defineProps<{
    variant: 'chat' | 'newThread'
    contextLength?: number
    maxRows?: number
    rows?: number
    disabled?: boolean
  }>(),
  {
    variant: 'chat',
    maxRows: 10,
    rows: 1,
    disabled: false
  }
)

const emit = defineEmits(['send', 'file-upload'])

// === Stores ===
const chatStore = useChatStore()
const langStore = useLanguageStore()
const themeStore = useThemeStore()

// === Presenters ===
const windowPresenter = usePresenter('windowPresenter')

// === i18n ===
const { t } = useI18n()

// === Local State ===
const fileInput = ref<HTMLInputElement>()
const modelSelectOpen = ref(false)

// === Composable Integrations ===

// Initialize settings management
const { settings, toggleWebSearch } = useInputSettings()

// Initialize history composable first (needed for editor placeholder)
const history = useInputHistory(null as any, t)

// Create editor instance (needs to be created before composables that depend on it)
const editor = new Editor({
  editorProps: {
    attributes: {
      class:
        'outline-none focus:outline-none focus-within:outline-none min-h-12 max-h-28 overflow-y-auto'
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

// Set the editor instance in history after editor is created
history.setEditor(editor)

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

// Setup editor update handler
editor.on('update', editorComposable.onEditorUpdate)

// Initialize context length tracking
const contextLengthTracker = useContextLength({
  inputText: editorComposable.inputText,
  selectedFiles: files.selectedFiles,
  contextLength: props.contextLength
})

// Initialize send button state
const sendButtonState = useSendButtonState({
  variant: props.variant,
  inputText: editorComposable.inputText,
  currentContextLength: contextLengthTracker.currentContextLength,
  contextLength: props.contextLength
})

// Only initialize config for chat variant
const config =
  props.variant === 'chat'
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

// === Computed ===
// Use composable values
const { currentContextLengthText, shouldShowContextLength, contextLengthStatusClass } =
  contextLengthTracker

const { disabledSend, isStreaming } = sendButtonState

// === Event Handlers ===
const handleDrop = async (e: DragEvent) => {
  drag.resetDragState()

  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    await files.handleDrop(e.dataTransfer.files)
  }
}

const previewFile = (filePath: string) => {
  windowPresenter.previewFile(filePath)
}

const handleCancel = () => {
  if (!chatStore.getActiveThreadId()) return
  chatStore.cancelGenerating(chatStore.getActiveThreadId()!)
}

const emitSend = async () => {
  if (editorComposable.inputText.value.trim()) {
    history.addToHistory(editorComposable.inputText.value.trim())
    const blocks = await editorComposable.tiptapJSONtoMessageBlock(editor.getJSON())

    const messageContent: UserMessageContent = {
      text: editorComposable.inputText.value.trim(),
      files: files.selectedFiles.value,
      links: [],
      search: settings.value.webSearch,
      think: settings.value.deepThinking,
      content: blocks
    }

    emit('send', messageContent)
    editorComposable.inputText.value = ''
    editor.chain().clearContent().run()

    history.clearHistoryPlaceholder()
    files.clearFiles()

    nextTick(() => {
      editor.commands.focus()
    })
  }
}

const onWebSearchClick = async () => {
  await toggleWebSearch()
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

// === Lifecycle Hooks ===
onMounted(async () => {
  // Settings are auto-initialized by useInputSettings composable

  // Initialize history
  history.initHistory()

  // Setup prompt files handler
  setPromptFilesHandler(files.handlePromptFiles)

  // Load model config (only for chat variant)
  if (props.variant === 'chat') {
    await config.loadModelConfig()
  }

  // Setup editor paste handler
  editorComposable.setupEditorPasteHandler(files.handlePaste)

  // Register context menu handler
  window.addEventListener('context-menu-ask-ai', handleContextMenuAskAI)

  // Register visibility change handler
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  // Cleanup paste handler
  editorComposable.cleanupEditorPasteHandler()

  // Remove context menu event listener
  window.removeEventListener('context-menu-ask-ai', handleContextMenuAskAI)

  // Remove visibility change event listener
  document.removeEventListener('visibilitychange', handleVisibilityChange)

  // Remove editor update listener
  editor.off('update', editorComposable.onEditorUpdate)

  // Destroy editor instance
  editor.destroy()
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
  () => chatStore.chatConfig.providerId,
  () => {
    rateLimit.loadRateLimitStatus()
  }
)

// === Expose ===
defineExpose({
  clearContent: editorComposable.clearContent,
  appendText: editorComposable.appendText,
  appendMention: (name: string) => editorComposable.appendMention(name, mentionData),
  restoreFocus
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
