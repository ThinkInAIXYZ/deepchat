<template>
  <div class="border rounded-lg overflow-hidden">
    <div class="flex items-center p-4 bg-card">
      <div class="flex-1">
        <div class="flex items-center">
          <img src="@/assets/images/ragflow.png" class="h-5 mr-2" />
          <span class="text-base font-medium">RAGFlow</span>
        </div>
        <p class="text-sm text-muted-foreground mt-1">
          {{ t('settings.knowledgeBase.ragflowDescription') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <!-- MCP开关 -->
        <TooltipProvider>
          <Tooltip :delay-duration="200">
            <TooltipTrigger as-child>
              <Switch
                :checked="isRagflowMcpEnabled"
                :disabled="!mcpStore.mcpEnabled"
                @update:checked="toggleRagflowMcpServer"
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
          @click="toggleRagflowConfigPanel"
        >
          <Icon
            :icon="isRagflowConfigPanelOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
            class="w-4 h-4"
          />
          {{ isRagflowConfigPanelOpen ? t('common.collapse') : t('common.expand') }}
        </Button>
      </div>
    </div>

    <!-- RAGFlow配置面板 -->
    <Collapsible v-model:open="isRagflowConfigPanelOpen">
      <CollapsibleContent>
        <div class="p-4 border-t space-y-4">
          <!-- 已添加的配置列表 -->
          <div v-if="ragflowConfigs.length > 0" class="space-y-3">
            <div
              v-for="(config, index) in ragflowConfigs"
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
                  @click="editRagflowConfig(index)"
                >
                  <Icon icon="lucide:edit" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-destructive"
                  @click="removeRagflowConfig(index)"
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
                    <span class="font-medium">Dataset IDs:</span>
                    <span>{{ config.datasetIds.join(', ') }}</span>
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
              {{ t('settings.knowledgeBase.addRagflowConfig') }}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>

    <!-- RAGFlow配置对话框 -->
    <Dialog v-model:open="isRagflowConfigDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{
            isEditing
              ? t('settings.knowledgeBase.editRagflowConfig')
              : t('settings.knowledgeBase.addRagflowConfig')
          }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.knowledgeBase.ragflowDescription') }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-ragflow-description">
              {{ t('settings.knowledgeBase.descriptionDesc') }}
            </Label>
            <Input
              id="edit-ragflow-description"
              v-model="editingRagflowConfig.description"
              :placeholder="t('settings.knowledgeBase.descriptionPlaceholder')"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-ragflow-api-key">
              {{ t('settings.knowledgeBase.apiKey') }}
            </Label>
            <Input
              id="edit-ragflow-api-key"
              v-model="editingRagflowConfig.apiKey"
              type="password"
              placeholder="RAGFlow API Key"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-ragflow-dataset-ids">
              {{ t('settings.knowledgeBase.datasetId') }}
            </Label>
            <Input
              id="edit-ragflow-dataset-ids"
              v-model="editingRagflowConfig.datasetIdsStr"
              placeholder="Dataset IDs (用逗号分隔)"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-ragflow-endpoint">
              {{ t('settings.knowledgeBase.endpoint') }}
            </Label>
            <Input
              id="edit-ragflow-endpoint"
              v-model="editingRagflowConfig.endpoint"
              placeholder="http://localhost"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="closeRagflowConfigDialog">{{
            t('common.cancel')
          }}</Button>
          <Button type="button" :disabled="!isEditingRagflowConfigValid" @click="saveRagflowConfig">
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
import { useRoute } from 'vue-router'

const { t } = useI18n()
const mcpStore = useMcpStore()
const { toast } = useToast()
const route = useRoute()

// 对话框状态
const isRagflowConfigPanelOpen = ref(false)
const isRagflowConfigDialogOpen = ref(false)
const isEditing = ref(false)

// RAGFlow配置状态
interface RagflowConfig {
  description: string
  apiKey: string
  datasetIds: string[]
  endpoint: string
  enabled?: boolean
}

interface EditingRagflowConfig extends Omit<RagflowConfig, 'datasetIds'> {
  datasetIdsStr: string
}

const ragflowConfigs = ref<RagflowConfig[]>([])
const editingRagflowConfig = ref<EditingRagflowConfig>({
  description: '',
  apiKey: '',
  datasetIdsStr: '',
  endpoint: 'http://localhost',
  enabled: true
})
const editingConfigIndex = ref<number>(-1)

// 验证配置是否有效
const isEditingRagflowConfigValid = computed(() => {
  return (
    editingRagflowConfig.value.apiKey.trim() !== '' &&
    editingRagflowConfig.value.datasetIdsStr.trim() !== '' &&
    editingRagflowConfig.value.description.trim() !== ''
  )
})

// 打开添加配置对话框
const openAddConfig = () => {
  isEditing.value = false
  editingConfigIndex.value = -1
  editingRagflowConfig.value = {
    description: '',
    apiKey: '',
    datasetIdsStr: '',
    endpoint: 'http://localhost',
    enabled: true
  }
  isRagflowConfigDialogOpen.value = true
}

defineExpose({
  openAddConfig
})

// 打开编辑配置对话框
const editRagflowConfig = (index: number) => {
  isEditing.value = true
  editingConfigIndex.value = index
  const config = ragflowConfigs.value[index]
  editingRagflowConfig.value = {
    ...config,
    datasetIdsStr: config.datasetIds.join(',')
  }
  isRagflowConfigDialogOpen.value = true
}

// 关闭配置对话框
const closeRagflowConfigDialog = () => {
  isRagflowConfigDialogOpen.value = false
  editingConfigIndex.value = -1
  editingRagflowConfig.value = {
    description: '',
    apiKey: '',
    datasetIdsStr: '',
    endpoint: 'http://localhost',
    enabled: true
  }
}

// 保存配置
const saveRagflowConfig = async () => {
  if (!isEditingRagflowConfigValid.value) return

  const datasetIds = editingRagflowConfig.value.datasetIdsStr
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')

  const config: RagflowConfig = {
    description: editingRagflowConfig.value.description,
    apiKey: editingRagflowConfig.value.apiKey,
    datasetIds,
    endpoint: editingRagflowConfig.value.endpoint,
    enabled: editingRagflowConfig.value.enabled
  }

  if (isEditing.value) {
    // 更新配置
    if (editingConfigIndex.value !== -1) {
      ragflowConfigs.value[editingConfigIndex.value] = config
    }
    toast({
      title: t('settings.knowledgeBase.configUpdated'),
      description: t('settings.knowledgeBase.configUpdatedDesc', {
        name: t('settings.knowledgeBase.ragflowTitle')
      })
    })
  } else {
    // 添加配置
    ragflowConfigs.value.push(config)
    toast({
      title: t('settings.knowledgeBase.configAdded'),
      description: t('settings.knowledgeBase.configAddedDesc', {
        name: t('settings.knowledgeBase.ragflowTitle')
      })
    })
  }

  // 更新到MCP配置
  await updateRagflowConfigToMcp()

  // 关闭对话框
  closeRagflowConfigDialog()
}

// 移除RAGFlow配置
const removeRagflowConfig = async (index: number) => {
  ragflowConfigs.value.splice(index, 1)
  await updateRagflowConfigToMcp()
}

// 切换配置启用状态
const toggleConfigEnabled = async (index: number, enabled: boolean) => {
  ragflowConfigs.value[index].enabled = enabled
  await updateRagflowConfigToMcp()
}

// 更新RAGFlow配置到MCP
const updateRagflowConfigToMcp = async () => {
  try {
    // 将配置转换为MCP需要的格式 - 转换为JSON字符串
    const envJson = {
      configs: toRaw(ragflowConfigs.value)
    }
    // 更新到MCP服务器
    await mcpStore.updateServer('ragflowKnowledge', {
      env: envJson
    })

    return true
  } catch (error) {
    console.error('更新RAGFlow配置失败:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: String(error),
      variant: 'destructive'
    })
    return false
  }
}

