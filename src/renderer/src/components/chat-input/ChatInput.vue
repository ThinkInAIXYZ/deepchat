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
        <div ref="editorContainer" class="flex-1 min-h-0 overflow-y-auto relative">
          <editor-content
            :editor="editor"
            :class="['text-sm h-full', variant === 'chat' ? 'dark:text-white/80' : 'p-2']"
            @keydown="onKeydown"
          />
          <div v-if="showFakeCaret" class="fake-caret" :style="fakeCaretStyle" />
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between">
          <!-- Tools -->
          <div class="flex gap-1.5">
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
                        <ModelIcon
                          v-if="selectedAcpAgentId"
                          :model-id="selectedAcpAgentId"
                          custom-class="w-4 h-4"
                        />
                        <Icon v-else :icon="chatMode.currentIcon.value" class="w-4 h-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      class="w-64 border-none bg-transparent p-0 shadow-none"
                    >
                      <div class="rounded-lg border bg-card p-1 shadow-md">
                        <div
                          :class="[
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                            isAgentModeSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          ]"
                          @click="handleModeSelect('agent')"
                        >
                          <Icon icon="lucide:bot" class="w-4 h-4" />
                          <span class="flex-1">{{ t('chat.mode.agent') }}</span>
                          <Icon v-if="isAgentModeSelected" icon="lucide:check" class="w-4 h-4" />
                        </div>

                        <div
                          v-if="acpAgentOptions.length"
                          class="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                        >
                          {{ t('chat.mode.acpAgent') }}
                        </div>

                        <div
                          v-for="agent in acpAgentOptions"
                          :key="agent.id"
                          :class="[
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                            selectedAcpAgentId === agent.id
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          ]"
                          @click="handleAcpAgentSelect(agent)"
                        >
                          <ModelIcon :model-id="agent.id" custom-class="w-4 h-4" />
                          <span class="flex-1">{{ agent.name }}</span>
                          <Icon
                            v-if="selectedAcpAgentId === agent.id"
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

            <!-- Unified Workspace Path Selection (for agent and acp agent modes) -->
            <Tooltip v-if="chatMode.isAgentMode.value">
              <TooltipTrigger>
                <Button
                  :class="[
                    'w-7 h-7 text-xs rounded-lg',
                    variant === 'chat' ? 'text-accent-foreground' : '',
                    workspace.hasWorkspace.value
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : ''
                  ]"
                  :variant="workspace.hasWorkspace.value ? 'default' : 'outline'"
                  size="icon"
                  :disabled="workspace.loading.value"
                  @click="workspace.selectWorkspace"
                >
                  <Icon
                    :icon="workspace.hasWorkspace.value ? 'lucide:folder-open' : 'lucide:folder'"
                    class="w-4 h-4"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent class="max-w-xs">
                <p class="text-xs font-semibold">
                  {{ workspace.tooltipTitle }}
                </p>
                <p v-if="workspace.hasWorkspace.value" class="text-xs text-muted-foreground mt-1">
                  {{ workspace.tooltipCurrent }}
                </p>
                <p v-else class="text-xs text-muted-foreground mt-1">
                  {{ workspace.tooltipSelect }}
                </p>
              </TooltipContent>
            </Tooltip>

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

            <Tooltip v-if="canUseWebSearch">
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
            <SkillsIndicator :conversation-id="conversationId" />
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 flex-wrap">
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
              <TooltipTrigger as-child>
                <span class="inline-flex">
                  <Popover v-model:open="acpModeSelectOpen">
                    <PopoverTrigger as-child>
                      <Button
                        variant="ghost"
                        class="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                        :disabled="acpMode.loading.value"
                      >
                        <span
                          class="truncate max-w-[120px] text-foreground"
                          :title="acpMode.currentModeName.value"
                        >
                          {{ acpMode.currentModeName.value }}
                        </span>
                        <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      class="w-64 border-none bg-transparent p-0 shadow-none"
                    >
                      <div class="rounded-lg border bg-card p-1 shadow-md max-h-56 overflow-y-auto">
                        <div
                          v-for="mode in acpMode.availableModes.value"
                          :key="mode.id"
                          :class="[
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                            acpMode.currentMode.value === mode.id
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted',
                            acpMode.loading.value ? 'opacity-60 cursor-not-allowed' : ''
                          ]"
                          @click="handleAcpModeSelect(mode.id)"
                        >
                          <Icon icon="lucide:shield" class="w-4 h-4" />
                          <span class="flex-1">{{ mode.name || mode.id }}</span>
                          <Icon
                            v-if="acpMode.currentMode.value === mode.id"
                            icon="lucide:check"
                            class="w-4 h-4"
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </span>
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
                    :title="modelSelectorLabel"
                  >
                    {{ modelSelectorLabel }}
                  </span>
                  <template v-if="!showAcpSessionModelSelector">
                    <Badge
                      v-for="tag in config.activeModel.value.tags"
                      :key="tag"
                      variant="outline"
                      class="py-0 px-1 rounded-lg text-[10px]"
                    >
                      {{ t(`model.tags.${tag}`) }}
                    </Badge>
                  </template>
                  <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" class="w-80 border-none bg-transparent p-0 shadow-none">
                <div
                  v-if="showAcpSessionModelSelector"
                  class="rounded-lg border bg-card p-1 shadow-md max-h-72 overflow-y-auto"
                >
                  <div
                    class="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {{ t('settings.model.acpSession.model.label') }}
                  </div>
                  <div
                    v-if="!acpSessionModel.hasModels.value"
                    class="px-2 py-2 text-xs text-muted-foreground"
                  >
                    {{ t('settings.model.acpSession.model.empty') }}
                  </div>
                  <div
                    v-for="model in acpSessionModel.availableModels.value"
                    :key="model.id"
                    :class="[
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                      acpSessionModel.currentModelId.value === model.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted',
                      acpSessionModel.loading.value ? 'opacity-60 cursor-not-allowed' : ''
                    ]"
                    @click="handleAcpSessionModelSelect(model.id)"
                  >
                    <Icon icon="lucide:cpu" class="w-4 h-4" />
                    <span class="flex-1">{{ model.name || model.id }}</span>
                    <Icon
                      v-if="acpSessionModel.currentModelId.value === model.id"
                      icon="lucide:check"
                      class="w-4 h-4"
                    />
                  </div>
                </div>
                <ModelChooser
                  v-else
                  :type="[ModelType.Chat, ModelType.ImageGeneration]"
                  @update:model="config.handleModelUpdate"
                />
              </PopoverContent>
            </Popover>

            <!-- Config Button (only in chat mode) -->
            <ScrollablePopover
              v-if="variant === 'chat' && !isAcpChatMode"
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
import { useAcpSessionModel } from './composables/useAcpSessionModel'
import { useChatMode, type ChatMode } from './composables/useChatMode'
import { useAgentWorkspace } from './composables/useAgentWorkspace'
import { useWorkspaceMention } from './composables/useWorkspaceMention'

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

