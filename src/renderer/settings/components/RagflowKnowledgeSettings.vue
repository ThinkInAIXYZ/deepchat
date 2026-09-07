<template>
  <div class="border rounded-lg overflow-hidden">
    <div
      class="flex items-center p-4 hover:bg-accent cursor-default"
      @click="toggleRagflowConfigPanel"
    >
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
            <TooltipTrigger>
              <Switch
                :model-value="isRagflowMcpEnabled"
                :disabled="!mcpEnabled || operationPending"
                @click.stop
                @update:model-value="toggleRagflowMcpServer"
              />
            </TooltipTrigger>
            <TooltipContent v-if="!mcpEnabled">
              <p>{{ t('settings.mcp.enableToAccess') }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Icon
          :icon="isRagflowConfigPanelOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
          class="w-4 h-4"
        />
      </div>
    </div>

    <!-- RAGFlow配置面板 -->
    <Collapsible v-model:open="isRagflowConfigPanelOpen">
      <CollapsibleContent>
        <div class="p-4 border-t space-y-4">
          <DcInlineError v-if="loadError" :error="loadError" />
          <!-- 已添加的配置列表 -->
          <div v-if="ragflowConfigs.length > 0" class="space-y-3">
            <div
              v-for="(config, index) in ragflowConfigs"
              :key="index"
              class="p-3 border rounded-md relative"
            >
              <div class="absolute top-2 right-2 flex gap-2">
                <Switch
                  :model-value="config.enabled === true"
                  :disabled="operationPending"
                  size="sm"
                  @update:model-value="toggleConfigEnabled(index, $event)"
                />
                <button
                  type="button"
                  :disabled="operationPending"
                  class="text-muted-foreground hover:text-primary"
                  @click="editRagflowConfig(index)"
                >
                  <Icon icon="lucide:edit" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  :disabled="operationPending"
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
            <DcButton
              type="button"
              :disabled="operationPending"
              size="sm"
              class="w-full flex items-center justify-center gap-2"
              variant="outline"
              @click="openAddConfig"
            >
              <Icon icon="lucide:plus" class="w-8 h-4" />
              {{ t('settings.knowledgeBase.addRagflowConfig') }}
            </DcButton>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>

    <!-- RAGFlow配置对话框 -->
    <Dialog :open="isRagflowConfigDialogOpen" @update:open="handleDialogOpenChange">
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
              :disabled="operationPending"
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
              :disabled="operationPending"
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
              :disabled="operationPending"
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
              :disabled="operationPending"
              placeholder="http://localhost"
            />
          </div>
        </div>
        <DialogFooter>
          <DcFormActions
            :submit-status="saveStatus"
            :submit-disabled="operationPending || !isEditingRagflowConfigValid"
            :cancel-disabled="operationPending"
            :submit-label="isEditing ? t('common.confirm') : t('settings.knowledgeBase.addConfig')"
            @cancel="closeRagflowConfigDialog"
            @submit="saveRagflowConfig"
          />
        </DialogFooter>
        <DcInlineError v-if="operationError" :error="operationError" class="mt-2" />
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
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
import { DcInlineError } from '@dc-ui/components/inline-error'
import { useDcFormSubmit } from '@dc-ui/components/form'
import { DcFormActions } from '@dc-ui/components/form-actions'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { useRoute } from 'vue-router'
import { useExternalKnowledgeConfigs } from '../lib/useExternalKnowledgeConfigs'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const { t } = useI18n()
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

const editingRagflowConfig = ref<EditingRagflowConfig>({
  description: '',
  apiKey: '',
  datasetIdsStr: '',
  endpoint: 'http://localhost',
  enabled: true
})
const editingConfigIndex = ref<number>(-1)
const dialogInitialSignature = ref('')
const editingSignature = computed(() => JSON.stringify(editingRagflowConfig.value))
const dialogDirty = computed(
  () => isRagflowConfigDialogOpen.value && editingSignature.value !== dialogInitialSignature.value
)

const isRagflowConfig = (value: unknown): value is RagflowConfig => {
  if (typeof value !== 'object' || value === null) return false
  const config = value as Record<string, unknown>
  return (
    typeof config.description === 'string' &&
    typeof config.apiKey === 'string' &&
    Array.isArray(config.datasetIds) &&
    config.datasetIds.every((datasetId) => typeof datasetId === 'string') &&
    typeof config.endpoint === 'string' &&
    (config.enabled === undefined || typeof config.enabled === 'boolean')
  )
}

const cloneConfig = (config: RagflowConfig): RagflowConfig => ({
  ...config,
  datasetIds: [...config.datasetIds]
})
const knowledgeConfigs = useExternalKnowledgeConfigs({
  serverName: 'ragflowKnowledge',
  codePrefix: 'settings.knowledgeBase.ragflow',
  diagnosticName: 'RAGFlowKnowledge',
  isConfig: isRagflowConfig,
  clone: cloneConfig
})
const ragflowConfigs = knowledgeConfigs.configs
const loadError = knowledgeConfigs.loadError
const knowledgeOperation = knowledgeConfigs.operation
const operationPending = knowledgeConfigs.pending
const isRagflowMcpEnabled = knowledgeConfigs.serverEnabled
const mcpEnabled = knowledgeConfigs.globalEnabled

const operationError = ref<string | null>(null)
const { status: saveStatus, run: runSave } = useDcFormSubmit()

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
  if (operationPending.value) return
  isEditing.value = false
  editingConfigIndex.value = -1
  editingRagflowConfig.value = {
    description: '',
    apiKey: '',
    datasetIdsStr: '',
    endpoint: 'http://localhost',
    enabled: true
  }
  dialogInitialSignature.value = editingSignature.value
  isRagflowConfigDialogOpen.value = true
}

