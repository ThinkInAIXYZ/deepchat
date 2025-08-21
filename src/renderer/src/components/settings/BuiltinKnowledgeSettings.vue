<template>
  <div class="border rounded-lg overflow-hidden">
    <div class="flex items-center p-4 bg-card">
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
            <TooltipTrigger as-child>
              <Switch
                :checked="isBuiltinMcpEnabled"
                :disabled="!mcpStore.mcpEnabled"
                @update:checked="toggleBuiltinMcpServer"
              />
            </TooltipTrigger>
            <TooltipContent v-if="!mcpStore.mcpEnabled">
              <p>{{ t('settings.mcp.enableToAccess') }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button
          variant="outline"
          size="sm"
          class="flex items-center gap-1"
          @click="toggleBuiltinConfigPanel"
        >
          <Icon
            :icon="isBuiltinConfigPanelOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
            class="w-4 h-4"
          />
          {{ isBuiltinConfigPanelOpen ? t('common.collapse') : t('common.expand') }}
        </Button>
      </div>
    </div>
    <Collapsible v-model:open="isBuiltinConfigPanelOpen">
      <CollapsibleContent>
        <div class="p-4 border-t space-y-4">
          <div v-if="builtinConfigs.length > 0" class="space-y-3">
            <div
              v-for="(config, index) in builtinConfigs"
              :key="index"
              class="p-3 border rounded-md relative"
            >
              <div class="absolute top-2 right-2 flex gap-2">
                <Switch
                  :checked="config.enabled === true"
                  size="sm"
                  @update:checked="toggleConfigEnabled(index, $event)"
                />
                <button
                  type="button"
                  class="text-muted-foreground hover:text-primary"
                  @click="handleSetting(config)"
                >
                  <Icon icon="lucide:file-diff" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-primary"
                  @click="editBuiltinConfig(index)"
                >
                  <Icon icon="lucide:edit" class="h-4 w-4" />
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button type="button" class="text-muted-foreground hover:text-destructive">
                      <Icon icon="lucide:trash-2" class="h-4 w-4" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{{
                        t('settings.knowledgeBase.removeBuiltinKnowledgeConfirmTitle', {
                          name: config.description
                        })
                      }}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {{ t('settings.knowledgeBase.removeBuiltinKnowledgeConfirmDesc') }}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                      <AlertDialogAction @click="removeBuiltinConfig(index)">{{
                        t('common.confirm')
                      }}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
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
            <Button
              type="button"
              size="sm"
              class="w-full flex items-center justify-center gap-2"
              variant="outline"
              @click="openAddConfig"
            >
              <Icon icon="lucide:plus" class="w-8 h-4" />
              {{ t('settings.knowledgeBase.addBuiltinKnowledgeConfig') }}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
    <Dialog v-model:open="isBuiltinConfigDialogOpen">
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
          <div class="p-3">
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
                  required
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
                          class="cursor-pointer text-primary outline-none focus:outline-none text-sm"
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
                    <Button
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
                      <Button
                        size="xs"
                        variant="ghost"
                        class="text-xs text-muted-foreground rounded-full w-6 h-6 flex items-center justify-center"
                      >
                        <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-80 p-0">
                    <ModelSelect
                      :type="[ModelType.Embedding]"
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
                    <Button
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
                      <Button
                        size="xs"
                        variant="ghost"
                        v-if="selectRerankModel"
                        class="text-xs text-muted-foreground rounded-full w-6 h-6 flex items-center justify-center hover:bg-zinc-200"
                        @click.stop="clearRerankModel"
                      >
                        <Icon icon="lucide:x" class="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        v-else
                        class="text-xs text-muted-foreground rounded-full w-6 h-6 flex items-center justify-center"
                      >
                        <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-80 p-0">
                    <ModelSelect
                      :type="[ModelType.Rerank]"
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
                            class="cursor-pointer text-primary outline-none focus:outline-none text-sm"
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
                    v-model:checked="autoDetectDimensionsSwitch"
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
                            class="cursor-pointer text-primary outline-none focus:outline-none text-sm"
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
                            class="cursor-pointer text-primary outline-none focus:outline-none text-sm"
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
                    v-model:checked="editingBuiltinConfig.normalized"
                    :disabled="isEditing"
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
                                class="cursor-pointer text-primary outline-none focus:outline-none"
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p class="w-64">{{ t('settings.knowledgeBase.separatorsHelper') }}</p>
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
                            <Button
                              size="xs"
                              variant="ghost"
                              class="whitespace-nowrap"
                              :title="t('settings.knowledgeBase.separatorsPreset')"
                            >
                              <Icon icon="lucide:book-marked" class="w-4 h-4 text-primary" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent class="w-40 p-2">
                            <div class="space-y-2">
                              <div class="text-sm text-muted-foreground">
                                {{ t('settings.knowledgeBase.selectLanguage') }}
                              </div>
                              <div class="max-h-48 overflow-y-auto space-y-1">
                                <Button
                                  v-for="language in supportedLanguages"
                                  :key="language"
                                  variant="ghost"
                                  size="sm"
                                  class="w-full justify-start text-left"
                                  @click="handleLanguageSelect(language)"
                                >
                                  {{ language }}
                                </Button>
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
                                class="cursor-pointer text-primary outline-none focus:outline-none"
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p class="w-64">{{ t('settings.knowledgeBase.chunkSizeHelper') }}</p>
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
                                class="cursor-pointer text-primary outline-none focus:outline-none"
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
                                  class="cursor-pointer text-primary outline-none focus:outline-none"
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
          <Button variant="outline" @click="closeBuiltinConfigDialog">{{
            t('common.cancel')
          }}</Button>
          <Button
            type="button"
            :disabled="!isEditingBuiltinConfigValid || submitLoading"
            @click="saveBuiltinConfig"
          >
            <Icon v-if="submitLoading" icon="lucide:loader-circle" class="animate-spin" />{{
              isEditing ? t('common.confirm') : t('settings.knowledgeBase.addConfig')
            }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, toRaw, computed, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useMcpStore } from '@/stores/mcp'
import { ModelType } from '@shared/model'
import { useThemeStore } from '@/stores/theme'
import { BuiltinKnowledgeConfig, RENDERER_MODEL_META } from '@shared/presenter'
import { toast } from '../ui/toast'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { nanoid } from 'nanoid'
import { usePresenter } from '@/composables/usePresenter'
// 全局对象
const { t } = useI18n()
const mcpStore = useMcpStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const llmP = usePresenter('llmproviderPresenter')
const knowledgeP = usePresenter('knowledgePresenter')
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
const submitLoading = ref(false)

// 自动检测维度开关
const autoDetectDimensionsSwitch = ref(true)
const clearRerankModel = () => {
  selectRerankModel.value = null
  delete editingBuiltinConfig.value.rerank
  rerankModelSelectOpen.value = false
}
const builtinConfigs = ref<Array<BuiltinKnowledgeConfig>>([])

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

// 当前选择的嵌入模型
const selectEmbeddingModel = ref<RENDERER_MODEL_META | null>(null)
// 当前选择的重排模型
const selectRerankModel = ref<RENDERER_MODEL_META | null>(null)

// 对话框状态
const isBuiltinConfigDialogOpen = ref(false)

// 打开添加对话框
function openAddConfig() {
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
  submitLoading.value = false
  isBuiltinConfigDialogOpen.value = true
}

defineExpose({
  openAddConfig
})

const editingConfigIndex = ref<number>(-1)

// 验证配置是否有效
const isEditingBuiltinConfigValid = computed(() => {
  return (
    editingBuiltinConfig.value.description.trim() !== '' &&
    editingBuiltinConfig.value.embedding.providerId.trim() !== '' &&
    editingBuiltinConfig.value.embedding.modelId.trim() !== '' &&
    (autoDetectDimensionsSwitch.value || editingBuiltinConfig.value.dimensions)
  )
})

// 获取已启用的模型配置
const getEnableModelConfig = (modelId: string, providerId: string): RENDERER_MODEL_META | null => {
  const provider = settingsStore.enabledModels.find((p) => p.providerId === providerId)
  if (!provider || !Array.isArray(provider.models)) return null
  const model = provider.models.find((m) => m.id === modelId && m.enabled)
  return model || null
}

// 打开编辑对话框
const editBuiltinConfig = async (index: number) => {
  const config = builtinConfigs.value[index]
  // 设置当前选择的嵌入模型
  const embeddingModel = (await getEnableModelConfig(
    config.embedding.modelId,
    config.embedding.providerId
  )) as RENDERER_MODEL_META
  // 如果模型不存在或被禁用
  if (!embeddingModel || !embeddingModel.enabled) {
    toast({
      title: t('settings.knowledgeBase.modelNotFound', {
        provider: t(config.embedding.providerId),
        model: config.embedding.modelId
      }),
      description: t('settings.knowledgeBase.modelNotFoundDesc'),
      variant: 'destructive',
      duration: 3000
    })
    return
  }
  if (config.rerank && config.rerank.providerId && config.rerank.modelId) {
    // 设置当前选择的重排序模型
    const rerankModel = (await getEnableModelConfig(
      config.rerank.modelId,
      config.rerank.providerId
    )) as RENDERER_MODEL_META
    // 如果模型不存在或被禁用
    if (!rerankModel || !rerankModel.enabled) {
      toast({
        title: t('settings.knowledgeBase.modelNotFound', {
          provider: t(config.rerank.providerId),
          model: config.rerank.modelId
        }),
        description: t('settings.knowledgeBase.modelNotFoundDesc'),
        variant: 'destructive',
        duration: 3000
      })
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
  selectEmbeddingModel.value = embeddingModel
  editingConfigIndex.value = index
  editingBuiltinConfig.value = { ...builtinConfigs.value[index] }
  fragmentsNumber.value = [editingBuiltinConfig.value.fragmentsNumber]
  autoDetectDimensionsSwitch.value = editingBuiltinConfig.value.dimensions === undefined
  submitLoading.value = false
  isBuiltinConfigDialogOpen.value = true
}

// 关闭编辑对话框
const closeBuiltinConfigDialog = () => {
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
  autoDetectDimensionsSwitch.value = true
  submitLoading.value = false
}

// 进入设置页面
const handleSetting = (config: BuiltinKnowledgeConfig) => {
  emit('showDetail', config)
}

// 保存配置
const saveBuiltinConfig = async () => {
  if (!isEditingBuiltinConfigValid.value) return
  editingBuiltinConfig.value.fragmentsNumber = fragmentsNumber.value[0]
  submitLoading.value = true
  // 转换separators格式
  if (separators.value && separators.value.trim() !== '') {
    const separatorsArray = separatorString2Array(separators.value)
    if (separatorsArray.length === 0) {
      toast({
        title: t('settings.knowledgeBase.invalidSeparators'),
        variant: 'destructive',
        duration: 3000
      })
      submitLoading.value = false
      return
    }
    editingBuiltinConfig.value.separators = separatorsArray
  } else {
    delete editingBuiltinConfig.value.separators
  }
  // 自动获取dimensions
  if (autoDetectDimensionsSwitch.value) {
    const result = await llmP.getDimensions(
      editingBuiltinConfig.value.embedding.providerId,
      editingBuiltinConfig.value.embedding.modelId
    )
    if (result.errorMsg) {
      toast({
        title: t('settings.knowledgeBase.autoDetectDimensionsError'),
        description: String(result.errorMsg),
        variant: 'destructive',
        duration: 3000
      })
      submitLoading.value = false
      return
    }
    console.log('获取到向量信息:', result.data)
    editingBuiltinConfig.value.dimensions = result.data.dimensions
    editingBuiltinConfig.value.normalized = result.data.normalized
  }

  if (isEditing.value) {
    // 更新配置
    if (editingConfigIndex.value !== -1) {
      builtinConfigs.value[editingConfigIndex.value] = { ...editingBuiltinConfig.value }
    }
    toast({
      title: t('settings.knowledgeBase.configUpdated'),
      description: t('settings.knowledgeBase.configUpdatedDesc'),
      duration: 3000
    })
  } else {
    // 添加配置
    builtinConfigs.value.push({ ...editingBuiltinConfig.value })
    toast({
      title: t('settings.knowledgeBase.configAdded'),
      description: t('settings.knowledgeBase.configAddedDesc'),
      duration: 3000
    })
  }

  // 更新到MCP配置
  await updateBuiltinConfigToMcp()

  // 关闭对话框
  closeBuiltinConfigDialog()
}

// 移除配置
const removeBuiltinConfig = async (index: number) => {
  builtinConfigs.value.splice(index, 1)
  await updateBuiltinConfigToMcp()
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
  builtinConfigs.value[index].enabled = enabled
  await updateBuiltinConfigToMcp()
}

const isBuiltinMcpEnabled = computed(() => {
  return mcpStore.serverStatuses['builtinKnowledge'] || false
})

// 切换BuitinKnowledge MCP服务器启用状态
const toggleBuiltinMcpServer = async () => {
  if (!mcpStore.mcpEnabled) return
  await mcpStore.toggleServer('builtinKnowledge')
}

// 切换内置配置面板
const toggleBuiltinConfigPanel = () => {
  isBuiltinConfigPanelOpen.value = !isBuiltinConfigPanelOpen.value
}

// 更新配置到MCP
const updateBuiltinConfigToMcp = async () => {
  try {
    const envJson = {
      configs: toRaw(builtinConfigs.value)
    }
    await mcpStore.updateServer('builtinKnowledge', {
      env: envJson
    })
    return true
  } catch (error) {
    console.error('更新BuiltinKnowledge配置失败:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: String(error),
      variant: 'destructive',
      duration: 3000
    })
    return false
  }
}

// 从MCP加载内置配置
const loadBuiltinConfigFromMcp = async () => {
  try {
    const serverConfig = mcpStore.config.mcpServers['builtinKnowledge']
    if (serverConfig && serverConfig.env) {
      // 解析配置 - env可能是JSON字符串
      try {
        // 尝试解析JSON字符串
        const envObj =
          typeof serverConfig.env === 'string' ? JSON.parse(serverConfig.env) : serverConfig.env
        // const envObj = serverConfig.env
        if (envObj.configs && Array.isArray(envObj.configs)) {
          builtinConfigs.value = envObj.configs
        }
      } catch (parseError) {
        console.error('解析BuiltinKnowledge配置JSON失败:', parseError)
      }
    }
  } catch (error) {
    console.error('加载BuiltinKnowledge配置失败:', error)
  }
}

const separators = ref('')
const supportedLanguages = ref<string[]>([])
knowledgeP.getSupportedLanguages().then((res) => {
  supportedLanguages.value = res
  console.log('支持的语言:', supportedLanguages.value)
})

// 处理语言选择
const handleLanguageSelect = async (language: string) => {
  separators.value = separatorsArray2String(await getSeparatorsForLanguage(language))
  separatorsPopoverOpen.value = false
}

const getSeparatorsForLanguage = async (language: string) => {
  return await knowledgeP.getSeparatorsForLanguage(language)
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
  // 正则匹配所有被双引号包裹的内容（支持转义字符）
  const regex = /"((?:\\.|[^"\\])*)"/g
  const matches: string[] = []
  let match

  // 提取所有匹配项
  while ((match = regex.exec(str.trim())) !== null) {
    // 处理转义字符（将 \n、\t 等还原为实际字符）
    const unescaped = match[1].replace(/\\([nrt"\\])/g, (_, char) => {
      switch (char) {
        case 'n':
          return '\n'
        case 'r':
          return '\r'
        case 't':
          return '\t'
        case '"':
          return '"'
        case '\\':
          return '\\'
        default:
          return char
      }
    })
    matches.push(unescaped)
  }

  // 去重并返回
  return Array.from(new Set(matches))
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

// 监听MCP全局状态变化
watch(
  () => mcpStore.mcpEnabled,
  async (enabled) => {
    if (!enabled && isBuiltinMcpEnabled.value) {
      await mcpStore.toggleServer('builtinKnowledge')
    }
  }
)

// 组件挂载时加载配置
let unwatch: (() => void) | undefined
onMounted(async () => {
  unwatch = watch(
    () => mcpStore.config.ready,
    async (ready) => {
      if (ready) {
        unwatch?.() // only run once to avoid multiple calls
        await loadBuiltinConfigFromMcp()
      }
    },
    { immediate: true }
  )
})

// cancel the watch to avoid memory leaks
onUnmounted(() => {
  if (unwatch) {
    unwatch?.()
  }
})
</script>
