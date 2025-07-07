<template>
  <section class="w-full h-full">
    <div class="w-full h-full p-2 flex flex-col gap-2 overflow-y-auto">
      <div class="flex flex-col items-start p-2 gap-2">
        <div class="flex justify-between items-center w-full">
          <Label :for="`${provider.id}-url`" class="flex-1 cursor-pointer">API URL</Label>
        </div>
        <Input
          :id="`${provider.id}-url`"
          v-model="apiHost"
          :placeholder="t('settings.provider.urlPlaceholder')"
          @blur="handleApiHostChange(String($event.target.value))"
          @keyup.enter="handleApiHostChange(apiHost)"
        />
        <div class="text-xs text-muted-foreground">
          {{
            t('settings.provider.urlFormat', {
              defaultUrl: 'http://127.0.0.1:11434'
            })
          }}
        </div>
      </div>

      <div class="flex flex-col items-start p-2 gap-2">
        <Label :for="`${provider.id}-apikey`" class="flex-1 cursor-pointer">API Key</Label>
        <Input
          :id="`${provider.id}-apikey`"
          v-model="apiKey"
          type="password"
          :placeholder="t('settings.provider.keyPlaceholder')"
          @blur="handleApiKeyChange(String($event.target.value))"
          @keyup.enter="handleApiKeyEnter(apiKey)"
        />
        <div class="flex flex-row gap-2">
          <Button
            variant="outline"
            size="xs"
            class="text-xs text-normal rounded-lg"
            @click="openModelCheckDialog"
          >
            <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />
            {{ t('settings.provider.verifyKey') }}
          </Button>
        </div>
      </div>

      <div class="flex flex-col items-start p-2 gap-2">
        <Label :for="`${provider.id}-model`" class="flex-1 cursor-pointer">
          {{ t('settings.provider.modelList') }}
        </Label>
        <div class="flex flex-row gap-2 items-center">
          <Button
            variant="outline"
            size="xs"
            class="text-xs text-normal rounded-lg"
            @click="showPullModelDialog = true"
          >
            <Icon icon="lucide:download" class="w-4 h-4 text-muted-foreground" />
            {{ t('settings.provider.pullModels') }}
          </Button>
          <Button
            variant="outline"
            size="xs"
            class="text-xs text-normal rounded-lg"
            @click="refreshModels"
          >
            <Icon icon="lucide:refresh-cw" class="w-4 h-4 text-muted-foreground" />
            {{ t('settings.provider.refreshModels') }}
          </Button>
          <span class="text-xs text-muted-foreground">
            {{ runningModels.length }}/{{ localModels.length }}
            {{ t('settings.provider.modelsRunning') }}
          </span>
        </div>

        <!-- 运行中模型列表 -->
        <div class="flex flex-col w-full gap-2">
          <h3 class="text-sm font-medium text-muted-foreground">
            {{ t('settings.provider.runningModels') }}
          </h3>
          <div class="flex flex-col w-full border overflow-hidden rounded-lg">
            <div v-if="runningModels.length === 0" class="p-4 text-center text-muted-foreground">
              {{ t('settings.provider.noRunningModels') }}
            </div>
            <div
              v-for="model in runningModels"
              :key="model.name"
              class="flex flex-row items-center justify-between p-2 border-b last:border-b-0 hover:bg-accent"
            >
              <div class="flex flex-col">
                <span class="text-sm font-medium">{{ model.name }}</span>
                <span class="text-xs text-muted-foreground">{{ formatModelSize(model.size) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 本地模型列表 -->
        <div class="flex flex-col w-full gap-2 mt-2">
          <h3 class="text-sm font-medium text-muted-foreground">
            {{ t('settings.provider.localModels') }}
          </h3>
          <div class="flex flex-col w-full border overflow-hidden rounded-lg">
            <div
              v-if="localModels.length === 0 && pullingModels.size === 0"
              class="p-4 text-center text-muted-foreground"
            >
              {{ t('settings.provider.noLocalModels') }}
            </div>
            <div
              v-for="model in displayLocalModels"
              :key="model.name"
              class="flex flex-row items-center justify-between p-2 border-b last:border-b-0 hover:bg-accent"
            >
              <div class="flex flex-col flex-grow">
                <div class="flex flex-row items-center gap-1">
                  <span class="text-sm font-medium">{{ model.name }}</span>
                  <span
                    v-if="model.pulling"
                    class="text-xs text-primary-foreground bg-primary px-1 py-0.5 rounded"
                  >
                    {{ t('settings.provider.pulling') }}
                  </span>
                  <span v-if="model.pulling" class="w-[50px]">
                    <Progress :model-value="pullingModels.get(model.name)" class="h-1.5" />
                  </span>
                </div>
                <span class="text-xs text-muted-foreground">{{ formatModelSize(model.size) }}</span>
              </div>
              <div class="flex flex-row gap-2">
                <Button
                  v-if="!model.pulling"
                  variant="destructive"
                  size="xs"
                  class="text-xs rounded-lg"
                  :disabled="isModelRunning(model.name)"
                  @click="showDeleteModelConfirm(model.name)"
                >
                  <Icon icon="lucide:trash-2" class="w-3.5 h-3.5 mr-1" />
                  {{ t('settings.provider.deleteModel') }}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 拉取模型对话框 -->
    <Dialog v-model:open="showPullModelDialog">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ t('settings.provider.dialog.pullModel.title') }}</DialogTitle>
        </DialogHeader>
        <div class="py-4 max-h-80 overflow-y-auto">
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="model in availableModels"
              :key="model.name"
              class="flex flex-row items-center justify-between p-2 border rounded-lg hover:bg-accent"
              :class="{ 'opacity-50': isModelLocal(model.name) }"
            >
              <div class="flex flex-col">
                <span class="text-sm font-medium">{{ model.name }}</span>
              </div>
              <Button
                variant="outline"
                size="xs"
                class="text-xs rounded-lg"
                :disabled="isModelLocal(model.name)"
                @click="pullModel(model.name)"
              >
                <Icon icon="lucide:download" class="w-3.5 h-3.5 mr-1" />
                {{ t('settings.provider.dialog.pullModel.pull') }}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showPullModelDialog = false">
            {{ t('dialog.close') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 删除模型确认对话框 -->
    <Dialog v-model:open="showDeleteModelDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('settings.provider.dialog.deleteModel.title') }}</DialogTitle>
        </DialogHeader>
        <div class="py-4">
          {{ t('settings.provider.dialog.deleteModel.content', { name: modelToDelete }) }}
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteModelDialog = false">
            {{ t('dialog.cancel') }}
          </Button>
          <Button variant="destructive" @click="confirmDeleteModel">
            {{ t('settings.provider.dialog.deleteModel.confirm') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 检查模型对话框 -->
    <Dialog v-model:open="showCheckModelDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {{
              t(
                checkResult
                  ? 'settings.provider.dialog.verify.success'
                  : 'settings.provider.dialog.verify.failed'
              )
            }}</DialogTitle
          >
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showCheckModelDialog = false">
            {{ t('dialog.close') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref, watch, onMounted } from 'vue'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Icon } from '@iconify/vue'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { useSettingsStore } from '@/stores/settings'
import { useModelCheckStore } from '@/stores/modelCheck'
import type { LLM_PROVIDER } from '@shared/presenter'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const settingsStore = useSettingsStore()
const modelCheckStore = useModelCheckStore()
const apiHost = ref(props.provider.baseUrl || '')
const apiKey = ref(props.provider.apiKey || '')
const showPullModelDialog = ref(false)
const showDeleteModelDialog = ref(false)
const modelToDelete = ref('')
const showCheckModelDialog = ref(false)
const checkResult = ref<boolean>(false)

// 模型列表 - 从 settings store 获取
const runningModels = computed(() => settingsStore.ollamaRunningModels)
const localModels = computed(() => settingsStore.ollamaLocalModels)
const pullingModels = computed(() => settingsStore.ollamaPullingModels)

// 预设可拉取的模型列表
const presetModels = [
  {
    name: 'qwen3:0.6b'
  },
  {
    name: 'qwen3:1.7b'
  },
  {
    name: 'qwen3:4b'
  },
  {
    name: 'qwen3:8b'
  },
  {
    name: 'qwen3:14b'
  },
  {
    name: 'qwen3:30b'
  },
  {
    name: 'qwen3:32b'
  },
  {
    name: 'qwen3:235b'
  },
  {
    name: 'gemma3:1b'
  },
  {
    name: 'gemma3:4b'
  },
  {
    name: 'gemma3:12b'
  },
  {
    name: 'gemma3:27b'
  },
  {
    name: 'qwq:32b'
  },
  {
    name: 'deepseek-r1:1.5b'
  },
  {
    name: 'deepseek-r1:7b'
  },
  {
    name: 'deepseek-r1:8b'
  },
  {
    name: 'deepseek-r1:14b'
  },
  {
    name: 'deepseek-r1:32b'
  },
  {
    name: 'deepseek-r1:70b'
  },
  {
    name: 'deepseek-r1:671b'
  },
  {
    name: 'llama3.3:70b'
  },
  {
    name: 'phi4:14b'
  },
  {
    name: 'llama3.2:1b'
  },
  {
    name: 'llama3.2:3b'
  },
  {
    name: 'llama3.1:8b'
  },
  {
    name: 'llama3.1:70b'
  },
  {
    name: 'llama3.1:405b'
  },
  {
    name: 'mistral:7b'
  },
  {
    name: 'llama3:8b'
  },
  {
    name: 'llama3:70b'
  }
]

// 可拉取的模型（排除已有的和正在拉取的）
const availableModels = computed(() => {
  const localModelNames = new Set(localModels.value.map((m) => m.name))
  const pullingModelNames = new Set(Array.from(pullingModels.value.keys()))
  return presetModels.filter((m) => !localModelNames.has(m.name) && !pullingModelNames.has(m.name))
})

// 显示的本地模型（包括正在拉取的）
const displayLocalModels = computed(() => {
  // 创建带有pulling状态和进度的模型列表
  const models = localModels.value.map((model) => ({
    ...model,
    pulling: pullingModels.value.has(model.name),
    progress: pullingModels.value.get(model.name) || 0
  }))

  // 添加正在拉取但尚未出现在本地列表中的模型
  for (const [modelName, progress] of pullingModels.value.entries()) {
    if (!models.some((m) => m.name === modelName)) {
      models.unshift({
        name: modelName,
        model: modelName, // 添加必需的字段
        modified_at: new Date(), // 添加必需的字段
        size: 0,
        digest: '', // 添加必需的字段
        details: {
          // 添加必需的字段
          format: '',
          family: '',
          families: [],
          parameter_size: '',
          quantization_level: ''
        },
        pulling: true,
        progress
      })
    }
  }

  // 排序: 正在拉取的放前面，其余按名称排序
  return models.sort((a, b) => {
    if (a.pulling && !b.pulling) return -1
    if (!a.pulling && b.pulling) return 1
    return a.name.localeCompare(b.name)
  })
})

// 初始化
onMounted(() => {
  refreshModels()
})

// 刷新模型列表 - 使用 settings store
const refreshModels = async () => {
  await settingsStore.refreshOllamaModels()
}

// 拉取模型 - 使用 settings store
const pullModel = async (modelName: string) => {
  try {
    // 开始拉取
    const success = await settingsStore.pullOllamaModel(modelName)

    // 成功开始拉取后关闭对话框
    if (success) {
      showPullModelDialog.value = false
    }
  } catch (error) {
    console.error(`Failed to pull model ${modelName}:`, error)
  }
}

// 显示删除模型确认对话框
const showDeleteModelConfirm = (modelName: string) => {
  modelToDelete.value = modelName
  showDeleteModelDialog.value = true
}

// 确认删除模型 - 使用 settings store
const confirmDeleteModel = async () => {
  if (!modelToDelete.value) return

  try {
    const success = await settingsStore.deleteOllamaModel(modelToDelete.value)
    if (success) {
      // 删除成功后模型列表会自动刷新，无需额外调用 refreshModels
    }
    showDeleteModelDialog.value = false
    modelToDelete.value = ''
  } catch (error) {
    console.error(`Failed to delete model ${modelToDelete.value}:`, error)
  }
}

// 工具函数
const formatModelSize = (sizeInBytes: number): string => {
  if (!sizeInBytes) return ''

  const GB = 1024 * 1024 * 1024
  if (sizeInBytes >= GB) {
    return `${(sizeInBytes / GB).toFixed(2)} GB`
  }

  const MB = 1024 * 1024
  if (sizeInBytes >= MB) {
    return `${(sizeInBytes / MB).toFixed(2)} MB`
  }

  const KB = 1024
  return `${(sizeInBytes / KB).toFixed(2)} KB`
}

// 使用 settings store 的辅助函数
const isModelRunning = (modelName: string): boolean => {
  return settingsStore.isOllamaModelRunning(modelName)
}

const isModelLocal = (modelName: string): boolean => {
  return settingsStore.isOllamaModelLocal(modelName)
}

// API URL 处理
const handleApiHostChange = async (value: string) => {
  await settingsStore.updateProviderApi(props.provider.id, undefined, value)
}

// API Key 处理
const handleApiKeyChange = async (value: string) => {
  await settingsStore.updateProviderApi(props.provider.id, value, undefined)
}

const handleApiKeyEnter = async (value: string) => {
  const inputElement = document.getElementById(`${props.provider.id}-apikey`)
  if (inputElement) {
    inputElement.blur()
  }
  await settingsStore.updateProviderApi(props.provider.id, value, undefined)
  await validateApiKey()
}

const validateApiKey = async () => {
  try {
    const resp = await settingsStore.checkProvider(props.provider.id)
    if (resp.isOk) {
      console.log('验证成功')
      checkResult.value = true
      showCheckModelDialog.value = true
      // 验证成功后刷新模型列表
      await refreshModels()
    } else {
      console.log('验证失败', resp.errorMsg)
      checkResult.value = false
      showCheckModelDialog.value = true
    }
  } catch (error) {
    console.error('Failed to validate API key:', error)
    checkResult.value = false
    showCheckModelDialog.value = true
  }
}

const openModelCheckDialog = () => {
  modelCheckStore.openDialog(props.provider.id)
}

// 监听 provider 变化
watch(
  () => props.provider,
  () => {
    apiHost.value = props.provider.baseUrl || ''
    apiKey.value = props.provider.apiKey || ''
    refreshModels()
  },
  { immediate: true }
)
</script>
