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
        ref="inputContainer"
        :dir="langStore.dir"
        :style="
          variant === 'chat'
            ? inputHeight
              ? { height: `${inputHeight}px` }
              : { maxHeight: '50vh' }
            : {}
        "
        :class="[
          'flex flex-col gap-2 relative',
          isCallActive ? 'pointer-events-none opacity-60' : '',
          variant === 'newThread'
            ? 'bg-card rounded-lg border p-2 shadow-sm'
            : 'border-t px-4 py-3 gap-3'
        ]"
      >
        <!-- Resize Handle -->
        <div
          v-if="variant === 'chat'"
          class="absolute -top-1.5 left-0 right-0 h-3 cursor-ns-resize hover:bg-primary/10 z-20 flex justify-center items-center group opacity-0 hover:opacity-100 transition-opacity"
          @mousedown="startResize"
        >
          <div
            class="w-16 h-1 bg-muted-foreground/20 rounded-full group-hover:bg-primary/40 transition-colors"
          ></div>
        </div>
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
        <div class="flex-1 min-h-0 overflow-y-auto relative">
          <editor-content
            :editor="editor"
            :class="['text-sm h-full', variant === 'chat' ? 'dark:text-white/80' : 'p-2']"
            @keydown="onKeydown"
          />
        </div>

        <!-- Footer -->
        <ChatInputToolbar>
          <template #left>
            <!-- Mode Switch -->
            <Tooltip>
              <TooltipTrigger as-child>
                <span class="inline-flex">
                  <Popover v-model:open="modeSelectOpen">
                    <PopoverTrigger as-child>
                      <Button
                        variant="outline"
                        :class="[
                          'w-7 h-7 text-xs rounded-lg',
                          variant === 'chat' ? 'text-accent-foreground' : ''
                        ]"
                        size="icon"
                        :title="t('chat.mode.current', { mode: chatMode.currentLabel.value })"
                      >
                        <Icon :icon="chatMode.currentIcon.value" class="w-4 h-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      class="w-64 border-none bg-transparent p-0 shadow-none"
                    >
                      <div class="rounded-lg border bg-card p-1 shadow-md">
                        <div
                          v-for="mode in chatMode.modes.value"
                          :key="mode.value"
                          :class="[
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                            chatMode.currentMode.value === mode.value
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          ]"
                          @click="handleModeSelect(mode.value)"
                        >
                          <Icon :icon="mode.icon" class="w-4 h-4" />
                          <span class="flex-1">{{ mode.label }}</span>
                          <Icon
                            v-if="chatMode.currentMode.value === mode.value"
                            icon="lucide:check"
                            class="w-4 h-4"
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {{ t('chat.mode.current', { mode: chatMode.currentLabel.value }) }}
              </TooltipContent>
            </Tooltip>

            <AgentInfoBadge
              v-if="variant === 'chat'"
              :agent="currentAgent"
              :active-model="activeModelSource"
              @open-settings="openAgentSettings"
            />

            <WorkdirToolbarItem
              v-if="variant === 'chat'"
              :workdir="workspace.workspacePath.value || ''"
              :session-default="workspace.sessionDefaultPath.value || ''"
              :recent-workdirs="workspace.recentWorkdirs.value"
              :loading="workspace.loading.value"
              @select="handleWorkdirSelect"
              @browse="handleWorkdirBrowse"
              @reset="handleWorkdirReset"
            />

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

            <McpToolsList />
            <SkillsIndicator :conversation-id="conversationId" />
          </template>

          <!-- Actions -->
          <template #right>
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

            <!-- Mode Switcher (ACPs only, chat mode, only when agent declares modes) -->
            <Tooltip
              v-if="
                ['chat', 'newThread'].includes(variant) &&
                acpMode.isAcpModel.value &&
                acpMode.hasAgentModes.value
              "
            >
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  class="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                  :disabled="acpMode.loading.value"
                  @click="acpMode.cycleMode"
                >
                  <span
                    class="truncate max-w-[120px] text-foreground"
                    :title="acpMode.currentModeName.value"
                  >
                    {{ acpMode.currentModeName.value }}
                  </span>
                  <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent class="max-w-xs">
                <p class="text-xs font-semibold">{{ t('chat.input.acpMode') }}</p>
                <p class="text-xs text-muted-foreground mt-1">
                  {{ t('chat.input.acpModeTooltip', { mode: acpMode.currentModeName.value }) }}
                </p>
                <p v-if="acpMode.currentModeInfo.value" class="text-xs text-muted-foreground mt-1">
                  {{ acpMode.currentModeInfo.value.description }}
                </p>
              </TooltipContent>
            </Tooltip>

            <!-- NewThread model selector and settings (right-aligned) -->
            <slot name="addon-actions"></slot>

            <!-- Model Selector (only in chat mode) -->
            <Popover v-if="variant === 'chat'" v-model:open="modelSelectOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                  size="sm"
                >
                  <ModelIcon
                    v-if="config.activeModel.value.providerId === 'acp'"
                    :model-id="config.activeModel.value.id"
                    :is-dark="themeStore.isDark"
                    custom-class="w-4 h-4"
                  />
                  <ModelIcon
                    v-else
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

            <VoiceCallWidget
              :variant="variant"
              :active-provider-id="activeModelSource?.providerId"
              :is-streaming="isStreaming"
              @active-change="isCallActive = $event"
            />

            <SendButton
              :variant="variant"
              :is-streaming="isStreaming"
              :disabled="disabledSend || isCallActive"
              :is-call-active="isCallActive"
              @send="emitSend"
              @cancel="handleCancel"
            />
          </template>
        </ChatInputToolbar>

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
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
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
import { TextSelection } from '@tiptap/pm/state'
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
import SkillsIndicator from './SkillsIndicator.vue'
import VoiceCallWidget from './VoiceCallWidget.vue'
import ChatInputToolbar from './components/ChatInputToolbar.vue'
import AgentInfoBadge from './components/AgentInfoBadge.vue'
import WorkdirToolbarItem from './components/WorkdirToolbarItem.vue'
import SendButton from './components/SendButton.vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
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
import { useAcpWorkdir } from './composables/useAcpWorkdir'
import { useAcpMode } from './composables/useAcpMode'
import { useChatMode, type ChatMode } from './composables/useChatMode'
import { useAgentWorkspace } from './composables/useAgentWorkspace'
import { useWorkspaceMention } from './composables/useWorkspaceMention'

