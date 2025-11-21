<template>
  <div class="flex flex-row items-center gap-2 h-10">
    <span class="flex flex-row items-center gap-2 grow w-full">
      <Icon icon="lucide:file" class="w-4 h-4 text-muted-foreground" />
      <span class="text-sm font-medium">{{ t('settings.common.fileMaxSize') }}</span>
      <div class="text-xs text-muted-foreground ml-1">
        {{ t('settings.common.fileMaxSizeHint') }}
      </div>
    </span>

    <div class="shrink-0 flex items-center gap-1">
      <!-- 减小按钮 -->
      <Button
        variant="outline"
        size="icon"
        class="h-8 w-8"
        @click="decreaseFileMaxSize"
        :disabled="fileMaxSize <= minSize"
      >
        <Icon icon="lucide:minus" class="h-3 w-3" />
      </Button>

      <!-- 当前值 / 输入框 -->
      <div class="relative">
        <div
          v-if="!isEditing"
          @click="startEditing"
          class="min-w-16 h-8 flex items-center justify-center text-sm font-semibold cursor-pointer hover:bg-accent rounded px-2"
        >
          {{ fileMaxSize }}
        </div>
        <Input
          v-else
          ref="inputRef"
          type="number"
          :min="minSize"
          :max="maxSize"
          :model-value="fileMaxSize"
          @update:model-value="handleChange"
          @blur="stopEditing"
          @keydown.enter="stopEditing"
          @keydown.escape="stopEditing"
          class="min-w-16 h-8 text-center text-sm font-semibold rounded px-2"
          :class="{ 'bg-accent': isEditing }"
        />
      </div>

      <!-- 增大按钮 -->
      <Button
        variant="outline"
        size="icon"
        class="h-8 w-8"
        @click="increaseFileMaxSize"
        :disabled="fileMaxSize >= maxSize"
      >
        <Icon icon="lucide:plus" class="h-3 w-3" />
      </Button>

      <!-- 单位 -->
      <span class="text-xs text-muted-foreground ml-1">{{ 'MB' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')

const minSize = 1
const maxSize = 1024 // 1024MB

const fileMaxSize = ref(30) // 默认值
const isEditing = ref(false)
const inputRef = ref<{ dom: HTMLInputElement }>()

const handleChange = async (value: string | number) => {
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value
  if (!isNaN(numValue) && numValue >= minSize && numValue <= maxSize) {
    try {
      await configPresenter.setSetting('maxFileSize', numValue * 1024 * 1024)
      fileMaxSize.value = numValue
    } catch (error) {
      console.error('设置文件最大值失败:', error)
    }
  }
}

const increaseFileMaxSize = () => {
  const newValue = Math.min(fileMaxSize.value + 50, maxSize)
  handleChange(newValue)
}

const decreaseFileMaxSize = () => {
  const newValue = Math.max(fileMaxSize.value - 50, minSize)
  handleChange(newValue)
}

const startEditing = () => {
  isEditing.value = true
}

const stopEditing = () => {
  isEditing.value = false
}

watch(
  () => isEditing.value,
  async (newVal) => {
    if (newVal) {
      await nextTick()
      inputRef.value?.dom?.focus?.()
    }
  }
)

onMounted(async () => {
  try {
    const saved = await configPresenter.getSetting<number>('maxFileSize')
    if (saved !== undefined && saved !== null) {
      fileMaxSize.value = saved / 1024 / 1024
    }
  } catch (error) {
    console.error('加载文件最大值失败:', error)
  }
})
</script>

<style scoped>
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type='number'] {
  -moz-appearance: textfield;
}
</style>
