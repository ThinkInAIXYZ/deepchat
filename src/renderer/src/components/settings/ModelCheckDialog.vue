<template>
  <Dialog v-model:open="isOpen" @update:open="onOpenChange">
    <DialogContent
      data-testid="model-check-dialog"
      class="sm:max-w-[500px] max-h-[80vh] overflow-hidden flex flex-col"
    >
      <DialogHeader>
        <DialogTitle>{{ t('settings.provider.dialog.modelCheck.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.provider.dialog.modelCheck.description') }}
        </DialogDescription>
      </DialogHeader>

      <p role="status" aria-live="polite" aria-atomic="true" class="sr-only">
        {{
          isChecking
            ? t('settings.provider.dialog.modelCheck.checking')
            : result?.isOk
              ? t('settings.provider.dialog.modelCheck.success')
              : ''
        }}
      </p>
      <!-- 显示错误或成功消息 -->
      <div v-if="result" class="mb-4 shrink-0">
        <div
          v-if="result.isOk"
          data-testid="model-check-result"
          data-success="true"
          class="p-4 bg-green-50 border border-green-200 rounded-lg"
        >
          <div class="flex items-center">
            <Icon icon="lucide:check-circle" class="w-5 h-5 text-green-600 mr-2 shrink-0" />
            <span class="text-green-800 font-medium">{{
              t('settings.provider.dialog.modelCheck.success')
            }}</span>
          </div>
        </div>
        <div
          v-else
          role="alert"
          data-testid="model-check-result"
          data-success="false"
          class="p-4 bg-red-50 border border-red-200 rounded-lg"
        >
          <div class="flex items-start">
            <Icon icon="lucide:x-circle" class="w-5 h-5 text-red-600 mr-2 mt-0.5 shrink-0" />
            <div class="text-red-800 min-w-0 flex-1">
              <div class="font-medium">{{ t('settings.provider.dialog.modelCheck.failed') }}</div>
              <div class="text-sm mt-1 break-words whitespace-pre-wrap overflow-y-auto max-h-40">
                {{ result.errorMsg }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 主要内容区域 -->
      <div class="flex-1 min-h-0 overflow-y-auto">
        <!-- 没有模型的提示 -->
        <div v-if="!hasModels && !result" class="py-6">
          <div class="text-center text-muted-foreground">
            <Icon icon="lucide:info" class="w-8 h-8 mx-auto mb-2" />
            <p>{{ t('settings.provider.dialog.modelCheck.noModels') }}</p>
          </div>
        </div>

        <!-- 模型选择表单 -->
        <div v-if="hasModels" class="grid gap-4 py-4">
          <div class="grid grid-cols-4 items-center gap-4">
            <Label :for="modelSelectId" class="text-right">
              {{ t('settings.provider.dialog.modelCheck.model') }}
            </Label>
            <Popover v-model:open="isModelPickerOpen">
              <PopoverTrigger as-child>
                <DcButton
                  :id="modelSelectId"
                  data-testid="model-check-select"
                  type="button"
                  variant="outline"
                  class="col-span-3 justify-between font-normal"
                  :disabled="isChecking"
                >
                  <span class="truncate" :class="{ 'text-muted-foreground': !selectedModel }">
                    {{
                      selectedModel?.name ??
                      t('settings.provider.dialog.modelCheck.modelPlaceholder')
                    }}
                  </span>
                  <Icon icon="lucide:chevron-down" class="h-4 w-4 opacity-50" />
                </DcButton>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-(--reka-popover-trigger-width) p-0">
                <Input
                  v-model="keyword"
                  data-testid="model-check-search"
                  class="rounded-b-none border-none text-sm ring-0 focus-visible:ring-0"
                  :placeholder="t('model.search.placeholder')"
                />
                <div
                  v-if="hasEnabledModels"
                  class="flex items-center justify-between gap-2 border-y px-3 py-2"
                >
                  <Label :for="enabledOnlyId" class="text-xs font-normal">
                    {{ t('settings.provider.dialog.modelCheck.enabledOnly') }}
                  </Label>
                  <Switch
                    :id="enabledOnlyId"
                    v-model="enabledOnly"
                    data-testid="model-check-enabled-only"
                  />
                </div>
                <div class="flex max-h-60 flex-col overflow-y-auto p-1">
                  <button
                    v-for="model in visibleModels"
                    :key="model.id"
                    type="button"
                    data-testid="model-check-option"
                    :data-model-id="model.id"
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted dark:hover:bg-accent"
                    :class="{ 'bg-muted': model.id === selectedModelId }"
                    @click="selectModel(model.id)"
                  >
                    <span class="flex-1 truncate">{{ model.name }}</span>
                    <Icon
                      v-if="model.id === selectedModelId"
                      icon="lucide:check"
                      class="h-4 w-4 shrink-0 text-primary"
                    />
                  </button>
                  <p
                    v-if="visibleModels.length === 0"
                    class="py-6 text-center text-sm text-muted-foreground"
                  >
                    {{ t('settings.provider.dialog.modelCheck.noMatch') }}
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <!-- 进度指示器 -->
        <div v-if="isChecking" class="flex items-center justify-center py-6">
          <div class="flex items-center gap-3">
            <Spinner class="size-6 text-primary" />
            <span class="text-muted-foreground">{{
              t('settings.provider.dialog.modelCheck.checking')
            }}</span>
          </div>
        </div>
      </div>

      <DialogFooter class="shrink-0">
        <DcButton type="button" variant="outline" @click="closeDialog">
          {{ result ? t('dialog.close') : t('dialog.cancel') }}
        </DcButton>
        <DcButton
          data-testid="model-check-submit"
          v-if="hasModels"
          type="button"
          :disabled="!selectedModelId || isChecking"
          @click="handleCheck"
        >
          <Spinner v-if="isChecking" data-icon="inline-start" />
          {{
            isChecking
              ? t('settings.provider.dialog.modelCheck.checking')
              : t('settings.provider.dialog.modelCheck.test')
          }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { DcButton } from '@dc-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Switch } from '@shadcn/components/ui/switch'
import { Icon } from '@iconify/vue'
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModelStore } from '@/stores/modelStore'
import { useProviderStore } from '@/stores/providerStore'
import { ModelType } from '@shared/model'

const { t } = useI18n()
const modelSelectId = useId()
const enabledOnlyId = useId()
const modelStore = useModelStore()
const providerStore = useProviderStore()

const props = defineProps<{
  open: boolean
  providerId: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const isOpen = ref(props.open)
const isChecking = ref(false)
const selectedModelId = ref<string>('')
const isModelPickerOpen = ref(false)
const keyword = ref('')
const enabledOnly = ref(true)
const result = ref<{ isOk: boolean; errorMsg: string | null } | null>(null)
let checkVersion = 0

// This dialog calls text completions, not media generation or embedding APIs.
const availableModels = computed(() => {
  const providerModels = modelStore.allProviderModels.find((p) => p.providerId === props.providerId)
  const customModels = modelStore.customModels.find((p) => p.providerId === props.providerId)
  const models = new Map(
    [...(providerModels?.models || []), ...(customModels?.models || [])].map((model) => [
      model.id,
      model
    ])
  )
  return [...models.values()].filter((model) => !model.type || model.type === ModelType.Chat)
})

const hasEnabledModels = computed(() => availableModels.value.some((model) => model.enabled))

// With no enabled models the enabled-only filter would leave nothing to pick, so show all.
const visibleModels = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  const filterEnabled = enabledOnly.value && hasEnabledModels.value
  return availableModels.value.filter(
    (model) =>
      (!filterEnabled || model.enabled) &&
      (!query || model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query))
  )
})

