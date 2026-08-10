<template>
  <div class="border rounded-lg overflow-hidden">
    <div
      class="flex items-center p-4 hover:bg-accent cursor-default"
      @click="toggleBuiltinConfigPanel"
    >
      <div class="flex-1">
        <div class="flex items-center">
          <Icon icon="lucide:book-open" class="h-5 mr-2 text-primary" />
          <span class="text-base font-medium">{{
            $t('settings.knowledgeBase.builtInKnowledgeTitle')
          }}</span>
        </div>
        <p class="text-sm text-muted-foreground mt-1">
          {{ t('settings.knowledgeBase.builtInKnowledgeDescription') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <!-- MCP开关 -->
        <TooltipProvider>
          <Tooltip :delay-duration="200">
            <TooltipTrigger>
              <Switch
                :model-value="isBuiltinMcpEnabled"
                :disabled="!mcpStore.mcpEnabled || operationPending"
                @click.stop
                @update:model-value="toggleBuiltinMcpServer"
              />
            </TooltipTrigger>
            <TooltipContent v-if="!mcpStore.mcpEnabled">
              <p>{{ t('settings.mcp.enableToAccess') }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Icon
          :icon="isBuiltinConfigPanelOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
          class="w-4 h-4"
        />
      </div>
    </div>
    <Collapsible v-model:open="isBuiltinConfigPanelOpen">
      <CollapsibleContent>
        <div class="p-4 border-t space-y-4">
          <div v-if="panelError" role="alert" class="space-y-0.5 text-xs text-destructive">
            <p>{{ panelError.title }}</p>
            <p v-if="panelError.description" class="text-muted-foreground">
              {{ panelError.description }}
            </p>
          </div>
          <div v-if="builtinConfigs.length > 0" class="space-y-3">
            <div
              v-for="(config, index) in builtinConfigs"
              :key="index"
              class="p-3 border rounded-md relative"
            >
              <div class="absolute top-2 right-2 flex gap-2">
                <Switch
                  :model-value="config.enabled === true"
                  :disabled="operationPending"
                  size="sm"
                  @update:model-value="(value) => toggleConfigEnabled(index, value)"
                />
                <button
                  type="button"
                  :disabled="operationPending"
                  class="text-muted-foreground hover:text-primary"
                  @click="handleSetting(config)"
                >
                  <Icon icon="lucide:file-diff" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  :disabled="operationPending"
                  class="text-muted-foreground hover:text-primary"
                  @click="editBuiltinConfig(index)"
                >
                  <Icon icon="lucide:edit" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  :disabled="operationPending"
                  class="text-muted-foreground hover:text-destructive"
                  data-testid="builtin-knowledge-remove-trigger"
                  @click="requestRemoveBuiltinConfig(config)"
                >
                  <Icon icon="lucide:trash-2" class="h-4 w-4" />
                </button>
              </div>
              <div class="grid gap-2">
                <div class="flex items-center">
                  <span class="font-medium text-sm w-[calc(100%-120px)]">{{
                    config.description
                  }}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <b class="font-medium"> {{ t('settings.knowledgeBase.embeddingModel') }}:</b>
                    <span> {{ config.embedding.modelId }} </span>
                  </div>
                  <span v-if="config.rerank && config.rerank.modelId">
                    <b class="font-medium">{{ t('settings.knowledgeBase.rerankModel') }}:</b>
                    <span> {{ config.rerank.modelId }} </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-center">
            <DcButton
              type="button"
              :disabled="operationPending"
              size="sm"
              class="w-full flex items-center justify-center gap-2"
              variant="outline"
              @click="openAddConfig"
            >
              <Icon icon="lucide:plus" class="w-8 h-4" />
              {{ t('settings.knowledgeBase.addBuiltinKnowledgeConfig') }}
            </DcButton>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
    <DcConfirmDialog
      :open="removeDialogOpen"
      :title="
        t('settings.knowledgeBase.removeBuiltinKnowledgeConfirmTitle', {
          name: removeTargetDescription
        })
      "
      :description="t('settings.knowledgeBase.removeBuiltinKnowledgeConfirmDesc')"
      :busy="operationPending"
      :confirm-attrs="{ 'data-testid': 'builtin-knowledge-remove-confirm' }"
      :cancel-attrs="{ 'data-testid': 'builtin-knowledge-remove-cancel' }"
      busy-data-testid="builtin-knowledge-remove-spinner"
      @update:open="handleRemoveDialogOpenChange"
      @confirm="removeBuiltinConfig"
    />
    <Dialog :open="isBuiltinConfigDialogOpen" @update:open="handleDialogOpenChange">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{
            isEditing
              ? t('settings.knowledgeBase.editBuiltinKnowledgeConfig')
              : t('settings.knowledgeBase.addBuiltinKnowledgeConfig')
          }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.knowledgeBase.builtInKnowledgeDescription') }}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea class="max-h-[500px]">
          <div
            class="p-3"
            :class="{ 'pointer-events-none opacity-70': operationPending }"
            :inert="operationPending"
          >
            <div class="space-y-4 py-4">
              <div class="space-y-2">
                <Label
                  class="text-xs text-muted-foreground"
                  for="edit-builtin-config-description"
                  >{{ t('settings.knowledgeBase.descriptionDesc') }}</Label
                >
                <Input
                  id="edit-builtin-config-description"
                  v-model="editingBuiltinConfig.description"
                  :placeholder="t('settings.knowledgeBase.descriptionPlaceholder')"
                />
              </div>
              <div class="space-y-2">
                <div class="flex items-center gap-1">
                  <Label class="text-xs text-muted-foreground" for="edit-builtin-config-model">
                    {{ t('settings.knowledgeBase.selectEmbeddingModel') }}
                  </Label>
                  <TooltipProvider>
                    <Tooltip :delay-duration="200">
                      <TooltipTrigger as-child>
                        <Icon
                          icon="lucide:circle-question-mark"
                          class="text-primary outline-none focus:outline-none text-sm"
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{{ t('settings.knowledgeBase.selectEmbeddingModelHelper') }}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Popover v-model:open="embeddingModelSelectOpen">
                  <PopoverTrigger as-child>
                    <DcButton
                      id="edit-builtin-config-model"
                      variant="outline"
                      class="w-full justify-between"
                      :disabled="isEditing"
                    >
                      <div class="flex items-center gap-2">
                        <ModelIcon
                          :model-id="selectEmbeddingModel?.id || ''"
                          class="h-4 w-4"
                          :is-dark="themeStore.isDark"
                        />
                        <span class="truncate">{{
                          selectEmbeddingModel?.name || t('settings.common.selectModel')
                        }}</span>
                      </div>
                      <DcButton
                        size="sm"
                        variant="ghost"
                        class="text-xs text-muted-foreground rounded-full w-6 h-6 flex items-center justify-center"
                      >
                        <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                      </DcButton>
                    </DcButton>
                  </PopoverTrigger>
                  <PopoverContent class="w-80 p-0">
                    <ModelSelect
                      :type="[ModelType.Embedding]"
                      :respect-chat-mode="false"
                      @update:model="handleEmbeddingModelSelect"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div class="space-y-2" v-if="false">
                <div class="flex items-center gap-1">
                  <Label class="text-xs text-muted-foreground" for="edit-builtin-config-model">
                    {{ t('settings.knowledgeBase.selectRerankModel') }}
                  </Label>
                </div>
                <Popover v-model:open="rerankModelSelectOpen">
                  <PopoverTrigger as-child>
                    <DcButton
                      id="edit-builtin-config-model"
                      variant="outline"
                      class="w-full justify-between"
                    >
                      <div class="flex items-center gap-2">
                        <ModelIcon
                          :model-id="selectRerankModel?.id || ''"
                          class="h-4 w-4"
                          :is-dark="themeStore.isDark"
                        />
                        <span class="truncate">
                          {{ selectRerankModel?.name || t('settings.common.selectModel') }}
                        </span>
                      </div>
                      <DcButton
                        size="sm"
                        variant="ghost"
                        v-if="selectRerankModel"
                        class="text-xs text-muted-foreground rounded-full w-6 h-6 flex items-center justify-center hover:bg-zinc-200"
                        @click.stop="clearRerankModel"
                      >
                        <Icon icon="lucide:x" class="w-4 h-4 text-muted-foreground" />
                      </DcButton>
                      <DcButton
                        size="sm"
                        variant="ghost"
                        v-else
                        class="text-xs text-muted-foreground rounded-full w-6 h-6 flex items-center justify-center"
                      >
                        <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                      </DcButton>
                    </DcButton>
                  </PopoverTrigger>
                  <PopoverContent class="w-80 p-0">
                    <ModelSelect
                      :type="[ModelType.Rerank]"
                      :respect-chat-mode="false"
                      @update:model="handleRerankModelSelect"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div class="space-y-2" v-if="!isEditing">
                <div class="flex items-center gap-1 justify-between">
                  <div class="flex items-center gap-1">
                    <Label
                      class="text-xs text-muted-foreground"
                      for="edit-builtin-config-dimensions"
                    >
                      {{ t('settings.knowledgeBase.autoDetectDimensions') }}
                    </Label>
                    <TooltipProvider>
                      <Tooltip :delay-duration="200">
                        <TooltipTrigger as-child>
                          <Icon
                            icon="lucide:circle-question-mark"
                            class="text-primary outline-none focus:outline-none text-sm"
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{{ t('settings.knowledgeBase.autoDetectHelper') }}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Switch
                    id="edit-builtin-config-auto-detect-switch"
                    :model-value="autoDetectDimensionsSwitch"
                    @update:model-value="(value) => (autoDetectDimensionsSwitch = value)"
                  ></Switch>
                </div>
              </div>
              <div class="space-y-2" v-if="!autoDetectDimensionsSwitch">
                <div class="flex items-center gap-1 justify-between">
                  <div class="flex items-center gap-1">
                    <Label
                      class="text-xs text-muted-foreground"
                      for="edit-builtin-config-dimensions"
                    >
                      {{ t('settings.knowledgeBase.dimensions') }}
                    </Label>
                    <TooltipProvider>
                      <Tooltip :delay-duration="200">
                        <TooltipTrigger as-child>
                          <Icon
                            icon="lucide:circle-question-mark"
                            class="text-primary outline-none focus:outline-none text-sm"
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>⚠️ {{ t('settings.knowledgeBase.dimensionsHelper') }}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
                <Input
                  id="edit-builtin-config-dimensions"
                  type="number"
                  :min="1"
                  v-model="editingBuiltinConfig.dimensions"
                  :placeholder="t('settings.knowledgeBase.dimensionsPlaceholder')"
                  :disabled="isEditing"
                ></Input>
              </div>
              <div class="space-y-2" v-if="!autoDetectDimensionsSwitch">
                <div class="flex items-center gap-1 justify-between">
                  <div class="flex items-center gap-1">
                    <Label
                      class="text-xs text-muted-foreground"
                      for="edit-builtin-config-dimensions"
                    >
                      {{ t('settings.knowledgeBase.normalized') }}
                    </Label>
                    <TooltipProvider>
                      <Tooltip :delay-duration="200">
                        <TooltipTrigger as-child>
                          <Icon
                            icon="lucide:circle-question-mark"
                            class="text-primary outline-none focus:outline-none text-sm"
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>⚠️ {{ t('settings.knowledgeBase.normalizedHelper') }}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Switch
                    id="edit-builtin-config-auto-detect-switch"
                    :model-value="editingBuiltinConfig.normalized"
                    :disabled="isEditing"
                    @update:model-value="(value) => (editingBuiltinConfig.normalized = value)"
                  ></Switch>
                </div>
              </div>
              <Accordion type="multiple" collapsed>
                <AccordionItem value="chunkSize" class="border-none">
                  <AccordionTrigger>
                    <p>{{ t('settings.knowledgeBase.advanced') }}</p>
                  </AccordionTrigger>
                  <AccordionContent class="space-y-4">
                    <div class="space-y-2">
                      <div class="flex items-center gap-1">
                        <Label
                          class="text-xs text-muted-foreground"
                          for="edit-builtin-config-separators"
                        >
                          {{ t('settings.knowledgeBase.separators') }}
                        </Label>
                        <TooltipProvider>
                          <Tooltip :delay-duration="200">
                            <TooltipTrigger as-child>
                              <Icon
                                icon="lucide:circle-question-mark"
                                class="text-primary outline-none focus:outline-none"
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p class="w-64">
                                {{ t('settings.knowledgeBase.separatorsHelper') }}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div class="flex items-center gap-2">
                        <Input
                          id="edit-builtin-config-separators"
                          v-model="separators"
                          placeholder='"\n\n", "\n", " ", ""'
                          class="flex-1"
                        ></Input>
                        <Popover v-model:open="separatorsPopoverOpen">
                          <PopoverTrigger as-child>
                            <DcButton
                              size="sm"
                              variant="ghost"
                              class="whitespace-nowrap"
                              :tooltip="t('settings.knowledgeBase.separatorsPreset')"
                            >
                              <Icon icon="lucide:book-marked" class="w-4 h-4 text-primary" />
                            </DcButton>
                          </PopoverTrigger>
                          <PopoverContent class="w-40 p-2">
                            <div class="space-y-2">
                              <div class="text-sm text-muted-foreground">
                                {{ t('settings.knowledgeBase.selectLanguage') }}
                              </div>
                              <div class="max-h-48 overflow-y-auto space-y-1">
                                <DcButton
                                  v-for="language in supportedLanguages"
                                  :key="language"
                                  variant="ghost"
                                  size="sm"
                                  class="w-full justify-start text-left"
                                  @click="handleLanguageSelect(language)"
                                >
                                  {{ language }}
                                </DcButton>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    <div class="space-y-2">
                      <div class="flex items-center gap-1">
                        <Label
                          class="text-xs text-muted-foreground"
                          for="edit-builtin-config-chunk-size"
                        >
                          {{ t('settings.knowledgeBase.chunkSize') }}
                        </Label>
                        <TooltipProvider>
                          <Tooltip :delay-duration="200">
                            <TooltipTrigger as-child>
                              <Icon
                                icon="lucide:circle-question-mark"
                                class="text-primary outline-none focus:outline-none"
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p class="w-64">
                                {{ t('settings.knowledgeBase.chunkSizeHelper') }}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Input
                        id="edit-builtin-config-chunk-size"
                        type="number"
                        :min="1"
                        :max="selectEmbeddingModel?.maxTokens"
                        v-model="editingBuiltinConfig.chunkSize"
                        :placeholder="t('settings.knowledgeBase.chunkSizePlaceholder')"
                        :step="128"
                      ></Input>
                    </div>
                    <div class="space-y-2">
                      <div class="flex items-center gap-1">
                        <Label
                          class="text-xs text-muted-foreground"
                          for="edit-builtin-config-chunk-overlap"
                        >
                          {{ t('settings.knowledgeBase.chunkOverlap') }}
                        </Label>
                        <TooltipProvider>
                          <Tooltip :delay-duration="200">
                            <TooltipTrigger as-child>
                              <Icon
                                icon="lucide:circle-question-mark"
                                class="text-primary outline-none focus:outline-none"
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p class="w-64">
                                {{ t('settings.knowledgeBase.chunkOverlapHelper') }}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Input
                        id="edit-builtin-config-chunk-overlap"
                        type="number"
                        :min="0"
                        :max="editingBuiltinConfig.chunkSize"
                        v-model="editingBuiltinConfig.chunkOverlap"
                        :placeholder="t('settings.knowledgeBase.chunkOverlapPlaceholder')"
                        :step="128"
                      ></Input>
                    </div>

                    <div class="space-y-2 mt-1">
                      <div class="flex justify-between">
                        <div class="flex items-center gap-1 mb-1">
                          <Label
                            class="text-xs text-muted-foreground"
                            for="edit-builtin-config-chunk-size"
                          >
                            {{ t('settings.knowledgeBase.fragmentsNumber') }}
                          </Label>
                          <TooltipProvider>
                            <Tooltip :delay-duration="200">
                              <TooltipTrigger as-child>
                                <Icon
                                  icon="lucide:circle-question-mark"
                                  class="text-primary outline-none focus:outline-none"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p class="w-64">
                                  {{ t('settings.knowledgeBase.fragmentsNumberHelper') }}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <span class="text-xs text-muted-foreground mr-1">
                          {{ fragmentsNumber[0] }}
                        </span>
                      </div>
                      <Slider v-model="fragmentsNumber" :min="1" :max="30" :step="1" />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <div class="mr-auto min-w-0 space-y-1">
            <DcInlineError v-if="dialogValidationError" :error="dialogValidationError" />
            <DcInlineError v-if="operationError" :error="operationError" />
          </div>
          <DcFormActions
            :submit-status="saveStatus"
            :submit-disabled="!isEditingBuiltinConfigValid || operationPending"
            :cancel-disabled="operationPending"
            :submit-label="isEditing ? t('common.confirm') : t('settings.knowledgeBase.addConfig')"
            @cancel="closeBuiltinConfigDialog"
            @submit="saveBuiltinConfig"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { Switch } from '@shadcn/components/ui/switch'
import { Collapsible, CollapsibleContent } from '@shadcn/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@shadcn/components/ui/dialog'
import { Slider } from '@shadcn/components/ui/slider'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcFormActions } from '@dc-ui/components/form-actions'
import { useDcFormSubmit } from '@dc-ui/components/form'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@shadcn/components/ui/accordion'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { useMcpStore } from '@/stores/mcp'
import { ModelType } from '@shared/model'
import { useThemeStore } from '@/stores/theme'
import type { RENDERER_MODEL_META } from '@shared/types/provider'
import type { BuiltinKnowledgeConfig } from '@shared/types/knowledge'
import { useRoute } from 'vue-router'
import { nanoid } from 'nanoid'
import { useModelStore } from '@/stores/modelStore'
import { createConfigClient } from '@api/ConfigClient'
import { createKnowledgeClient } from '@api/KnowledgeClient'
import { createProviderClient } from '@api/ProviderClient'
import { useKnowledgeConfigOperation } from '../lib/useKnowledgeConfigOperation'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'
// 全局对象
const { t } = useI18n()
const mcpStore = useMcpStore()
const modelStore = useModelStore()
const themeStore = useThemeStore()
const configClient = createConfigClient()
const knowledgeClient = createKnowledgeClient()
const providerClient = createProviderClient()
const knowledgeOperation = useKnowledgeConfigOperation()
const operationPending = knowledgeOperation.pending
const emit = defineEmits<{
  (e: 'showDetail', config: BuiltinKnowledgeConfig): void
}>()

// 嵌入模型下拉框
const embeddingModelSelectOpen = ref(false)
// 重排模型下拉框
const rerankModelSelectOpen = ref(false)
// 分隔符弹窗
const separatorsPopoverOpen = ref(false)
// 请求文档片段数量
const fragmentsNumber = ref<number[]>([6])

const isBuiltinConfigPanelOpen = ref(false)
const isEditing = ref(false)
const panelError = ref<{ title: string; description?: string } | null>(null)
const dialogValidationError = ref<string | null>(null)
const operationError = ref<string | null>(null)
const { status: saveStatus, run: runSave } = useDcFormSubmit()
const separators = ref('')
const supportedLanguages = ref<string[]>([])

// 自动检测维度开关
const autoDetectDimensionsSwitch = ref(true)
const clearRerankModel = () => {
  selectRerankModel.value = null
  delete editingBuiltinConfig.value.rerank
  rerankModelSelectOpen.value = false
}
const builtinConfigs = ref<Array<BuiltinKnowledgeConfig>>([])
type BuiltinRemoveRequest =
  | { status: 'idle' }
  | { status: 'confirming'; target: BuiltinKnowledgeConfig }
const removeRequest = shallowRef<BuiltinRemoveRequest>({ status: 'idle' })
const removeDialogOpen = computed(() => removeRequest.value.status === 'confirming')
const removeTargetDescription = computed(() =>
  removeRequest.value.status === 'confirming' ? removeRequest.value.target.description : ''
)

const cloneBuiltinConfig = (config: BuiltinKnowledgeConfig): BuiltinKnowledgeConfig => ({
  ...config,
  embedding: { ...config.embedding },
  ...(config.rerank ? { rerank: { ...config.rerank } } : {}),
  ...(config.separators ? { separators: [...config.separators] } : {})
})

// 正在编辑的配置
const editingBuiltinConfig = ref<BuiltinKnowledgeConfig>({
  id: '',
  description: '',
  embedding: {
    providerId: '',
    modelId: ''
  },
  dimensions: NaN,
  normalized: true,
  fragmentsNumber: 6,
  enabled: true
})
// 对话框状态
const isBuiltinConfigDialogOpen = ref(false)
const dialogInitialSignature = ref('')
const editingSignature = computed(() =>
  JSON.stringify({
    config: editingBuiltinConfig.value,
    separators: separators.value,
    fragmentsNumber: fragmentsNumber.value[0],
    autoDetectDimensions: autoDetectDimensionsSwitch.value
  })
)
const dialogDirty = computed(
  () => isBuiltinConfigDialogOpen.value && editingSignature.value !== dialogInitialSignature.value
)

// 当前选择的嵌入模型
const selectEmbeddingModel = ref<RENDERER_MODEL_META | null>(null)
// 当前选择的重排模型
const selectRerankModel = ref<RENDERER_MODEL_META | null>(null)

// 打开添加对话框
function openAddConfig() {
  if (operationPending.value) return
  isEditing.value = false
  editingBuiltinConfig.value = {
    id: nanoid(),
    description: '',
    embedding: {
      providerId: '',
      modelId: ''
    },
    dimensions: NaN,
    normalized: true,
    fragmentsNumber: 6,
    enabled: true
  }
  separators.value = ''
  fragmentsNumber.value = [6]
  selectEmbeddingModel.value = null
  selectRerankModel.value = null
  autoDetectDimensionsSwitch.value = true
  dialogValidationError.value = null
  operationError.value = null
  dialogInitialSignature.value = editingSignature.value
  isBuiltinConfigDialogOpen.value = true
}

defineExpose({
  openAddConfig
})

const editingConfigIndex = ref<number>(-1)

// 验证配置是否有效
const isEditingBuiltinConfigValid = computed(() => {
  const dimensions = Number(editingBuiltinConfig.value.dimensions)
  return (
    editingBuiltinConfig.value.description.trim() !== '' &&
    editingBuiltinConfig.value.embedding.providerId.trim() !== '' &&
    editingBuiltinConfig.value.embedding.modelId.trim() !== '' &&
    (autoDetectDimensionsSwitch.value || (Number.isFinite(dimensions) && dimensions > 0))
  )
})

// 获取已启用的模型配置
const getEnableModelConfig = (modelId: string, providerId: string): RENDERER_MODEL_META | null => {
  const provider = modelStore.enabledModels.find((p) => p.providerId === providerId)
  if (!provider || !Array.isArray(provider.models)) return null
  const model = provider.models.find((m) => m.id === modelId && m.enabled)
  return model || null
}

// 打开编辑对话框
const editBuiltinConfig = (index: number) => {
  if (operationPending.value || index < 0 || index >= builtinConfigs.value.length) return
  const config = builtinConfigs.value[index]
  // 设置当前选择的嵌入模型
  const embeddingModel = getEnableModelConfig(config.embedding.modelId, config.embedding.providerId)
  // 如果模型不存在或被禁用
  if (!embeddingModel || !embeddingModel.enabled) {
    panelError.value = {
      title: t('settings.knowledgeBase.modelNotFound', {
        provider: t(config.embedding.providerId),
        model: config.embedding.modelId
      }),
      description: t('settings.knowledgeBase.modelNotFoundDesc')
    }
    return
  }
  if (config.rerank && config.rerank.providerId && config.rerank.modelId) {
    // 设置当前选择的重排序模型
    const rerankModel = getEnableModelConfig(config.rerank.modelId, config.rerank.providerId)
    // 如果模型不存在或被禁用
    if (!rerankModel || !rerankModel.enabled) {
      panelError.value = {
        title: t('settings.knowledgeBase.modelNotFound', {
          provider: t(config.rerank.providerId),
          model: config.rerank.modelId
        }),
        description: t('settings.knowledgeBase.modelNotFoundDesc')
      }
      return
    }
    selectRerankModel.value = rerankModel
  } else {
    selectRerankModel.value = null
  }
  if (config.separators) {
    separators.value = separatorsArray2String(config.separators)
  } else {
    separators.value = ''
  }

  isEditing.value = true
  panelError.value = null
  selectEmbeddingModel.value = embeddingModel
  editingConfigIndex.value = index
  editingBuiltinConfig.value = cloneBuiltinConfig(config)
  fragmentsNumber.value = [editingBuiltinConfig.value.fragmentsNumber]
  autoDetectDimensionsSwitch.value = editingBuiltinConfig.value.dimensions === undefined
  dialogValidationError.value = null
  operationError.value = null
  dialogInitialSignature.value = editingSignature.value
  isBuiltinConfigDialogOpen.value = true
}

const resetBuiltinConfigDialog = () => {
  isBuiltinConfigDialogOpen.value = false
  editingConfigIndex.value = -1
  editingBuiltinConfig.value = {
    id: '',
    description: '',
    embedding: {
      providerId: '',
      modelId: ''
    },
    dimensions: NaN,
    normalized: true,
    fragmentsNumber: 6,
    enabled: true
  }
  separators.value = ''
  selectEmbeddingModel.value = null
  selectRerankModel.value = null
  autoDetectDimensionsSwitch.value = true
  dialogValidationError.value = null
  operationError.value = null
  dialogInitialSignature.value = editingSignature.value
}

// 关闭编辑对话框
const closeBuiltinConfigDialog = () => {
  if (operationPending.value) return
  resetBuiltinConfigDialog()
}

const handleDialogOpenChange = (open: boolean) => {
  if (open) {
    isBuiltinConfigDialogOpen.value = true
  } else {
    closeBuiltinConfigDialog()
  }
}

// 进入设置页面
const handleSetting = (config: BuiltinKnowledgeConfig) => {
  emit('showDetail', config)
}

// 保存配置
const saveBuiltinConfig = async () => {
  if (operationPending.value || !isEditingBuiltinConfigValid.value) return
  dialogValidationError.value = null
  operationError.value = null
  const draft = cloneBuiltinConfig(editingBuiltinConfig.value)
  draft.fragmentsNumber = fragmentsNumber.value[0]
  // 转换separators格式
  if (separators.value && separators.value.trim() !== '') {
    const separatorsArray = separatorString2Array(separators.value)
    if (separatorsArray.length === 0) {
      dialogValidationError.value = t('settings.knowledgeBase.invalidSeparators')
      return
    }
    draft.separators = separatorsArray
  } else {
    delete draft.separators
  }
  if (!autoDetectDimensionsSwitch.value) {
    draft.dimensions = Number(draft.dimensions)
  }

  const nextConfigs = builtinConfigs.value.map(cloneBuiltinConfig)
  if (isEditing.value && editingConfigIndex.value !== -1) {
    if (editingConfigIndex.value < 0 || editingConfigIndex.value >= nextConfigs.length) return
    nextConfigs[editingConfigIndex.value] = draft
  } else {
    nextConfigs.push(draft)
  }

  try {
    await runSave(async () => {
      let failureTitle = t('common.error.operationFailed')
      let dimensionsResolved = !autoDetectDimensionsSwitch.value
      const saved = await knowledgeOperation.run({
        code: 'settings.knowledgeBase.builtin.save',
        source: 'dialog',
        label: t('common.saving'),
        perform: async () => {
          failureTitle = t('common.error.operationFailed')
          if (!dimensionsResolved) {
            const result = await providerClient.getEmbeddingDimensions(
              draft.embedding.providerId,
              draft.embedding.modelId
            )
            if (
              result.errorMsg ||
              !Number.isFinite(result.data.dimensions) ||
              result.data.dimensions <= 0
            ) {
              failureTitle = t('settings.knowledgeBase.autoDetectDimensionsError')
              return false
            }
            draft.dimensions = result.data.dimensions
            draft.normalized = result.data.normalized
            dimensionsResolved = true
          }
          await configClient.setKnowledgeConfigs(nextConfigs)
          return true
        },
        failure: () => ({ title: failureTitle }),
        commit: () => {
          builtinConfigs.value = nextConfigs.map(cloneBuiltinConfig)
          panelError.value = null
          resetBuiltinConfigDialog()
        }
      })
      if (!saved) {
        throw new Error('save configuration rejected')
      }
    })
  } catch (error) {
    console.error('[BuiltinKnowledgeSettings] save configuration failed', error)
    operationError.value =
      knowledgeOperation.lastError.value?.title ?? t('common.error.operationFailed')
  }
}

const requestRemoveBuiltinConfig = (config: BuiltinKnowledgeConfig) => {
  if (operationPending.value || removeRequest.value.status !== 'idle') return
  removeRequest.value = { status: 'confirming', target: config }
}

const handleRemoveDialogOpenChange = (open: boolean) => {
  if (open || operationPending.value || removeRequest.value.status !== 'confirming') return
  removeRequest.value = { status: 'idle' }
}

// 移除配置
const removeBuiltinConfig = async () => {
  const request = removeRequest.value
  if (operationPending.value || request.status !== 'confirming') return
  const index = builtinConfigs.value.findIndex((config) => config === request.target)
  if (index < 0) {
    removeRequest.value = { status: 'idle' }
    panelError.value = { title: t('common.error.operationFailed') }
    return
  }
  const nextConfigs = builtinConfigs.value.map(cloneBuiltinConfig)
  nextConfigs.splice(index, 1)
  await knowledgeOperation.run({
    code: 'settings.knowledgeBase.builtin.remove',
    source: 'confirmation',
    label: t('common.saving'),
    perform: async () => {
      await configClient.setKnowledgeConfigs(nextConfigs)
      return true
    },
    commit: () => {
      builtinConfigs.value = nextConfigs.map(cloneBuiltinConfig)
      panelError.value = null
      removeRequest.value = { status: 'idle' }
    }
  })
}

// 选择嵌入模型
const handleEmbeddingModelSelect = (model: RENDERER_MODEL_META, providerId: string) => {
  selectEmbeddingModel.value = model
  editingBuiltinConfig.value.embedding.modelId = model.id
  editingBuiltinConfig.value.embedding.providerId = providerId
  embeddingModelSelectOpen.value = false
}
// 选择重排模型
const handleRerankModelSelect = (model: RENDERER_MODEL_META, providerId: string) => {
  if (!model || !model.id) {
    selectRerankModel.value = null
    delete editingBuiltinConfig.value.rerank
    rerankModelSelectOpen.value = false
    return
  }
  selectRerankModel.value = model
  editingBuiltinConfig.value.rerank = {
    modelId: model.id,
    providerId: providerId
  }
  rerankModelSelectOpen.value = false
}

// 切换配置启用状态
const toggleConfigEnabled = async (index: number, enabled: boolean) => {
  if (operationPending.value || index < 0 || index >= builtinConfigs.value.length) return
  const nextConfigs = builtinConfigs.value.map((config, configIndex) =>
    cloneBuiltinConfig(configIndex === index ? { ...config, enabled } : config)
  )
  await knowledgeOperation.run({
    code: 'settings.knowledgeBase.builtin.toggleConfig',
    source: 'panel',
    label: t('common.saving'),
    perform: async () => {
      await configClient.setKnowledgeConfigs(nextConfigs)
      return true
    },
    commit: () => {
      builtinConfigs.value = nextConfigs.map(cloneBuiltinConfig)
      panelError.value = null
    }
  })
}

const isBuiltinMcpEnabled = computed(() => {
  return Boolean(mcpStore.config.mcpServers['builtinKnowledge']?.enabled)
})

// 切换BuitinKnowledge MCP服务器启用状态
const toggleBuiltinMcpServer = async (_value: boolean) => {
  if (!mcpStore.mcpEnabled || operationPending.value) return
  await knowledgeOperation.run({
    code: 'settings.knowledgeBase.builtin.toggleServer',
    source: 'panel',
    label: t('common.saving'),
    perform: () => mcpStore.toggleServer('builtinKnowledge'),
    commit: () => undefined
  })
}

// 切换内置配置面板
const toggleBuiltinConfigPanel = () => {
  isBuiltinConfigPanelOpen.value = !isBuiltinConfigPanelOpen.value
}

const loadBuiltinConfig = async () => {
  try {
    builtinConfigs.value = (await configClient.getKnowledgeConfigs()).map(cloneBuiltinConfig)
    panelError.value = null
  } catch (error) {
    console.error('[BuiltinKnowledge] Failed to load configuration', error)
    panelError.value = { title: t('common.error.requestFailed') }
  }
}

const loadSupportedLanguages = async () => {
  try {
    const languages = await knowledgeClient.getSupportedLanguages()
    supportedLanguages.value = languages
  } catch (error) {
    console.error('[BuiltinKnowledge] Failed to load supported languages', error)
  }
}

// 处理语言选择
const handleLanguageSelect = async (language: string) => {
  separators.value = separatorsArray2String(await getSeparatorsForLanguage(language))
  separatorsPopoverOpen.value = false
}

const getSeparatorsForLanguage = async (language: string) => {
  return await knowledgeClient.getSeparatorsForLanguage(language)
}

/**
 * separator array to string
 * @example separatorsArray2String(['\n\n', '\n', ' ', '']) // '"\n\n", "\n", " ", ""'
 * @param arr
 */
const separatorsArray2String = (arr: string[]): string => {
  // 对特殊字符进行转义处理
  return arr
    .map((s) => {
      // 转义双引号、反斜杠、换行、回车、制表符等特殊字符
      const escaped = s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
      return `"${escaped}"`
    })
    .join(', ')
}
/**
 * separator string to array, remove quotes and duplicates
 * @example separatorString2Array('"\n\n", "\n", " ", ""') // ['\n\n', '\n', ' ', '']
 * @param str
 */
const separatorString2Array = (str: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(`[${str}]`)
    if (!Array.isArray(parsed) || !parsed.every((separator) => typeof separator === 'string')) {
      return []
    }
    return Array.from(new Set(parsed))
  } catch {
    return []
  }
}

const route = useRoute()

// 监听URL查询参数，设置活动标签页
watch(
  () => route.query.subtab,
  (newSubtab) => {
    if (newSubtab === 'builtinKnowledge') {
      isBuiltinConfigPanelOpen.value = true
    }
  },
  { immediate: true }
)

onMounted(() => {
  void Promise.all([loadBuiltinConfig(), loadSupportedLanguages()])
})

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'builtin-knowledge-config',
  onDiscard: closeBuiltinConfigDialog
})
const stopLeaveRiskSync = watch(
  [operationPending, dialogDirty],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)
const stopValidationSync = watch(
  editingSignature,
  () => {
    dialogValidationError.value = null
  },
  { flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  stopValidationSync()
  leaveGuardLease.release()
})
</script>
