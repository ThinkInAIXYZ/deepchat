<template>
  <div class="border rounded-lg overflow-hidden">
    <div class="flex items-center p-4 bg-card">
      <div class="flex-1">
        <div class="flex items-center">
          <img src="@/assets/images/fastgpt.png" class="h-5 mr-2" />
          <span class="text-base font-medium">{{ t('settings.knowledgeBase.fastgptTitle') }}</span>
        </div>
        <p class="text-sm text-muted-foreground mt-1">
          {{ t('settings.knowledgeBase.fastgptDescription') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <!-- MCP开关 -->
        <TooltipProvider>
          <Tooltip :delay-duration="200">
            <TooltipTrigger as-child>
              <Switch
                :checked="isFastGptMcpEnabled"
                :disabled="!mcpStore.mcpEnabled"
                @update:checked="toggleFastGptMcpServer"
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
          @click="toggleFastGptConfigPanel"
        >
          <Icon
            :icon="isFastGptConfigPanelOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
            class="w-4 h-4"
          />
          {{ isFastGptConfigPanelOpen ? t('common.collapse') : t('common.expand') }}
        </Button>
      </div>
    </div>

    <!-- FastGPT配置面板 -->
    <Collapsible v-model:open="isFastGptConfigPanelOpen">
      <CollapsibleContent>
        <div class="p-4 border-t space-y-4">
          <!-- 已添加的配置列表 -->
          <div v-if="fastGptConfigs.length > 0" class="space-y-3">
            <div
              v-for="(config, index) in fastGptConfigs"
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
                  @click="editFastGptConfig(index)"
                >
                  <Icon icon="lucide:edit" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-destructive"
                  @click="removeFastGptConfig(index)"
                >
                  <Icon icon="lucide:trash-2" class="h-4 w-4" />
                </button>
              </div>

              <div class="grid gap-2">
                <div class="flex items-center">
                  <span class="font-medium text-sm">{{ config.description }}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span class="font-medium">API Key:</span>
                    <span>{{ config.apiKey.substring(0, 8) + '****' }}</span>
                  </div>
                  <div>
                    <span class="font-medium">Dataset ID:</span>
                    <span>{{ config.datasetId }}</span>
                  </div>
                  <div class="col-span-2">
                    <span class="font-medium">Endpoint:</span>
                    <span>{{ config.endpoint }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 添加配置按钮 -->
          <div class="flex justify-center">
            <Button
              type="button"
              size="sm"
              class="w-full flex items-center justify-center gap-2"
              variant="outline"
              @click="openAddConfig"
            >
              <Icon icon="lucide:plus" class="w-8 h-4" />
              {{ t('settings.knowledgeBase.addFastGptConfig') }}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>

    <!-- FastGPT配置对话框 -->
    <Dialog v-model:open="isFastGptConfigDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{
            isEditing
              ? t('settings.knowledgeBase.editFastGptConfig')
              : t('settings.knowledgeBase.addFastGptConfig')
          }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.knowledgeBase.fastgptDescription') }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-fastgpt-description">
              {{ t('settings.knowledgeBase.descriptionDesc') }}
            </Label>
            <Input
              id="edit-fastgpt-description"
              v-model="editingFastGptConfig.description"
              :placeholder="t('settings.knowledgeBase.descriptionPlaceholder')"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-fastgpt-api-key">
              {{ t('settings.knowledgeBase.apiKey') }}
            </Label>
            <Input
              id="edit-fastgpt-api-key"
              v-model="editingFastGptConfig.apiKey"
              type="password"
              placeholder="FastGPT API Key"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-fastgpt-dataset-id">
              {{ t('settings.knowledgeBase.datasetId') }}
            </Label>
            <Input
              id="edit-fastgpt-dataset-id"
              v-model="editingFastGptConfig.datasetId"
              placeholder="FastGPT Dataset ID"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-fastgpt-endpoint">
              {{ t('settings.knowledgeBase.endpoint') }}
            </Label>
            <Input
              id="edit-fastgpt-endpoint"
              v-model="editingFastGptConfig.endpoint"
              placeholder="http://localhost:3000/api"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="closeFastGptConfigDialog">{{
            t('common.cancel')
          }}</Button>
          <Button type="button" :disabled="!isEditingFastGptConfigValid" @click="saveFastGptConfig">
            {{ isEditing ? t('common.confirm') : t('settings.knowledgeBase.addConfig') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, toRaw, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { useMcpStore } from '@/stores/mcp'
import { useToast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const { t } = useI18n()
const mcpStore = useMcpStore()
const { toast } = useToast()
import { useRoute } from 'vue-router'

const route = useRoute()

// 对话框状态
const isFastGptConfigPanelOpen = ref(false)
const isFastGptConfigDialogOpen = ref(false)
const isEditing = ref(false)

// FastGPT配置状态
interface FastGptConfig {
  description: string
  apiKey: string
  datasetId: string
  endpoint: string
  enabled?: boolean
}

const fastGptConfigs = ref<FastGptConfig[]>([])
const editingFastGptConfig = ref<FastGptConfig>({
  description: '',
  apiKey: '',
  datasetId: '',
  endpoint: 'http://localhost:3000/api',
  enabled: true
})
const editingConfigIndex = ref<number>(-1)

// 验证配置是否有效
const isEditingFastGptConfigValid = computed(() => {
  return (
    editingFastGptConfig.value.apiKey.trim() !== '' &&
    editingFastGptConfig.value.datasetId.trim() !== '' &&
    editingFastGptConfig.value.description.trim() !== ''
  )
})

// 打开添加配置对话框
const openAddConfig = () => {
  isEditing.value = false
  editingConfigIndex.value = -1
  editingFastGptConfig.value = {
    description: '',
    apiKey: '',
    datasetId: '',
    endpoint: 'http://localhost:3000/api',
    enabled: true
  }
  isFastGptConfigDialogOpen.value = true
}

defineExpose({
  openAddConfig
})

// 打开编辑配置对话框
const editFastGptConfig = (index: number) => {
  isEditing.value = true
  editingConfigIndex.value = index
  const config = fastGptConfigs.value[index]
  editingFastGptConfig.value = { ...config }
  isFastGptConfigDialogOpen.value = true
}

// 关闭配置对话框
const closeFastGptConfigDialog = () => {
  isFastGptConfigDialogOpen.value = false
  editingConfigIndex.value = -1
  editingFastGptConfig.value = {
    description: '',
    apiKey: '',
    datasetId: '',
    endpoint: 'http://localhost:3000/api',
    enabled: true
  }
}

// 保存配置
const saveFastGptConfig = async () => {
  if (!isEditingFastGptConfigValid.value) return

  if (isEditing.value) {
    // 更新配置
    if (editingConfigIndex.value !== -1) {
      fastGptConfigs.value[editingConfigIndex.value] = { ...editingFastGptConfig.value }
    }
    toast({
      title: t('settings.knowledgeBase.configUpdated'),
      description: t('settings.knowledgeBase.configUpdatedDesc', {
        name: t('settings.knowledgeBase.fastgptTitle')
      })
    })
  } else {
    // 添加配置
    fastGptConfigs.value.push({ ...editingFastGptConfig.value })
    toast({
      title: t('settings.knowledgeBase.configAdded'),
      description: t('settings.knowledgeBase.configAddedDesc', {
        name: t('settings.knowledgeBase.fastgptTitle')
      })
    })
  }

  // 更新到MCP配置
  await updateFastGptConfigToMcp()

  // 关闭对话框
  closeFastGptConfigDialog()
}

// 移除FastGPT配置
const removeFastGptConfig = async (index: number) => {
  fastGptConfigs.value.splice(index, 1)
  await updateFastGptConfigToMcp()
}

// 切换配置启用状态
const toggleConfigEnabled = async (index: number, enabled: boolean) => {
  fastGptConfigs.value[index].enabled = enabled
  await updateFastGptConfigToMcp()
}

// 更新FastGPT配置到MCP
const updateFastGptConfigToMcp = async () => {
  try {
    // 将配置转换为MCP需要的格式 - 转换为JSON字符串
    const envJson = {
      configs: toRaw(fastGptConfigs.value)
    }
    // 更新到MCP服务器
    await mcpStore.updateServer('fastGptKnowledge', {
      env: envJson
    })

    return true
  } catch (error) {
    console.error('更新FastGPT配置失败:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: String(error),
      variant: 'destructive'
    })
    return false
  }
}

// 从MCP加载FastGPT配置
const loadFastGptConfigFromMcp = async () => {
  try {
    // 获取fastGptKnowledge服务器配置
    console.log(mcpStore.config)
    const serverConfig = mcpStore.config.mcpServers['fastGptKnowledge']
    if (serverConfig && serverConfig.env) {
      // 解析配置 - env可能是JSON字符串
      try {
        // 尝试解析JSON字符串
        const envObj =
          typeof serverConfig.env === 'string' ? JSON.parse(serverConfig.env) : serverConfig.env
        if (envObj.configs && Array.isArray(envObj.configs)) {
          fastGptConfigs.value = envObj.configs
        }
      } catch (parseError) {
        console.error('解析FastGPT配置JSON失败:', parseError)
      }
    }
  } catch (error) {
    console.error('加载FastGPT配置失败:', error)
  }
}

// 切换FastGPT配置面板
const toggleFastGptConfigPanel = () => {
  isFastGptConfigPanelOpen.value = !isFastGptConfigPanelOpen.value
}

// 计算FastGPT MCP服务器是否启用
const isFastGptMcpEnabled = computed(() => {
  return mcpStore.serverStatuses['fastGptKnowledge'] || false
})

// 切换FastGPT MCP服务器状态
const toggleFastGptMcpServer = async () => {
  if (!mcpStore.mcpEnabled) return
  await mcpStore.toggleServer('fastGptKnowledge')
}

// 监听MCP全局状态变化
watch(
  () => mcpStore.mcpEnabled,
  async (enabled) => {
    if (!enabled && isFastGptMcpEnabled.value) {
      await mcpStore.toggleServer('fastGptKnowledge')
    }
  }
)

// 监听URL查询参数，设置活动标签页
watch(
  () => route.query.subtab,
  (newSubtab) => {
    if (newSubtab === 'fastgpt') {
      isFastGptConfigPanelOpen.value = true
    }
  },
  { immediate: true }
)

// 组件挂载时加载配置
let unwatch: (() => void) | undefined
onMounted(async () => {
  unwatch = watch(
    () => mcpStore.config.ready,
    async (ready) => {
      if (ready) {
        unwatch?.() // only run once to avoid multiple calls
        await loadFastGptConfigFromMcp()
      }
    },
    { immediate: true }
  )
})

// cancel the watch to avoid memory leaks
onUnmounted(() => {
  unwatch?.()
})
</script>