defineExpose({
  openAddConfig
})

// 打开编辑配置对话框
const editRagflowConfig = (index: number) => {
  if (operationPending.value) return
  isEditing.value = true
  editingConfigIndex.value = index
  const config = ragflowConfigs.value[index]
  editingRagflowConfig.value = {
    ...config,
    datasetIdsStr: config.datasetIds.join(',')
  }
  dialogInitialSignature.value = editingSignature.value
  isRagflowConfigDialogOpen.value = true
}

const resetRagflowConfigDialog = () => {
  isRagflowConfigDialogOpen.value = false
  editingConfigIndex.value = -1
  editingRagflowConfig.value = {
    description: '',
    apiKey: '',
    datasetIdsStr: '',
    endpoint: 'http://localhost',
    enabled: true
  }
  operationError.value = null
  dialogInitialSignature.value = editingSignature.value
}

// 关闭配置对话框
const closeRagflowConfigDialog = () => {
  if (operationPending.value) return
  resetRagflowConfigDialog()
}

const handleDialogOpenChange = (open: boolean) => {
  if (open) {
    isRagflowConfigDialogOpen.value = true
  } else {
    closeRagflowConfigDialog()
  }
}

// 保存配置
const saveRagflowConfig = async () => {
  if (operationPending.value || !isEditingRagflowConfigValid.value) return
  operationError.value = null

  const datasetIds = editingRagflowConfig.value.datasetIdsStr
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')

  const config: RagflowConfig = {
    description: editingRagflowConfig.value.description.trim(),
    apiKey: editingRagflowConfig.value.apiKey,
    datasetIds,
    endpoint: editingRagflowConfig.value.endpoint.trim(),
    enabled: editingRagflowConfig.value.enabled
  }

  try {
    await runSave(async () => {
      const saved = await knowledgeConfigs.save(
        isEditing.value ? editingConfigIndex.value : null,
        config,
        resetRagflowConfigDialog
      )
      if (!saved) {
        throw new Error('save configuration rejected')
      }
    })
  } catch (error) {
    console.error('[RagflowKnowledgeSettings] save configuration failed', error)
    operationError.value =
      knowledgeOperation.lastError.value?.title ?? t('common.error.operationFailed')
  }
}

// 移除RAGFlow配置
const removeRagflowConfig = async (index: number) => {
  if (operationPending.value) return
  await knowledgeConfigs.remove(index)
}

// 切换配置启用状态
const toggleConfigEnabled = async (index: number, enabled: boolean) => {
  if (operationPending.value) return
  await knowledgeConfigs.setEnabled(index, enabled)
}

// 切换RAGFlow配置面板
const toggleRagflowConfigPanel = () => {
  isRagflowConfigPanelOpen.value = !isRagflowConfigPanelOpen.value
}

// 切换RAGFlow MCP服务器状态
const toggleRagflowMcpServer = async () => {
  await knowledgeConfigs.toggleServer()
}

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

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'ragflow-knowledge-config',
  onDiscard: closeRagflowConfigDialog
})
const stopLeaveRiskSync = watch(
  [operationPending, dialogDirty],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
