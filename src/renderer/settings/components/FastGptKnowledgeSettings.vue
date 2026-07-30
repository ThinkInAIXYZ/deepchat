<template>
  <div class="border rounded-lg overflow-hidden">
    <div
      class="flex items-center p-4 hover:bg-accent cursor-default"
      @click="toggleFastGptConfigPanel"
    >
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
                :model-value="isFastGptMcpEnabled"
                :disabled="!mcpEnabled || operationPending"
                @click.stop
                @update:model-value="toggleFastGptMcpServer"
              />
            </TooltipTrigger>
            <TooltipContent v-if="!mcpEnabled">
              <p>{{ t('settings.mcp.enableToAccess') }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Icon
          :icon="isFastGptConfigPanelOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
          class="w-4 h-4"
        />
      </div>
    </div>

    <!-- FastGPT配置面板 -->
    <Collapsible v-model:open="isFastGptConfigPanelOpen">
      <CollapsibleContent>
        <div class="p-4 border-t space-y-4">
          <p v-if="loadError" role="alert" class="text-xs text-destructive">
            {{ loadError }}
          </p>
          <!-- 已添加的配置列表 -->
          <div v-if="fastGptConfigs.length > 0" class="space-y-3">
            <div
              v-for="(config, index) in fastGptConfigs"
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
                  @click="editFastGptConfig(index)"
                >
                  <Icon icon="lucide:edit" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  :disabled="operationPending"
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
              :disabled="operationPending"
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
    <Dialog :open="isFastGptConfigDialogOpen" @update:open="handleDialogOpenChange">
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
              :disabled="operationPending"
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
              :disabled="operationPending"
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
              :disabled="operationPending"
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
              :disabled="operationPending"
              placeholder="http://localhost:3000/api"
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
            @click="closeFastGptConfigDialog"
            >{{ t('common.cancel') }}</Button
          >
          <Button
            type="button"
            :disabled="operationPending || !isEditingFastGptConfigValid"
            @click="saveFastGptConfig"
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

const { t } = useI18n()
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

const editingFastGptConfig = ref<FastGptConfig>({
  description: '',
  apiKey: '',
  datasetId: '',
  endpoint: 'http://localhost:3000/api',
  enabled: true
})
const editingConfigIndex = ref<number>(-1)
const dialogInitialSignature = ref('')
const editingSignature = computed(() => JSON.stringify(editingFastGptConfig.value))
const dialogDirty = computed(
  () => isFastGptConfigDialogOpen.value && editingSignature.value !== dialogInitialSignature.value
)

const isFastGptConfig = (value: unknown): value is FastGptConfig => {
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

const cloneConfig = (config: FastGptConfig): FastGptConfig => ({ ...config })
const knowledgeConfigs = useExternalKnowledgeConfigs({
  serverName: 'fastGptKnowledge',
  codePrefix: 'settings.knowledgeBase.fastGpt',
  diagnosticName: 'FastGPTKnowledge',
  isConfig: isFastGptConfig,
  clone: cloneConfig
})
const fastGptConfigs = knowledgeConfigs.configs
const loadError = knowledgeConfigs.loadError
const knowledgeOperation = knowledgeConfigs.operation
const operationPending = knowledgeConfigs.pending
const isFastGptMcpEnabled = knowledgeConfigs.serverEnabled
const mcpEnabled = knowledgeConfigs.globalEnabled

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
  if (operationPending.value) return
  isEditing.value = false
  editingConfigIndex.value = -1
  editingFastGptConfig.value = {
    description: '',
    apiKey: '',
    datasetId: '',
    endpoint: 'http://localhost:3000/api',
    enabled: true
  }
  dialogInitialSignature.value = editingSignature.value
  isFastGptConfigDialogOpen.value = true
}

defineExpose({
  openAddConfig
})

// 打开编辑配置对话框
const editFastGptConfig = (index: number) => {
  if (operationPending.value) return
  isEditing.value = true
  editingConfigIndex.value = index
  const config = fastGptConfigs.value[index]
  editingFastGptConfig.value = { ...config }
  dialogInitialSignature.value = editingSignature.value
  isFastGptConfigDialogOpen.value = true
}

const resetFastGptConfigDialog = () => {
  isFastGptConfigDialogOpen.value = false
  editingConfigIndex.value = -1
  editingFastGptConfig.value = {
    description: '',
    apiKey: '',
    datasetId: '',
    endpoint: 'http://localhost:3000/api',
    enabled: true
  }
  dialogInitialSignature.value = editingSignature.value
}

// 关闭配置对话框
const closeFastGptConfigDialog = () => {
  if (operationPending.value) return
  knowledgeOperation.clear()
  resetFastGptConfigDialog()
}

const handleDialogOpenChange = (open: boolean) => {
  if (open) {
    isFastGptConfigDialogOpen.value = true
  } else {
    closeFastGptConfigDialog()
  }
}

// 保存配置
const saveFastGptConfig = async () => {
  if (operationPending.value || !isEditingFastGptConfigValid.value) return
  const config: FastGptConfig = {
    ...editingFastGptConfig.value,
    description: editingFastGptConfig.value.description.trim(),
    endpoint: editingFastGptConfig.value.endpoint.trim()
  }
  await knowledgeConfigs.save(
    isEditing.value ? editingConfigIndex.value : null,
    config,
    resetFastGptConfigDialog
  )
}

// 移除FastGPT配置
const removeFastGptConfig = async (index: number) => {
  if (operationPending.value) return
  await knowledgeConfigs.remove(index)
}

// 切换配置启用状态
const toggleConfigEnabled = async (index: number, enabled: boolean) => {
  if (operationPending.value) return
  await knowledgeConfigs.setEnabled(index, enabled)
}

// 切换FastGPT配置面板
const toggleFastGptConfigPanel = () => {
  isFastGptConfigPanelOpen.value = !isFastGptConfigPanelOpen.value
}

// 切换FastGPT MCP服务器状态
const toggleFastGptMcpServer = async () => {
  await knowledgeConfigs.toggleServer()
}

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

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'fastgpt-knowledge-config',
  onDiscard: closeFastGptConfigDialog
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
