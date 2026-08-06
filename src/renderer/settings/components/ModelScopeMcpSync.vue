<template>
  <div
    class="p-2 border rounded-lg bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60 shadow-sm"
  >
    <!-- 标题行 -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <Icon icon="lucide:cloud-download" class="h-4 w-4 text-primary" />
        <span class="text-sm font-semibold">{{
          t('settings.provider.modelscope.mcpSync.title')
        }}</span>
      </div>
    </div>

    <!-- 描述和控件行 -->
    <div class="space-y-2">
      <p class="text-xs text-muted-foreground">
        {{ t('settings.provider.modelscope.mcpSync.description') }}
      </p>

      <!-- 内联控件行 -->
      <div class="flex items-center gap-2 text-xs">
        <span class="text-muted-foreground whitespace-nowrap">每页</span>
        <select
          v-model="syncOptions.page_size"
          class="w-16 h-6 text-xs px-1 border rounded bg-background border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
        <span class="text-muted-foreground whitespace-nowrap">条，第</span>
        <input
          v-model.number="syncOptions.page_number"
          type="number"
          min="1"
          class="w-16 h-6 text-xs px-1 border rounded bg-background border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <span class="text-muted-foreground whitespace-nowrap">页</span>
        <DcButton
          @click="handleSync"
          :disabled="isSyncing"
          size="sm"
          class="h-6 px-2 text-xs ml-auto"
        >
          <Spinner v-if="isSyncing" class="mr-1 size-3" data-icon="inline-start" />
          <Icon v-else icon="lucide:download" class="mr-1 size-3" data-icon="inline-start" />
          {{
            isSyncing
              ? t('settings.provider.modelscope.mcpSync.syncing')
              : t('settings.provider.modelscope.mcpSync.sync')
          }}
        </DcButton>
      </div>

      <!-- 同步状态与结果 -->
      <div v-if="syncResult" class="flex items-center gap-1 text-xs">
        <DcBadge variant="success" class="text-xs h-5">
          {{ t('settings.provider.modelscope.mcpSync.imported', { count: syncResult.imported }) }}
        </DcBadge>
        <DcBadge v-if="syncResult.skipped > 0" variant="warning" class="text-xs h-5">
          {{ t('settings.provider.modelscope.mcpSync.skipped', { count: syncResult.skipped }) }}
        </DcBadge>
        <DcBadge v-if="syncResult.errors.length > 0" variant="danger" class="text-xs h-5">
          {{
            t('settings.provider.modelscope.mcpSync.errors', { count: syncResult.errors.length })
          }}
        </DcBadge>
      </div>

      <!-- 错误信息显示 -->
      <div
        v-if="errorMessage"
        class="p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive"
      >
        {{ errorMessage }}
      </div>

      <!-- 同步结果详情 -->
      <div v-if="syncResult && syncResult.errors.length > 0" class="space-y-1">
        <div class="text-xs font-medium text-destructive">
          {{ t('settings.provider.modelscope.mcpSync.errorDetails') }}
        </div>
        <div class="max-h-20 overflow-y-auto p-1 bg-muted/40 rounded text-xs">
          <div
            v-for="(error, index) in syncResult.errors"
            :key="index"
            class="text-muted-foreground py-0.5 border-b border-border/40 last:border-0"
          >
            {{ error }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { DcBadge } from '@dc-ui/components/badge'
import { Spinner } from '@shadcn/components/ui/spinner'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { useI18n } from 'vue-i18n'
import { createProviderClient } from '@api/ProviderClient'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const providerClient = createProviderClient()

const isSyncing = ref(false)
const errorMessage = ref('')
const syncResult = ref<{
  imported: number
  skipped: number
  errors: string[]
} | null>(null)

// 同步选项
const syncOptions = reactive({
  page_number: 1,
  page_size: 50
})

const handleSync = async () => {
  if (!props.provider.apiKey) {
    errorMessage.value = t('settings.provider.modelscope.mcpSync.noApiKey')
    return
  }

  isSyncing.value = true
  errorMessage.value = ''
  syncResult.value = null

  try {
    // 调用简化的同步API，所有的格式转换和导入都在服务端处理
    const result = await providerClient.syncModelScopeMcpServers(props.provider.id, syncOptions)

    syncResult.value = result

    if (result.imported > 0) {
      console.log('MCP servers imported successfully:', result)
    }
  } catch (error) {
    console.error('MCP sync error:', error)
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    isSyncing.value = false
  }
}
</script>