// 从MCP加载RAGFlow配置
const loadRagflowConfigFromMcp = async () => {
  try {
    // 获取ragflowKnowledge服务器配置
    const serverConfig = mcpStore.config.mcpServers['ragflowKnowledge']
    if (serverConfig && serverConfig.env) {
      // 解析配置 - env可能是JSON字符串
      try {
        // 尝试解析JSON字符串
        const envObj =
          typeof serverConfig.env === 'string' ? JSON.parse(serverConfig.env) : serverConfig.env
        if (envObj.configs && Array.isArray(envObj.configs)) {
          ragflowConfigs.value = envObj.configs
        }
      } catch (parseError) {
        console.error('解析RAGFlow配置JSON失败:', parseError)
      }
    }
  } catch (error) {
    console.error('加载RAGFlow配置失败:', error)
  }
}

// 切换RAGFlow配置面板
const toggleRagflowConfigPanel = () => {
  isRagflowConfigPanelOpen.value = !isRagflowConfigPanelOpen.value
}

// 计算RAGFlow MCP服务器是否启用
const isRagflowMcpEnabled = computed(() => {
  return mcpStore.serverStatuses['ragflowKnowledge'] || false
})

// 切换RAGFlow MCP服务器状态
const toggleRagflowMcpServer = async () => {
  if (!mcpStore.mcpEnabled) return
  await mcpStore.toggleServer('ragflowKnowledge')
}

// 监听MCP全局状态变化
watch(
  () => mcpStore.mcpEnabled,
  async (enabled) => {
    if (!enabled && isRagflowMcpEnabled.value) {
      await mcpStore.toggleServer('ragflowKnowledge')
    }
  }
)

// 监听URL查询参数，设置活动标签页
watch(
  () => route.query.subtab,
  (newSubtab) => {
    if (newSubtab === 'ragflow') {
      isRagflowConfigPanelOpen.value = true
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
        await loadRagflowConfigFromMcp()
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
