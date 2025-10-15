<template>
  <div class="flex flex-row items-center gap-2 h-10">
    <span class="flex flex-row items-center gap-2 grow w-full" :dir="langStore.dir">
      <Icon icon="lucide:globe" class="w-4 h-4 text-muted-foreground" />
      <span class="text-sm font-medium">{{ t('settings.common.webContentLengthLimit') }}</span>
      <div class="text-xs text-muted-foreground ml-1">
        {{ t('settings.common.webContentLengthLimitHint') }}
      </div>
    </span>
    <div class="shrink-0 flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        class="h-8 w-8"
        @click="decreaseWebContentLimit"
        :disabled="webContentLengthLimit <= 0"
      >
        <Icon icon="lucide:minus" class="h-3 w-3" />
      </Button>
      <div class="relative">
        <div
          v-if="!isEditingLimit"
          @click="startEditingLimit"
          class="min-w-16 h-8 flex items-center justify-center text-sm font-semibold cursor-pointer hover:bg-accent rounded px-2"
        >
          {{ webContentLengthLimit }}
        </div>
        <Input
          v-else
          ref="limitInputRef"
          type="number"
          :min="0"
          :max="10000"
          :model-value="webContentLengthLimit"
          @update:model-value="handleWebContentLengthLimitChange"
          @blur="stopEditingLimit"
          @keydown.enter="stopEditingLimit"
          @keydown.escape="stopEditingLimit"
          class="min-w-16 h-8 text-center text-sm font-semibold rounded px-2"
          :class="{ 'bg-accent': isEditingLimit }"
        />
      </div>
      <Button
        variant="outline"
        size="icon"
        class="h-7 w-7"
        @click="increaseWebContentLimit"
        :disabled="webContentLengthLimit >= 10000"
      >
        <Icon icon="lucide:plus" class="h-3 w-3" />
      </Button>
      <span class="text-xs text-muted-foreground ml-1">{{
        t('settings.common.charactersUnit') || '字符'
      }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { usePresenter } from '@/composables/usePresenter'
import { useLanguageStore } from '@/stores/language'

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const langStore = useLanguageStore()

const webContentLengthLimit = ref(3000)
const isEditingLimit = ref(false)
const limitInputRef = ref<{ dom: HTMLInputElement }>()

const handleWebContentLengthLimitChange = async (value: string | number) => {
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value
  if (numValue >= 0 && numValue <= 10000 && !isNaN(numValue)) {
    try {
      await configPresenter.setSetting('webContentLengthLimit', numValue)
      webContentLengthLimit.value = numValue
    } catch (error) {
      console.error('设置网页内容长度限制失败:', error)
    }
  }
}

const increaseWebContentLimit = () => {
  const newValue = Math.min(webContentLengthLimit.value + 100, 20000)
  handleWebContentLengthLimitChange(newValue)
}

const decreaseWebContentLimit = () => {
  const newValue = Math.max(webContentLengthLimit.value - 100, 0)
  handleWebContentLengthLimitChange(newValue)
}

const startEditingLimit = () => {
  isEditingLimit.value = true
}

const stopEditingLimit = () => {
  isEditingLimit.value = false
}

watch(
  () => isEditingLimit.value,
  async (newValue) => {
    if (newValue) {
      await nextTick()
      limitInputRef.value?.dom?.focus?.()
    }
  }
)

onMounted(async () => {
  try {
    const savedLimit = await configPresenter.getSetting<number>('webContentLengthLimit')
    if (savedLimit !== undefined && savedLimit !== null) {
      webContentLengthLimit.value = savedLimit
    }
  } catch (error) {
    console.error('加载网页内容长度设置失败:', error)
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
