<template>
  <Dialog v-model:open="internalOpen">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>{{ t('newThread.homepage.acpConfig.description') }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- 工作目录选择 -->
        <div class="space-y-2">
          <Label>{{ t('newThread.homepage.acpConfig.workdir.label') }}</Label>
          <div class="flex gap-2">
            <Input
              :model-value="acpWorkdir.workdir.value"
              :placeholder="t('newThread.homepage.acpConfig.workdir.placeholder')"
              readonly
              class="flex-1"
            />
            <Button variant="outline" @click="handleSelectWorkdir" :disabled="loading">
              <Icon icon="lucide:folder-open" class="w-4 h-4 mr-2" />
              {{ t('newThread.homepage.acpConfig.workdir.select') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ t('newThread.homepage.acpConfig.workdir.hint') }}
          </p>
        </div>

        <!-- 模型选择 -->
        <div v-if="availableModels.length > 0" class="space-y-2">
          <Label>{{ t('newThread.homepage.acpConfig.model.label') }}</Label>
          <Select v-model="selectedModelId">
            <SelectTrigger>
              <SelectValue :placeholder="t('newThread.homepage.acpConfig.model.placeholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="model in availableModels" :key="model.id" :value="model.id">
                {{ model.name || model.id }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 模式选择 -->
        <div v-if="availableModes.length > 0" class="space-y-2">
          <Label>{{ t('newThread.homepage.acpConfig.mode.label') }}</Label>
          <Select v-model="selectedModeId">
            <SelectTrigger>
              <SelectValue :placeholder="t('newThread.homepage.acpConfig.mode.placeholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="mode in availableModes" :key="mode.id" :value="mode.id">
                {{ mode.name || mode.id }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
          <span>{{ t('newThread.homepage.acpConfig.loading') }}</span>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleCancel">{{ t('common.cancel') }}</Button>
        <Button @click="handleConfirm" :disabled="!canStart">
          {{ t('newThread.homepage.acpConfig.start') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Icon } from '@iconify/vue'
import { useAcpWorkdir } from '@/components/chat-input/composables/useAcpWorkdir'
import { useAcpSessionModel } from '@/components/chat-input/composables/useAcpSessionModel'
import { useAcpMode } from '@/components/chat-input/composables/useAcpMode'

interface Props {
  open?: boolean
  agentId?: string | null
  agentName?: string
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (
    e: 'confirm',
    config: {
      agentId: string
      workdir: string
      modelId?: string
      modeId?: string
    }
  ): void
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  agentId: null,
  agentName: ''
})

const emit = defineEmits<Emits>()

const { t } = useI18n()

// 内部状态
const internalOpen = ref(props.open)
const selectedModelId = ref<string>('')
const selectedModeId = ref<string>('')
const loading = ref(false)

// Composables 集成
const acpWorkdir = useAcpWorkdir({
  activeModel: computed(() => ({
    id: props.agentId || '',
    providerId: 'acp'
  })),
  conversationId: computed(() => null)
})

const acpSessionModel = useAcpSessionModel({
  activeModel: computed(() => ({
    id: props.agentId || '',
    providerId: 'acp'
  })),
  conversationId: computed(() => null),
  workdir: computed(() => acpWorkdir.workdir.value || null)
})

const acpMode = useAcpMode({
  activeModel: computed(() => ({
    id: props.agentId || '',
    providerId: 'acp'
  })),
  conversationId: computed(() => null),
  workdir: computed(() => acpWorkdir.workdir.value || null)
})

// 计算属性
const dialogTitle = computed(() => {
  return props.agentName
    ? t('newThread.homepage.acpConfig.title', { name: props.agentName })
    : t('newThread.homepage.acpConfig.title', { name: 'Agent' })
})

const canStart = computed(() => {
  return acpWorkdir.workdir.value && !loading.value
})

const availableModels = computed(() => {
  return acpSessionModel.availableModels.value || []
})

const availableModes = computed(() => {
  return acpMode.availableModes.value || []
})

// 事件处理器
const handleSelectWorkdir = async () => {
  if (loading.value) return

  loading.value = true
  try {
    await acpWorkdir.selectWorkdir()
  } catch (error) {
    console.error('Failed to select workdir:', error)
  } finally {
    loading.value = false
  }
}

const handleConfirm = () => {
  if (!canStart.value || !props.agentId) return

  emit('confirm', {
    agentId: props.agentId,
    workdir: acpWorkdir.workdir.value || '',
    modelId: selectedModelId.value || undefined,
    modeId: selectedModeId.value || undefined
  })

  // 关闭对话框
  internalOpen.value = false
}

const handleCancel = () => {
  internalOpen.value = false
}

// Watch 效果
watch(
  () => props.open,
  (newVal) => {
    internalOpen.value = newVal
  }
)

watch(internalOpen, (newVal) => {
  emit('update:open', newVal)
})
</script>
