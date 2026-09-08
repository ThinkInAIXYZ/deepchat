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
      <DcButton
        variant="outline"
        size="icon"
        icon="lucide:minus"
        icon-size="3"
        :aria-label="`${t('common.decrease')}: ${t('settings.common.fileMaxSize')}`"
        :tooltip="t('common.decrease')"
        class="h-8 w-8"
        @click="decreaseFileMaxSize"
        :disabled="fileMaxSize <= minSize"
      />

      <!-- 当前值 / 输入框 -->
      <div class="relative">
        <Input
          :aria-label="`${t('settings.common.fileMaxSize')} (MB)`"
          type="number"
          :min="minSize"
          :max="maxSize"
          :model-value="fileMaxSize"
          @update:model-value="handleChange"
          class="min-w-16 h-8 text-center text-sm font-semibold rounded px-2"
        />
      </div>

      <!-- 增大按钮 -->
      <DcButton
        variant="outline"
        size="icon"
        icon="lucide:plus"
        icon-size="3"
        :aria-label="`${t('common.increase')}: ${t('settings.common.fileMaxSize')}`"
        :tooltip="t('common.increase')"
        class="h-8 w-8"
        @click="increaseFileMaxSize"
        :disabled="fileMaxSize >= maxSize"
      />

      <span role="status" class="sr-only">{{ fileMaxSize }} MB</span>

      <!-- 单位 -->
      <span class="text-xs text-muted-foreground ml-1">{{ 'MB' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import { useI18n } from 'vue-i18n'
import { createConfigClient } from '@api/ConfigClient'

const { t } = useI18n()
const configClient = createConfigClient()

const minSize = 1
const maxSize = 1024 // 1024MB

const fileMaxSize = ref(30) // 默认值

const handleChange = async (value: string | number) => {
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value
  if (!isNaN(numValue) && numValue >= minSize && numValue <= maxSize) {
    try {
      await configClient.setSetting('maxFileSize', numValue * 1024 * 1024)
      fileMaxSize.value = numValue
    } catch (error) {
      console.error('Failed to set max file size:', error)
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

onMounted(async () => {
  try {
    const saved = await configClient.getSetting('maxFileSize')
    if (saved !== undefined && saved !== null) {
      fileMaxSize.value = saved / 1024 / 1024
    }
  } catch (error) {
    console.error('Failed to load max file size:', error)
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
