<template>
  <div class="w-full max-w-4xl mx-auto">
    <div class="flex flex-col border border-input rounded-lg bg-card p-3 gap-2">
      <!-- 文件预览区 -->
      <div v-if="internalFiles.length > 0" class="flex flex-wrap gap-1.5">
        <FileItem
          v-for="(file, idx) in internalFiles"
          :key="idx"
          :file-name="file.name"
          :deletable="true"
          :tokens="0"
          :mime-type="file.type"
          context="input"
          @delete="removeFile(idx)"
        />
      </div>

      <!-- 文本输入 -->
      <Textarea
        v-model="internalText"
        :placeholder="t('newThread.homepage.inputPlaceholder')"
        :rows="3"
        class="resize-none border-0 focus-visible:ring-0 p-0"
        @keydown="handleKeydown"
      />

      <!-- 工具栏 -->
      <div class="flex items-center justify-between">
        <div class="flex gap-1.5">
          <!-- 文件上传按钮 -->
          <Button variant="ghost" size="icon-sm" class="h-7 w-7" @click="selectFiles">
            <Icon icon="lucide:plus" class="w-4 h-4" />
          </Button>

          <!-- 模型选择器 -->
          <Popover v-model:open="modelSelectOpen">
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                <ModelIcon
                  v-if="internalSelectedModel.providerId"
                  :model-id="internalSelectedModel.providerId"
                  :is-dark="themeStore.isDark"
                  class="w-4 h-4"
                />
                <span class="truncate max-w-[140px] text-foreground">{{ modelDisplayName }}</span>
                <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-80 border-none bg-transparent p-0 shadow-none">
              <ModelSelect
                :type="[ModelType.Chat, ModelType.ImageGeneration]"
                @update:model="handleModelUpdate"
              />
            </PopoverContent>
          </Popover>
        </div>

        <!-- 发送按钮 -->
        <Button
          :disabled="!canSend"
          variant="default"
          size="icon-sm"
          class="w-7 h-7"
          @click="handleSend"
        >
          <Icon icon="lucide:arrow-up" class="w-4 h-4" />
        </Button>
      </div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input ref="fileInputRef" type="file" multiple class="hidden" @change="handleFileInputChange" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Icon } from '@iconify/vue'
import ModelIcon from '../icons/ModelIcon.vue'
import ModelSelect from '../ModelSelect.vue'
import FileItem from '../FileItem.vue'
import { useThemeStore } from '@/stores/theme'
import { ModelType } from '@shared/model'
import type { MODEL_META } from '@shared/presenter'

interface Props {
  text?: string
  files?: File[]
  selectedModel?: {
    id: string
    providerId: string
    name: string
  }
}

interface Emits {
  (e: 'update:text', value: string): void
  (e: 'update:files', value: File[]): void
  (e: 'update:selectedModel', value: { id: string; providerId: string; name: string }): void
  (e: 'send', content: { text: string; files: File[] }): void
}

const props = withDefaults(defineProps<Props>(), {
  text: '',
  files: () => [],
  selectedModel: () => ({ id: '', providerId: '', name: '' })
})

const emit = defineEmits<Emits>()

const { t } = useI18n()
const themeStore = useThemeStore()

// 内部状态
const internalText = ref(props.text)
const internalFiles = ref<File[]>([...props.files])
const internalSelectedModel = ref({ ...props.selectedModel })
const modelSelectOpen = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

// 监听 props 变化
watch(
  () => props.text,
  (newVal) => {
    internalText.value = newVal
  }
)

watch(
  () => props.files,
  (newVal) => {
    internalFiles.value = [...newVal]
  }
)

watch(
  () => props.selectedModel,
  (newVal) => {
    internalSelectedModel.value = { ...newVal }
  }
)

// 同步内部状态到外部
watch(internalText, (newVal) => {
  emit('update:text', newVal)
})

watch(
  internalFiles,
  (newVal) => {
    emit('update:files', newVal)
  },
  { deep: true }
)

watch(
  internalSelectedModel,
  (newVal) => {
    emit('update:selectedModel', newVal)
  },
  { deep: true }
)

// 计算属性
const canSend = computed(() => {
  return internalText.value.trim().length > 0 || internalFiles.value.length > 0
})

const modelDisplayName = computed(() => {
  if (!internalSelectedModel.value.name) {
    return t('newThread.homepage.selectModel')
  }
  return internalSelectedModel.value.name.split('/').pop() || internalSelectedModel.value.name
})

// 文件处理
const selectFiles = () => {
  fileInputRef.value?.click()
}

const handleFileInputChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    internalFiles.value.push(...Array.from(target.files))
    // 重置 input 以允许选择相同文件
    target.value = ''
  }
}

const removeFile = (index: number) => {
  internalFiles.value.splice(index, 1)
}

// 键盘事件处理
const handleKeydown = (event: KeyboardEvent) => {
  // Enter 发送（不按 Shift）
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (canSend.value) {
      handleSend()
    }
  }
  // Shift+Enter 换行（默认行为，不需要处理）
}

// 发送消息
const handleSend = () => {
  if (!canSend.value) return

  emit('send', {
    text: internalText.value,
    files: [...internalFiles.value]
  })

  // 清空输入
  internalText.value = ''
  internalFiles.value = []
}

// 模型更新
const handleModelUpdate = (model: MODEL_META, providerId: string) => {
  // 过滤掉 ACP 模型
  if (providerId === 'acp') {
    return
  }

  internalSelectedModel.value = {
    id: model.id,
    providerId: providerId,
    name: model.name
  }

  modelSelectOpen.value = false
}
</script>
