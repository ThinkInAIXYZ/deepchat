<template>
  <div
    class="w-full border-t"
    @dragenter.prevent="drag.handleDragEnter"
    @dragover.prevent="drag.handleDragOver"
    @drop.prevent="handleDrop"
    @dragleave.prevent="drag.handleDragLeave"
    @paste="files.handlePaste"
  >
    <TooltipProvider>
      <div
        :dir="langStore.dir"
        class="focus-within:border-primary px-4 py-3 flex flex-col gap-3 relative"
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
        <editor-content :editor="editor" class="text-sm dark:text-white/80" @keydown="onKeydown" />

        <!-- Footer -->
        <div class="prompt-input-footer flex flex-wrap items-center justify-between gap-3">
          <!-- Tools -->
          <div class="prompt-input-tools flex items-center gap-1.5 flex-wrap">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon"
                  class="w-7 h-7 text-xs rounded-lg text-accent-foreground"
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
                    'w-7 h-7  text-accent-foreground rounded-lg',
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
          <div class="prompt-input-actions flex items-center gap-2 flex-wrap">
            <div
              v-if="
                contextLength &&
                contextLength > 0 &&
                currentContextLength / (contextLength ?? 1000) > 0.5
              "
              class="text-xs text-muted-foreground dark:text-white/60"
              :class="[
                currentContextLength / (contextLength ?? 1000) > 0.9 ? ' text-red-600' : '',
                currentContextLength / (contextLength ?? 1000) > 0.8
                  ? ' text-yellow-600'
                  : 'text-muted-foreground'
              ]"
            >
              {{ currentContextLengthText }}
            </div>

            <div
              v-if="rateLimit.rateLimitStatus.value?.config.enabled"
              class="flex items-center gap-1 text-xs dark:text-white/60"
              :class="rateLimit.getRateLimitStatusClass()"
              :title="rateLimit.getRateLimitStatusTooltip()"
            >
              <Icon
                :icon="rateLimit.getRateLimitStatusIcon()"
                class="w-3 h-3"
                :class="{ 'animate-pulse': rateLimit.rateLimitStatus.value.queueLength > 0 }"
              />
              <span v-if="rateLimit.rateLimitStatus.value.queueLength > 0">
                {{ t('chat.input.rateLimitQueue', { count: rateLimit.rateLimitStatus.value.queueLength }) }}
              </span>
              <span v-else-if="!rateLimit.canSendImmediately.value">
                {{ rateLimit.formatWaitTime() }}
              </span>
            </div>

            <Popover v-model:open="modelSelectOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  class="prompt-input-model-button flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
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

            <ScrollablePopover align="end" content-class="w-80" :enable-scrollable="true">
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

            <Button
              variant="default"
              size="icon"
              class="w-7 h-7 text-xs rounded-lg"
              :disabled="disabledSend"
              v-if="!isStreaming"
              @click="emitSend"
            >
              <Icon icon="lucide:arrow-up" class="w-4 h-4" />
            </Button>
            <Button
              v-if="isStreaming"
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
import {
  UserMessageContent
} from '@shared/chat'
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
import ModelChooser from './ModelChooser.vue'
import ModelIcon from '../icons/ModelIcon.vue'
import McpToolsList from '../mcpToolsList.vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { useInputHistory } from './composables/useInputHistory'
import { useRateLimitStatus } from './composables/useRateLimitStatus'
import { useDragAndDrop } from './composables/useDragAndDrop'
import { usePromptInputFiles } from './composables/usePromptInputFiles'
import { useMentionData } from './composables/useMentionData'
import { usePromptInputConfig } from './composables/usePromptInputConfig'
import { usePromptInputEditor } from './composables/usePromptInputEditor'

// === Stores ===
import { useChatStore } from '@/stores/chat'
import { useLanguageStore } from '@/stores/language'
import { useThemeStore } from '@/stores/theme'

// === Mention System ===
import { Mention } from '../editor/mention/mention'
import suggestion, { setPromptFilesHandler } from '../editor/mention/suggestion'
import { mentionData } from '../editor/mention/suggestion'

