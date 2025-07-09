<template>
  <Dialog v-model:open="isOpen" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[500px] max-h-[80vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>{{ t('settings.provider.dialog.modelCheck.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.provider.dialog.modelCheck.description') }}
        </DialogDescription>
      </DialogHeader>

      <!-- 显示错误或成功消息 -->
      <div v-if="result" class="mb-4 flex-shrink-0">
        <div v-if="result.isOk" class="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div class="flex items-center">
            <Icon icon="lucide:check-circle" class="w-5 h-5 text-green-600 mr-2 flex-shrink-0" />
            <span class="text-green-800 font-medium">{{
              t('settings.provider.dialog.modelCheck.success')
            }}</span>
          </div>
        </div>
        <div v-else class="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div class="flex items-start">
            <Icon icon="lucide:x-circle" class="w-5 h-5 text-red-600 mr-2 mt-0.5 flex-shrink-0" />
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
        <div v-if="!result && hasModels" class="grid gap-4 py-4">
          <div class="grid grid-cols-4 items-center gap-4">
            <Label for="model" class="text-right">
              {{ t('settings.provider.dialog.modelCheck.model') }}
            </Label>
            <Select v-model="selectedModelId" required>
              <SelectTrigger class="col-span-3">
                <SelectValue
                  :placeholder="t('settings.provider.dialog.modelCheck.modelPlaceholder')"
                />
              </SelectTrigger>
              <SelectContent class="max-h-60">
                <SelectItem v-for="model in availableModels" :key="model.id" :value="model.id">
                  {{ model.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- 进度指示器 -->
        <div v-if="isChecking" class="flex items-center justify-center py-6">
          <div class="flex items-center">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
            <span class="text-muted-foreground">{{
              t('settings.provider.dialog.modelCheck.checking')
            }}</span>
          </div>
        </div>
      </div>

      <DialogFooter class="flex-shrink-0">
        <Button type="button" variant="outline" @click="closeDialog">
          {{ result ? t('dialog.close') : t('dialog.cancel') }}
        </Button>
        <Button
          v-if="!result && hasModels"
          type="button"
          :disabled="!selectedModelId || isChecking"
          @click="handleCheck"
        >
          <div
            v-if="isChecking"
            class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"
          ></div>
          {{
            isChecking
              ? t('settings.provider.dialog.modelCheck.checking')
              : t('settings.provider.dialog.modelCheck.test')
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettingsStore } from '@/stores/settings'
import { Icon } from '@iconify/vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const settingsStore = useSettingsStore()

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
const result = ref<{ isOk: boolean; errorMsg: string | null } | null>(null)

// 计算可用的模型列表
const availableModels = computed(() => {
  const providerModels = settingsStore.enabledModels.find((p) => p.providerId === props.providerId)
  return providerModels?.models || []
})

// 检查是否有可用的模型
const hasModels = computed(() => availableModels.value.length > 0)

// 监听 open 属性变化
watch(
  () => props.open,
  (newVal) => {
    if (newVal && !isOpen.value) {
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
  selectedModelId.value = ''
  result.value = null
  isChecking.value = false
}

const closeDialog = () => {
  isOpen.value = false
}

const handleCheck = async () => {
  if (!selectedModelId.value) return

  try {
    isChecking.value = true
    result.value = null

    // 调用设置store的检查方法
    const checkResult = await settingsStore.checkProvider(props.providerId, selectedModelId.value)
    result.value = checkResult
  } catch (error) {
    console.error('Model check failed:', error)
    result.value = {
      isOk: false,
      errorMsg: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  } finally {
    isChecking.value = false
  }
}
</script>