const selectedModel = computed(() =>
  availableModels.value.find((model) => model.id === selectedModelId.value)
)

const selectModel = (modelId: string) => {
  selectedModelId.value = modelId
  isModelPickerOpen.value = false
}

watch(selectedModelId, () => {
  result.value = null
})
watch(
  () => props.providerId,
  () => resetDialog()
)

// 检查是否有可用的模型
const hasModels = computed(() => availableModels.value.length > 0)

// 监听 open 属性变化
watch(
  () => props.open,
  (newVal) => {
    if (newVal !== isOpen.value) {
      resetDialog()
    }
    isOpen.value = newVal
  }
)

// 监听 isOpen 变化，同步更新到父组件
watch(
  () => isOpen.value,
  (newVal) => {
    emit('update:open', newVal)
  }
)

const onOpenChange = (open: boolean) => {
  isOpen.value = open
  if (!open) {
    resetDialog()
  }
}

const resetDialog = () => {
  checkVersion += 1
  selectedModelId.value = ''
  isModelPickerOpen.value = false
  keyword.value = ''
  enabledOnly.value = true
  result.value = null
  isChecking.value = false
}

const closeDialog = () => {
  isOpen.value = false
  resetDialog()
}

const handleCheck = async () => {
  if (
    isChecking.value ||
    !availableModels.value.some((model) => model.id === selectedModelId.value)
  )
    return
  const version = ++checkVersion

  try {
    isChecking.value = true
    result.value = null

    // 调用设置store的检查方法
    const checkResult = await providerStore.checkProvider(props.providerId, selectedModelId.value)
    if (version === checkVersion) result.value = checkResult
  } catch (error) {
    if (version !== checkVersion) return
    result.value = {
      isOk: false,
      errorMsg: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  } finally {
    if (version === checkVersion) isChecking.value = false
  }
}
</script>
