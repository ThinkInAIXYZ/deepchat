<template>
  <div class="h-full w-full flex flex-col items-center justify-start">
    <div class="h-0 w-full grow flex flex-col items-center justify-center">
      <img src="@/assets/logo-dark.png" class="w-24 h-24" loading="lazy" />
      <h1 class="text-2xl font-bold px-8 pt-4">{{ t('newThread.greeting') }}</h1>
      <h3 class="text-lg px-8 pb-2">{{ t('newThread.prompt') }}</h3>
      <div class="h-12"></div>
      <ChatInput
        ref="chatInputRef"
        key="newThread"
        variant="newThread"
        class="shrink-0 px-4"
        :rows="3"
        :max-rows="10"
        :context-length="contextLength"
        :model-info="{ id: activeModel.id, providerId: activeModel.providerId }"
        @send="handleSend"
        @model-update="handleModelUpdate"
      >
        <template #addon-actions>
          <Popover v-model:open="modelSelectOpen">
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                size="sm"
              >
                <ModelIcon
                  v-if="activeModel.providerId === 'acp'"
                  class="w-4 h-4"
                  :model-id="activeModel.id"
                  :is-dark="themeStore.isDark"
                ></ModelIcon>
                <ModelIcon
                  v-else
                  class="w-4 h-4"
                  :model-id="activeModel.providerId"
                  :is-dark="themeStore.isDark"
                ></ModelIcon>
                <span class="text-xs font-semibold truncate max-w-[140px] text-foreground">{{
                  modelSelectorLabel
                }}</span>
                <template v-if="!isAcpMode">
                  <Badge
                    v-for="tag in activeModel.tags"
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
            <PopoverContent align="end" class="w-80 p-0">
              <div
                v-if="isAcpMode"
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

                <div
                  class="mt-1 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                >
                  {{ t('settings.model.acpSession.mode.label') }}
                </div>
                <div
                  v-if="!acpMode.hasAgentModes.value"
                  class="px-2 py-2 text-xs text-muted-foreground"
                >
                  {{ t('settings.model.acpSession.mode.empty') }}
                </div>
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
                  @click="handleAcpSessionModeSelect(mode.id)"
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
              <ModelSelect
                v-else
                :type="[ModelType.Chat, ModelType.ImageGeneration]"
                @update:model="handleModelUpdate"
              />
            </PopoverContent>
          </Popover>

          <ScrollablePopover
            v-if="!isAcpMode"
            v-model:open="settingsPopoverOpen"
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
              v-model:temperature="temperature"
              v-model:context-length="contextLength"
              v-model:max-tokens="maxTokens"
              v-model:system-prompt="systemPrompt"
              v-model:artifacts="artifacts"
              v-model:thinking-budget="thinkingBudget"
              v-model:enable-search="enableSearch"
              v-model:forced-search="forcedSearch"
              v-model:search-strategy="searchStrategy"
              v-model:reasoning-effort="reasoningEffort"
              v-model:verbosity="verbosity"
              :context-length-limit="contextLengthLimit"
              :max-tokens-limit="maxTokensLimit"
              :model-id="activeModel?.id"
              :provider-id="activeModel?.providerId"
              :model-type="activeModel?.type"
            />
          </ScrollablePopover>
        </template>
      </ChatInput>
      <div class="h-12"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ChatInput from './chat-input/ChatInput.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import ScrollablePopover from './ScrollablePopover.vue'
import { Button } from '@shadcn/components/ui/button'
import ModelIcon from './icons/ModelIcon.vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Icon } from '@iconify/vue'
import ModelSelect from './ModelSelect.vue'
import { useChatStore } from '@/stores/chat'
import { useWorkspaceStore } from '@/stores/workspace'
import { MODEL_META } from '@shared/presenter'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { UserMessageContent } from '@shared/chat'
import ChatConfig from './ChatConfig.vue'
import { usePresenter } from '@/composables/usePresenter'
import { useThemeStore } from '@/stores/theme'
import { ModelType } from '@shared/model'
import type { IpcRendererEvent } from 'electron'
import { CONFIG_EVENTS } from '@/events'
import { useModelStore } from '@/stores/modelStore'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useChatMode, type ChatMode } from '@/components/chat-input/composables/useChatMode'
import { useAcpMode } from '@/components/chat-input/composables/useAcpMode'
import { useAcpSessionModel } from '@/components/chat-input/composables/useAcpSessionModel'
import { calculateSafeDefaultMaxTokens, GLOBAL_OUTPUT_TOKEN_MAX } from '@/utils/maxOutputTokens'