const emit = defineEmits(['send', 'file-upload', 'model-update'])

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
const modelStore = useModelStore()
const themeStore = useThemeStore()

// === Presenters ===
const windowPresenter = usePresenter('windowPresenter')

// === i18n ===
const { t } = useI18n()

// === Local State ===
const fileInput = ref<HTMLInputElement>()
const modelSelectOpen = ref(false)
const acpModeSelectOpen = ref(false)
const editorContainer = ref<HTMLElement | null>(null)
const caretPosition = ref({ x: 0, y: 0, height: 18 })
const caretVisible = ref(false)
const fakeCaretStyle = computed(() => ({
  transform: `translate(${caretPosition.value.x}px, ${caretPosition.value.y}px)`,
  height: `${caretPosition.value.height}px`
}))
const showFakeCaret = computed(() => caretVisible.value && !props.disabled)

// === Composable Integrations ===

// Initialize settings management
const { settings, setWebSearch, toggleWebSearch } = useInputSettings()

// Initialize chat mode management
const chatMode = useChatMode()
const modeSelectOpen = ref(false)
const canUseWebSearch = computed(() => chatMode.currentMode.value === 'chat')
const isAcpChatMode = computed(() => chatMode.currentMode.value === 'acp agent')

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
  if (!editorContainer.value) return

  if (caretAnimationFrame) {
    cancelAnimationFrame(caretAnimationFrame)
  }

  caretAnimationFrame = requestAnimationFrame(() => {
    if (!editorContainer.value) return

    const view = editor.view
    const position = view.state.selection.$anchor.pos

    let coords
    try {
      coords = view.coordsAtPos(position)
    } catch (error) {
      return
    }

    const containerRect = editorContainer.value.getBoundingClientRect()
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

const acpAgentOptions = computed(() => {
  const providerEntry = modelStore.enabledModels.find((entry) => entry.providerId === 'acp')
  const models = providerEntry?.models ?? []
  return models
    .filter((model) => model.type === ModelType.Chat || model.type === ModelType.ImageGeneration)
    .map((model) => ({
      id: model.id,
      name: model.name,
      providerId: 'acp',
      type: model.type ?? ModelType.Chat
    }))
})

const selectedAcpAgentId = computed(() => {
  const active = activeModelSource.value
  return active?.providerId === 'acp' ? (active.id ?? null) : null
})

const isAgentModeSelected = computed(() => chatMode.currentMode.value !== 'acp agent')

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

const showAcpSessionModelSelector = computed(
  () => isAcpChatMode.value && acpSessionModel.isAcpModel.value
)

const modelSelectorLabel = computed(() => {
  if (!showAcpSessionModelSelector.value) {
    return config.modelDisplayName.value
  }
  if (acpSessionModel.currentModelName.value) {
    return acpSessionModel.currentModelName.value
  }
  return acpSessionModel.hasModels.value
    ? t('settings.model.acpSession.model.placeholder')
    : t('settings.model.acpSession.model.empty')
})

const handleAcpSessionModelSelect = async (modelId: string) => {
  if (acpSessionModel.loading.value) return
  await acpSessionModel.setModel(modelId)
  modelSelectOpen.value = false
}

const handleAcpModeSelect = async (modeId: string) => {
  if (acpMode.loading.value) return
  await acpMode.setMode(modeId)
  acpModeSelectOpen.value = false
}

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
      search: canUseWebSearch.value ? settings.value.webSearch : false,
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
  if (!canUseWebSearch.value) return
  await toggleWebSearch()
}

const applyModelSelection = (model: {
  id: string
  name: string
  providerId: string
  type?: ModelType
}) => {
  if (!model?.id || !model.providerId) return
  const payload = {
    id: model.id,
    name: model.name,
    providerId: model.providerId,
    type: model.type ?? ModelType.Chat
  }
  if (props.variant === 'chat') {
    config.handleModelUpdate(payload as any)
  } else {
    emit('model-update', payload as any, model.providerId)
  }
}

const pickFirstAcpModel = () => acpAgentOptions.value[0] ?? null

const pickFirstNonAcpModel = () => {
  for (const provider of modelStore.enabledModels) {
    if (provider.providerId === 'acp') continue
    const match = provider.models.find(
      (model) => model.type === ModelType.Chat || model.type === ModelType.ImageGeneration
    )
    if (match) {
      return {
        id: match.id,
        name: match.name,
        providerId: provider.providerId,
        type: match.type ?? ModelType.Chat
      }
    }
  }
  return null
}

const handleModeSelect = async (mode: ChatMode) => {
  await chatMode.setMode(mode)
  if (chatMode.currentMode.value !== mode) {
    modeSelectOpen.value = false
    return
  }

  if (mode !== 'acp agent' && activeModelSource.value?.providerId === 'acp') {
    const fallback = pickFirstNonAcpModel()
    if (fallback) {
      applyModelSelection(fallback)
    }
  } else if (mode === 'acp agent' && activeModelSource.value?.providerId !== 'acp') {
    const fallback = pickFirstAcpModel()
    if (fallback) {
      applyModelSelection(fallback)
    }
  }

  if (conversationId.value) {
    try {
      await chatStore.updateChatConfig({ chatMode: mode })
    } catch (error) {
      console.warn('Failed to update chat mode in conversation settings:', error)
    }
  }
  modeSelectOpen.value = false
}

const handleAcpAgentSelect = async (agent: {
  id: string
  name: string
  providerId: string
  type?: ModelType
}) => {
  await chatMode.setMode('acp agent')
  if (chatMode.currentMode.value !== 'acp agent') {
    modeSelectOpen.value = false
    return
  }
  applyModelSelection(agent)
  if (conversationId.value) {
    try {
      await chatStore.updateChatConfig({ chatMode: 'acp agent' })
    } catch (error) {
      console.warn('Failed to update chat mode in conversation settings:', error)
    }
  }
  modeSelectOpen.value = false
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
useEventListener(editorContainer, 'scroll', updateFakeCaretPosition)

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
  () => chatStore.chatConfig.providerId,
  () => {
    rateLimit.loadRateLimitStatus()
  }
)

watch(
  () => [chatMode.currentMode.value, settings.value.webSearch] as const,
  ([mode, webSearch]) => {
    if (mode !== 'chat' && webSearch) {
      void setWebSearch(false)
    }
  },
  { immediate: true }
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
