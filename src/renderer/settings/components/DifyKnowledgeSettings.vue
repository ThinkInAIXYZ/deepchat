<template>
  <div class="border rounded-lg overflow-hidden">
    <div
      class="flex items-center p-4 hover:bg-accent cursor-default"
      @click="toggleDifyConfigPanel"
    >
      <div class="flex-1">
        <div class="flex items-center">
          <img src="@/assets/images/dify.png" class="h-5 mr-2" />
          <span class="text-base font-medium">{{ $t('settings.knowledgeBase.dify') }}</span>
        </div>
        <p class="text-sm text-muted-foreground mt-1">
          {{ t('settings.knowledgeBase.difyDescription') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <InlineOperationFeedback
          v-if="knowledgeOperation.source.value === 'panel'"
          :snapshot="knowledgeOperation.snapshot.value"
          :retry-label="t('common.retry')"
          @click.stop
          @retry="knowledgeOperation.retry"
        />
        <!-- MCP开关 -->
        <TooltipProvider>
          <Tooltip :delay-duration="200">
            <TooltipTrigger>
              <Switch
                :model-value="isDifyMcpEnabled"
                :disabled="!mcpEnabled || operationPending"
                @click.stop
                @update:model-value="toggleDifyMcpServer"
              />
            </TooltipTrigger>
            <TooltipContent v-if="!mcpEnabled">
              <p>{{ t('settings.mcp.enableToAccess') }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Icon
          :icon="isDifyConfigPanelOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
          class="w-4 h-4"
        />
      </div>
    </div>

    <!-- Dify配置面板 -->
    <Collapsible v-model:open="isDifyConfigPanelOpen">
      <CollapsibleContent>
        <div class="p-4 border-t space-y-4">
          <p v-if="loadError" role="alert" class="text-xs text-destructive">
            {{ loadError }}
          </p>
          <!-- 已添加的配置列表 -->
          <div v-if="difyConfigs.length > 0" class="space-y-3">
            <div
              v-for="(config, index) in difyConfigs"
              :key="index"
              class="p-3 border rounded-md relative"
            >
              <div class="absolute top-2 right-2 flex gap-2">
                <Switch
                  :model-value="config.enabled === true"
                  :disabled="operationPending"
                  size="sm"
                  @update:model-value="(value) => toggleConfigEnabled(index, value)"
                />
                <button
                  type="button"
                  :disabled="operationPending"
                  class="text-muted-foreground hover:text-primary"
                  @click="editDifyConfig(index)"
                >
                  <Icon icon="lucide:edit" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  :disabled="operationPending"
                  class="text-muted-foreground hover:text-destructive"
                  @click="removeDifyConfig(index)"
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
              :disabled="operationPending"
              size="sm"
              class="w-full flex items-center justify-center gap-2"
              variant="outline"
              @click="openAddConfig"
            >
              <Icon icon="lucide:plus" class="w-8 h-4" />
              {{ t('settings.knowledgeBase.addDifyConfig') }}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>

    <!-- Dify配置对话框 -->
    <Dialog :open="isDifyConfigDialogOpen" @update:open="handleDialogOpenChange">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{
            isEditing
              ? t('settings.knowledgeBase.editDifyConfig')
              : t('settings.knowledgeBase.addDifyConfig')
          }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.knowledgeBase.difyDescription') }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-dify-description">
              {{ t('settings.knowledgeBase.descriptionDesc') }}
            </Label>
            <Input
              id="edit-dify-description"
              v-model="editingDifyConfig.description"
              :disabled="operationPending"
              :placeholder="t('settings.knowledgeBase.descriptionPlaceholder')"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-dify-api-key">
              {{ t('settings.knowledgeBase.apiKey') }}
            </Label>
            <Input
              id="edit-dify-api-key"
              v-model="editingDifyConfig.apiKey"
              :disabled="operationPending"
              type="password"
              placeholder="Dify API Key"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-dify-dataset-id">
              {{ t('settings.knowledgeBase.datasetId') }}
            </Label>
            <Input
              id="edit-dify-dataset-id"
              v-model="editingDifyConfig.datasetId"
              :disabled="operationPending"
              placeholder="Dify Dataset ID"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="edit-dify-endpoint">
              {{ t('settings.knowledgeBase.endpoint') }}
            </Label>
            <Input
              id="edit-dify-endpoint"
              v-model="editingDifyConfig.endpoint"
              :disabled="operationPending"
              placeholder="https://api.dify.ai/v1"
            />
          </div>
        </div>
        <DialogFooter>
          <InlineOperationFeedback
            v-if="knowledgeOperation.source.value === 'dialog'"
            :snapshot="knowledgeOperation.snapshot.value"
            :retry-label="t('common.retry')"
            @retry="knowledgeOperation.retry"
          />
          <Button
            variant="outline"
            :disabled="operationPending"
            @click="closeEditDifyConfigDialog"
            >{{ t('common.cancel') }}</Button
          >
          <Button
            type="button"
            :disabled="operationPending || !isEditingDifyConfigValid"
            @click="saveDifyConfig"
          >
            {{ isEditing ? t('common.confirm') : t('settings.knowledgeBase.addConfig') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@shadcn/components/ui/dialog'
import { Collapsible, CollapsibleContent } from '@shadcn/components/ui/collapsible'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { useRoute } from 'vue-router'
import { useExternalKnowledgeConfigs } from '../lib/useExternalKnowledgeConfigs'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

// 对话框状态
const isDifyConfigDialogOpen = ref(false)

// 打开添加配置对话框
const openAddConfig = () => {
  if (operationPending.value) return
  isEditing.value = false
  editingConfigIndex.value = -1
  editingDifyConfig.value = {
    description: '',
    apiKey: '',
    datasetId: '',
    endpoint: 'https://api.dify.ai/v1',
    enabled: true
  }
  dialogInitialSignature.value = editingSignature.value
  isDifyConfigDialogOpen.value = true
}

defineExpose({
  openAddConfig
})

const { t } = useI18n()

// 对话框状态
const isDifyConfigPanelOpen = ref(false)
const isEditing = ref(false)

const route = useRoute()
// Dify配置状态
interface DifyConfig {
  description: string
  apiKey: string
  datasetId: string
  endpoint: string
  enabled?: boolean
}

const editingDifyConfig = ref<DifyConfig>({
  description: '',
  apiKey: '',
  datasetId: '',
  endpoint: 'https://api.dify.ai/v1',
  enabled: true
})
const editingConfigIndex = ref<number>(-1)
const dialogInitialSignature = ref('')
const editingSignature = computed(() => JSON.stringify(editingDifyConfig.value))
const dialogDirty = computed(
  () => isDifyConfigDialogOpen.value && editingSignature.value !== dialogInitialSignature.value
)

const isDifyConfig = (value: unknown): value is DifyConfig => {
  if (typeof value !== 'object' || value === null) return false
  const config = value as Record<string, unknown>
  return (
    typeof config.description === 'string' &&
    typeof config.apiKey === 'string' &&
    typeof config.datasetId === 'string' &&
    typeof config.endpoint === 'string' &&
    (config.enabled === undefined || typeof config.enabled === 'boolean')
  )
}

const cloneConfig = (config: DifyConfig): DifyConfig => ({ ...config })
const knowledgeConfigs = useExternalKnowledgeConfigs({
  serverName: 'difyKnowledge',
  codePrefix: 'settings.knowledgeBase.dify',
  diagnosticName: 'DifyKnowledge',
  isConfig: isDifyConfig,
  clone: cloneConfig
})
const difyConfigs = knowledgeConfigs.configs
const loadError = knowledgeConfigs.loadError
const knowledgeOperation = knowledgeConfigs.operation
const operationPending = knowledgeConfigs.pending
const isDifyMcpEnabled = knowledgeConfigs.serverEnabled
const mcpEnabled = knowledgeConfigs.globalEnabled

// 验证配置是否有效
const isEditingDifyConfigValid = computed(() => {
  return (
    editingDifyConfig.value.apiKey.trim() !== '' &&
    editingDifyConfig.value.datasetId.trim() !== '' &&
    editingDifyConfig.value.description.trim() !== ''
  )
})

// 打开编辑配置对话框
const editDifyConfig = (index: number) => {
  if (operationPending.value) return
  isEditing.value = true
  editingConfigIndex.value = index
  const config = difyConfigs.value[index]
  editingDifyConfig.value = { ...config }
  dialogInitialSignature.value = editingSignature.value
  isDifyConfigDialogOpen.value = true
}

const resetDifyConfigDialog = () => {
  isDifyConfigDialogOpen.value = false
  editingConfigIndex.value = -1
  editingDifyConfig.value = {
    description: '',
    apiKey: '',
    datasetId: '',
    endpoint: 'https://api.dify.ai/v1',
    enabled: true
  }
  dialogInitialSignature.value = editingSignature.value
}

// 关闭配置对话框
const closeEditDifyConfigDialog = () => {
  if (operationPending.value) return
  knowledgeOperation.clear()
  resetDifyConfigDialog()
}

const handleDialogOpenChange = (open: boolean) => {
  if (open) {
    isDifyConfigDialogOpen.value = true
  } else {
    closeEditDifyConfigDialog()
  }
}

// 保存配置
const saveDifyConfig = async () => {
  if (operationPending.value || !isEditingDifyConfigValid.value) return
  const config: DifyConfig = {
    ...editingDifyConfig.value,
    description: editingDifyConfig.value.description.trim(),
    endpoint: editingDifyConfig.value.endpoint.trim()
  }
  await knowledgeConfigs.save(
    isEditing.value ? editingConfigIndex.value : null,
    config,
    resetDifyConfigDialog
  )
}

// 移除Dify配置
const removeDifyConfig = async (index: number) => {
  if (operationPending.value) return
  await knowledgeConfigs.remove(index)
}

// 切换配置启用状态
const toggleConfigEnabled = async (index: number, enabled: boolean) => {
  if (operationPending.value) return
  await knowledgeConfigs.setEnabled(index, enabled)
}

// 切换Dify配置面板
const toggleDifyConfigPanel = () => {
  isDifyConfigPanelOpen.value = !isDifyConfigPanelOpen.value
}

// 切换Dify MCP服务器状态
const toggleDifyMcpServer = async (_value: boolean) => {
  await knowledgeConfigs.toggleServer()
}

// 监听URL查询参数，设置活动标签页
watch(
  () => route.query.subtab,
  (newSubtab) => {
    if (newSubtab === 'dify') {
      isDifyConfigPanelOpen.value = true
    }
  },
  { immediate: true }
)

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'dify-knowledge-config',
  onDiscard: closeEditDifyConfigDialog
})
const stopLeaveRiskSync = watch(
  [operationPending, dialogDirty],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)
const stopStaleFeedbackSync = watch(
  editingSignature,
  () => {
    if (
      knowledgeOperation.source.value === 'dialog' &&
      knowledgeOperation.snapshot.value.status === 'error'
    ) {
      knowledgeOperation.clear()
    }
  },
  { flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  stopStaleFeedbackSync()
  leaveGuardLease.release()
})
</script>