const configPresenter = usePresenter('configPresenter')
const skillPresenter = usePresenter('skillPresenter')
const themeStore = useThemeStore()
const chatMode = useChatMode()
// 定义偏好模型的类型
interface PreferredModel {
  modelId: string
  providerId: string
}

const { t } = useI18n()
const chatStore = useChatStore()
const workspaceStore = useWorkspaceStore()
const modelStore = useModelStore()
const uiSettingsStore = useUiSettingsStore()
const activeModel = ref({
  name: '',
  id: '',
  providerId: '',
  tags: [],
  type: ModelType.Chat
} as {
  name: string
  id: string
  providerId: string
  tags: string[]
  type: ModelType
})

const temperature = ref(0.6)
const contextLength = ref(16384)
const contextLengthLimit = ref(16384)
const maxTokens = ref(GLOBAL_OUTPUT_TOKEN_MAX)
const maxTokensLimit = ref(GLOBAL_OUTPUT_TOKEN_MAX)
const systemPrompt = ref('')
const artifacts = ref(uiSettingsStore.artifactsEffectEnabled ? 1 : 0)
const thinkingBudget = ref<number | undefined>(undefined)
const enableSearch = ref<boolean | undefined>(undefined)
const forcedSearch = ref<boolean | undefined>(undefined)
const searchStrategy = ref<'turbo' | 'max' | undefined>(undefined)
const reasoningEffort = ref<'minimal' | 'low' | 'medium' | 'high' | undefined>(undefined)
const verbosity = ref<'low' | 'medium' | 'high' | undefined>(undefined)

const handleDefaultSystemPromptChange = async (
  _event: IpcRendererEvent,
  payload: { promptId?: string; content?: string }
) => {
  if (typeof payload?.content === 'string') {
    systemPrompt.value = payload.content
    return
  }

  const prompt = await configPresenter.getDefaultSystemPrompt()
  systemPrompt.value = prompt
}

const name = computed(() => {
  return activeModel.value?.name ? activeModel.value.name.split('/').pop() : ''
})

const acpWorkdirMap = computed(() => chatStore.chatConfig.acpWorkdirMap ?? {})
const conversationId = computed(() => chatStore.activeThread?.id ?? null)
const isAcpMode = computed(() => chatMode.currentMode.value === 'acp agent')
const acpSessionTargetModel = computed(() => ({
  id: activeModel.value.id,
  providerId: activeModel.value.providerId
}))

const pendingAcpWorkdir = computed(() => {
  if (activeModel.value.providerId !== 'acp') return null
  return acpWorkdirMap.value?.[activeModel.value.id] ?? null
})

const acpSessionModel = useAcpSessionModel({
  activeModel: acpSessionTargetModel,
  conversationId,
  workdir: pendingAcpWorkdir
})

const acpMode = useAcpMode({
  activeModel: acpSessionTargetModel,
  conversationId,
  workdir: pendingAcpWorkdir
})

const modelSelectorLabel = computed(() => {
  if (!isAcpMode.value || activeModel.value.providerId !== 'acp') {
    return name.value
  }
  if (acpSessionModel.currentModelName.value) {
    return acpSessionModel.currentModelName.value
  }
  return acpSessionModel.hasModels.value
    ? t('settings.model.acpSession.model.placeholder')
    : t('settings.model.acpSession.model.empty')
})