// === Stores ===
import { useChatStore } from '@/stores/chat'
import { useLanguageStore } from '@/stores/language'
import { useThemeStore } from '@/stores/theme'
import { useAgentStore } from '@/stores/agent'

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

// === Props & Emits ===
const props = withDefaults(
  defineProps<{
    variant: 'chat' | 'newThread'
    contextLength?: number
    maxRows?: number
    rows?: number
    disabled?: boolean
    modelInfo?: { id: string; providerId: string } | null
  }>(),
  {
    variant: 'chat',
    maxRows: 10,
    rows: 1,
    disabled: false,
    modelInfo: null
  }
)

const emit = defineEmits(['send', 'file-upload'])

// === Resize Logic ===
const inputContainer = ref<HTMLElement | null>(null)
const inputHeight = ref<number | null>(null)
const isResizing = ref(false)
const startY = ref(0)
const startHeight = ref(0)

const startResize = (e: MouseEvent) => {
  if (props.variant !== 'chat') return
  isResizing.value = true
  startY.value = e.clientY
  if (inputContainer.value) {
    startHeight.value = inputContainer.value.getBoundingClientRect().height
  }
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
}

const handleResize = (e: MouseEvent) => {
  if (!isResizing.value) return
  const deltaY = startY.value - e.clientY
  const newHeight = startHeight.value + deltaY
  // Min height 100px, Max height 50% of window height
  const maxHeight = window.innerHeight * 0.5
  if (newHeight > 100 && newHeight < maxHeight) {
    inputHeight.value = newHeight
  }
}

const stopResize = () => {
  isResizing.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// === Stores ===
const chatStore = useChatStore()
const langStore = useLanguageStore()
const themeStore = useThemeStore()
const agentStore = useAgentStore()

// === Presenters ===
const windowPresenter = usePresenter('windowPresenter')

// === i18n ===
const { t } = useI18n()

// === Local State ===
const fileInput = ref<HTMLInputElement>()
const modelSelectOpen = ref(false)
const isCallActive = ref(false)

// === Composable Integrations ===

// Initialize settings management
const { settings } = useInputSettings()

// Initialize chat mode management
const chatMode = useChatMode()
const modeSelectOpen = ref(false)

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
  contextLength: toRef(props, 'contextLength')
})

// Initialize send button state
const sendButtonState = useSendButtonState({
  variant: props.variant,
  inputText: editorComposable.inputText,
  currentContextLength: contextLengthTracker.currentContextLength,
  contextLength: toRef(props, 'contextLength')
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

const conversationId = computed(() => chatStore.activeThread?.id ?? null)
const activeModelSource = computed(() => {
  if (props.modelInfo?.id && props.modelInfo.providerId) {
    return props.modelInfo
  }
  return config.activeModel.value
})
const currentAgent = computed(() => agentStore.selectedAgent)

const acpWorkdir = useAcpWorkdir({
  activeModel: activeModelSource,
  conversationId
})

// Unified workspace management (for agent and acp agent modes)
const workspace = useAgentWorkspace({
  conversationId,
  activeModel: activeModelSource,
  chatMode,
  acpWorkdir
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

// === Computed ===
// Use composable values
const { currentContextLengthText, shouldShowContextLength, contextLengthStatusClass } =
  contextLengthTracker

// === Event Handlers ===
const openAgentSettings = () => {
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    void windowPresenter.openOrFocusSettingsTab(windowId)
  }
}

const handleWorkdirSelect = async (workdirPath: string) => {
  await workspace.selectWorkspacePath(workdirPath)
}

const handleWorkdirBrowse = async () => {
  await workspace.selectWorkspace()
}

const handleWorkdirReset = async () => {
  await workspace.resetWorkspace()
}

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
      search: false,
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

const handleModeSelect = async (mode: ChatMode) => {
  await chatMode.setMode(mode)
  if (conversationId.value && chatMode.currentMode.value === mode) {
    try {
      await chatStore.updateChatConfig({ chatMode: mode })
    } catch (error) {
      console.warn('Failed to update chat mode in conversation settings:', error)
    }
  }
  modeSelectOpen.value = false
}

const onKeydown = (e: KeyboardEvent) => {
  if (isCallActive.value) {
    e.preventDefault()
    return
  }
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
})

useEventListener(window, 'context-menu-ask-ai', handleContextMenuAskAI)
useEventListener(document, 'visibilitychange', handleVisibilityChange)

onUnmounted(() => {
  // Cleanup paste handler
  editorComposable.cleanupEditorPasteHandler()

  // Remove editor update listener
  editor.off('update', editorComposable.onEditorUpdate)
  editor.destroy()

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
  () => chatStore.chatConfig.providerId,
  () => {
    rateLimit.loadRateLimitStatus()
  }
)

watch(isCallActive, (open) => {
  if (!editor.isDestroyed) {
    editor.setEditable(!open)
  }
})

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