// === Utils ===
import { approximateTokenSize } from 'tokenx'

// === Props & Emits ===
const props = withDefaults(
  defineProps<{
    contextLength?: number
    maxRows?: number
    rows?: number
    disabled?: boolean
  }>(),
  {
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
const configPresenter = usePresenter('configPresenter')
const windowPresenter = usePresenter('windowPresenter')

// === i18n ===
const { t } = useI18n()

// === Local State ===
const fileInput = ref<HTMLInputElement>()
const modelSelectOpen = ref(false)
const settings = ref({
  deepThinking: false,
  webSearch: false
})

// === Composable Integrations ===

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

// Initialize composables
const history = useInputHistory(editor, t)
const rateLimit = useRateLimitStatus(computed(() => chatStore.chatConfig), t)
const drag = useDragAndDrop()
const files = usePromptInputFiles(fileInput, emit, t)
useMentionData(files.selectedFiles) // Setup mention data watchers
const config = usePromptInputConfig()
const editorComposable = usePromptInputEditor(editor, files.selectedFiles, history.clearHistoryPlaceholder)

// Setup editor update handler
editor.on('update', editorComposable.onEditorUpdate)

// === Computed ===
const currentContextLength = computed(() => {
  return (
    approximateTokenSize(editorComposable.inputText.value) +
    files.selectedFiles.value.reduce((acc, file) => {
      return acc + file.token
    }, 0)
  )
})

const currentContextLengthText = computed(() => {
  return `${Math.round((currentContextLength.value / (props.contextLength ?? 1000)) * 100)}%`
})

const disabledSend = computed(() => {
  const activeThreadId = chatStore.getActiveThreadId()
  if (activeThreadId) {
    return (
      chatStore.generatingThreadIds.has(activeThreadId) ||
      editorComposable.inputText.value.length <= 0 ||
      currentContextLength.value > (props.contextLength ?? chatStore.chatConfig.contextLength)
    )
  }
  return false
})

const isStreaming = computed(() => {
  const activeThreadId = chatStore.getActiveThreadId()
  if (activeThreadId) {
    return chatStore.generatingThreadIds.has(activeThreadId)
  }
  return false
})

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
  settings.value.webSearch = !settings.value.webSearch
  await configPresenter.setSetting('input_webSearch', settings.value.webSearch)
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

// === Lifecycle Hooks ===
onMounted(async () => {
  // Initialize settings
  settings.value.deepThinking = Boolean(await configPresenter.getSetting('input_deepThinking'))
  settings.value.webSearch = Boolean(await configPresenter.getSetting('input_webSearch'))

  // Initialize history
  history.initHistory()

  // Setup prompt files handler
  setPromptFilesHandler(files.handlePromptFiles)

  // Load model config
  await config.loadModelConfig()

  // Setup editor paste handler
  editorComposable.setupEditorPasteHandler(files.handlePaste)

  // Context menu handler
  window.addEventListener('context-menu-ask-ai', (e: any) => {
    editorComposable.inputText.value = e.detail
    editor.commands.setContent(e.detail)
    editor.commands.focus()
  })

  // Visibility change handler
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      setTimeout(() => {
        restoreFocus()
      }, 100)
    }
  })
})

onUnmounted(() => {
  editorComposable.cleanupEditorPasteHandler()
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

.prompt-input-editor {
  padding: 0.75rem;
  color: var(--prompt-text-accent, var(--foreground));
}

.dark .prompt-input-editor,
[data-theme='dark'] .prompt-input-editor {
  color: var(--prompt-text-accent);
}

.prompt-input-footer {
  padding-top: 0.75rem;
}

.dark .prompt-input-tools .search-engine-select,
[data-theme='dark'] .prompt-input-tools .search-engine-select {
  color: var(--prompt-text-accent);
}

.prompt-input-tools .search-engine-select:hover {
  border-color: color-mix(in srgb, var(--prompt-border-color) 70%, var(--prompt-text-primary) 30%);
}

.prompt-input-model-button {
  min-width: 0;
}

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