watch(
  () => activeModel.value,
  async () => {
    // console.log('activeModel', activeModel.value)
    const config = await configPresenter.getModelDefaultConfig(
      activeModel.value.id,
      activeModel.value.providerId
    )
    temperature.value = config.temperature ?? 0.7
    contextLength.value = config.contextLength
    contextLengthLimit.value = config.contextLength
    maxTokensLimit.value = config.maxTokens

    const safeDefaultMaxTokens = calculateSafeDefaultMaxTokens({
      modelMaxTokens: config.maxTokens || GLOBAL_OUTPUT_TOKEN_MAX,
      thinkingBudget: config.thinkingBudget,
      reasoningSupported: Boolean(config.reasoning)
    })

    maxTokens.value = safeDefaultMaxTokens

    if (maxTokens.value > (config.maxTokens || GLOBAL_OUTPUT_TOKEN_MAX)) {
      maxTokens.value = config.maxTokens || GLOBAL_OUTPUT_TOKEN_MAX
    }
    thinkingBudget.value = config.thinkingBudget
    enableSearch.value = config.enableSearch
    forcedSearch.value = config.forcedSearch
    searchStrategy.value = config.searchStrategy
    reasoningEffort.value = config.reasoningEffort
    verbosity.value = config.verbosity
    // console.log('temperature', temperature.value)
    // console.log('contextLength', contextLength.value)
    // console.log('maxTokens', maxTokens.value)
  }
)
// 初始化与校验逻辑：只在激活时初始化一次；仅监听 enabledModels 变化做有效性校验
const initialized = ref(false)

const findEnabledModel = (providerId: string, modelId: string) => {
  for (const provider of modelStore.enabledModels) {
    if (provider.providerId === providerId) {
      for (const model of provider.models) {
        if (model.id === modelId) {
          return { model, providerId: provider.providerId }
        }
      }
    }
  }
  return undefined
}

const pickFirstEnabledModel = () => {
  const found = modelStore.enabledModels
    .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.providerId })))
    .find((m) => m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
  return found
}

const pickFirstAcpModel = () => {
  const found = modelStore.enabledModels
    .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.providerId })))
    .find(
      (m) =>
        m.providerId === 'acp' &&
        (m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
    )
  return found
}

const pickFirstNonAcpModel = () => {
  const found = modelStore.enabledModels
    .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.providerId })))
    .find(
      (m) =>
        m.providerId !== 'acp' &&
        (m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
    )
  return found
}

const pickModelForMode = (mode: ChatMode) => {
  return mode === 'acp agent' ? pickFirstAcpModel() : pickFirstNonAcpModel()
}

const matchesModeProvider = (providerId: string | undefined, mode: ChatMode) => {
  if (!providerId) return false
  if (mode === 'acp agent') return providerId === 'acp'
  return providerId !== 'acp'
}

const setActiveFromEnabled = (m: {
  name: string
  id: string
  providerId: string
  type?: ModelType
}) => {
  activeModel.value = {
    name: m.name,
    id: m.id,
    providerId: m.providerId,
    tags: [],
    type: m.type ?? ModelType.Chat
  }
  void chatStore.updateChatConfig({
    modelId: m.id,
    providerId: m.providerId
  })
}

const syncModelWithMode = (mode: ChatMode, persistPreference = false) => {
  const currentProviderId = activeModel.value.providerId
  const isCurrentAcp = currentProviderId === 'acp'
  const shouldBeAcp = mode === 'acp agent'

  if (isCurrentAcp === shouldBeAcp) {
    return
  }

  const targetModel = pickModelForMode(mode) ?? pickFirstEnabledModel()
  if (!targetModel) return

  setActiveFromEnabled(targetModel)
  if (persistPreference) {
    configPresenter.setSetting('preferredModel', {
      modelId: targetModel.id,
      providerId: targetModel.providerId
    })
  }
}

const initActiveModel = async () => {
  if (initialized.value) return
  const currentMode = chatMode.currentMode.value
  // 1) 尝试根据最近会话（区分 pinned/非 pinned）选择
  if (chatStore.threads.length > 0) {
    const pinnedGroup = chatStore.threads.find((g) => g.dt === 'Pinned')
    const pinnedFirst = pinnedGroup?.dtThreads?.[0]
    const normalGroup = chatStore.threads.find((g) => g.dt !== 'Pinned' && g.dtThreads.length > 0)
    const normalFirst = normalGroup?.dtThreads?.[0]
    const candidate = [pinnedFirst, normalFirst]
      .filter(Boolean)
      .sort((a, b) => (b!.updatedAt || 0) - (a!.updatedAt || 0))[0] as
      | typeof pinnedFirst
      | undefined
    if (candidate?.settings?.modelId && candidate?.settings?.providerId) {
      const match = findEnabledModel(candidate.settings.providerId, candidate.settings.modelId)
      if (match && matchesModeProvider(candidate.settings.providerId, currentMode)) {
        setActiveFromEnabled({ ...match.model, providerId: match.providerId })
        initialized.value = true
        syncModelWithMode(chatMode.currentMode.value)
        return
      }
    }
  }

  // 2) 尝试用户上次选择的偏好模型
  try {
    const preferredModel = (await configPresenter.getSetting('preferredModel')) as
      | PreferredModel
      | undefined
    if (preferredModel?.modelId && preferredModel?.providerId) {
      const match = findEnabledModel(preferredModel.providerId, preferredModel.modelId)
      if (match && matchesModeProvider(preferredModel.providerId, currentMode)) {
        setActiveFromEnabled({ ...match.model, providerId: match.providerId })
        initialized.value = true
        syncModelWithMode(chatMode.currentMode.value)
        return
      }
    }
  } catch (error) {
    console.warn('Failed to get user preferred model:', error)
  }

  // 3) 选择第一个可用模型
  const first = pickModelForMode(currentMode) ?? pickFirstEnabledModel()
  if (first) {
    setActiveFromEnabled(first)
    initialized.value = true
    syncModelWithMode(chatMode.currentMode.value)
  }
}

// 仅监听 enabledModels：
// - 若未初始化，进行一次初始化
// - 若已初始化但当前模型不再可用，则回退到第一个 enabled 模型
watch(
  () => modelStore.enabledModels,
  async () => {
    if (!initialized.value) {
      await initActiveModel()
      return
    }

    // 校验当前模型是否仍可用
    const current = activeModel.value
    if (!current?.id || !current?.providerId) {
      const first = pickModelForMode(chatMode.currentMode.value) ?? pickFirstEnabledModel()
      if (first) setActiveFromEnabled(first)
      return
    }
    const stillExists = !!findEnabledModel(current.providerId, current.id)
    if (!stillExists) {
      const first = pickModelForMode(chatMode.currentMode.value) ?? pickFirstEnabledModel()
      if (first) setActiveFromEnabled(first)
    }
  },
  { immediate: false, deep: true }
)

// 监听 chat mode 变化，自动切换模型
watch(
  () => chatMode.currentMode.value,
  async (newMode, oldMode) => {
    // 只在 mode 真正变化时切换模型，避免初始化时触发
    if (!initialized.value || newMode === oldMode) {
      return
    }

    syncModelWithMode(newMode, true)
  },
  { immediate: false }
)

const modelSelectOpen = ref(false)
const settingsPopoverOpen = ref(false)
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)

const handleModelUpdate = (model: MODEL_META, providerId: string) => {
  activeModel.value = {
    name: model.name,
    id: model.id,
    providerId: providerId,
    tags: [],
    type: model.type ?? ModelType.Chat
  }
  chatStore.updateChatConfig({
    modelId: model.id,
    providerId: providerId
  })

  // 保存用户的模型偏好设置
  configPresenter.setSetting('preferredModel', {
    modelId: model.id,
    providerId: providerId
  })

  modelSelectOpen.value = false
}

const handleAcpSessionModelSelect = async (modelId: string) => {
  if (acpSessionModel.loading.value) return
  await acpSessionModel.setModel(modelId)
  modelSelectOpen.value = false
}

const handleAcpSessionModeSelect = async (modeId: string) => {
  if (acpMode.loading.value) return
  await acpMode.setMode(modeId)
  modelSelectOpen.value = false
}

// 监听 deeplinkCache 变化
watch(
  () => chatStore.deeplinkCache,
  (newCache) => {
    if (newCache) {
      if (newCache.modelId) {
        const matchedModel = modelStore.findModelByIdOrName(newCache.modelId)
        console.log('matchedModel', matchedModel)
        if (matchedModel) {
          handleModelUpdate(matchedModel.model, matchedModel.providerId)
        }
      }
      if (newCache.msg || newCache.mentions) {
        const setInputContent = () => {
          if (chatInputRef.value) {
            console.log('[NewThread] Setting input content, msg:', newCache.msg)
            const chatInput = chatInputRef.value
            chatInput.clearContent()
            if (newCache.mentions) {
              newCache.mentions.forEach((mention) => {
                chatInput.appendMention(mention)
              })
            }
            if (newCache.msg) {
              console.log('[NewThread] Appending text:', newCache.msg)
              chatInput.appendText(newCache.msg)
            }
            return true
          }
          return false
        }

        if (!setInputContent()) {
          console.log('[NewThread] ChatInput ref not ready, retrying...')
          nextTick(() => {
            if (!setInputContent()) {
              setTimeout(() => {
                if (!setInputContent()) {
                  console.warn('[NewThread] Failed to set input content after retries')
                }
              }, 100)
            }
          })
        }
      }
      if (newCache.systemPrompt) {
        systemPrompt.value = newCache.systemPrompt
      }
      if (newCache.autoSend && newCache.msg) {
        handleSend({
          text: newCache.msg || '',
          files: [],
          links: [],
          think: false,
          search: false
        })
      }
      // 清理缓存
      chatStore.clearDeeplinkCache()
    }
  },
  { immediate: true }
)

onMounted(async () => {
  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.DEFAULT_SYSTEM_PROMPT_CHANGED,
      handleDefaultSystemPromptChange
    )
  }

  configPresenter.getDefaultSystemPrompt().then((prompt) => {
    systemPrompt.value = prompt
  })
  // 组件激活时初始化一次默认模型
  await initActiveModel()
})

onBeforeUnmount(() => {
  window.electron?.ipcRenderer?.removeListener(
    CONFIG_EVENTS.DEFAULT_SYSTEM_PROMPT_CHANGED,
    handleDefaultSystemPromptChange
  )
})

const handleSend = async (content: UserMessageContent) => {
  const chatInput = chatInputRef.value
  const pathFromInput = chatInput?.getAgentWorkspacePath?.()
  const pathFromStore = chatStore.chatConfig.agentWorkspacePath
  const chatMode = chatInput?.getChatMode?.()
  const agentWorkspacePath = pathFromInput ?? pathFromStore ?? undefined

  // Get pending skills before creating thread (will be cleared after consumption)
  const pendingSkills = chatInput?.getPendingSkills?.() ?? []

  const threadId = await chatStore.createThread(content.text, {
    providerId: activeModel.value.providerId,
    modelId: activeModel.value.id,
    chatMode,
    systemPrompt: systemPrompt.value,
    temperature: temperature.value,
    contextLength: contextLength.value,
    maxTokens: maxTokens.value,
    artifacts: artifacts.value as 0 | 1,
    thinkingBudget: thinkingBudget.value,
    enableSearch: enableSearch.value,
    forcedSearch: forcedSearch.value,
    searchStrategy: searchStrategy.value,
    reasoningEffort: reasoningEffort.value,
    verbosity: verbosity.value,
    enabledMcpTools: chatStore.chatConfig.enabledMcpTools,
    agentWorkspacePath,
    acpWorkdirMap:
      pendingAcpWorkdir.value && activeModel.value.providerId === 'acp'
        ? { [activeModel.value.id]: pendingAcpWorkdir.value }
        : undefined
  } as any)
  console.log('threadId', threadId, activeModel.value)

  // Apply pending skills to the newly created thread
  if (threadId && pendingSkills.length > 0) {
    try {
      await skillPresenter.setActiveSkills(threadId, pendingSkills)
      // Consume the pending skills from ChatInput
      chatInput?.consumePendingSkills?.()
    } catch (error) {
      console.error('[NewThread] Failed to apply pending skills:', error)
    }
  }

  if (chatMode === 'agent' || chatMode === 'acp agent') {
    await workspaceStore.refreshFileTree()
  }
  chatStore.sendMessage(content)
}
</script>
