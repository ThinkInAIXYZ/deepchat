<template>
  <div class="p-4 border rounded-lg bg-card">
    <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <Icon icon="lucide:cloud-download" class="h-5 w-5" />
      {{ t('settings.provider.modelscope.mcpSync.title') }}
    </h3>

    <div class="space-y-4">
      <p class="text-sm text-muted-foreground">
        {{ t('settings.provider.modelscope.mcpSync.description') }}
      </p>

      <!-- 同步选项 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium">
            {{ t('settings.provider.modelscope.mcpSync.pageSize') }}
          </label>
          <select
            v-model="syncOptions.page_size"
            class="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        <div>
          <label class="text-sm font-medium">
            {{ t('settings.provider.modelscope.mcpSync.pageNumber') }}
          </label>
          <input
            v-model.number="syncOptions.page_number"
            type="number"
            min="1"
            class="w-full mt-1 px-3 py-2 border rounded-md bg-background"
            :placeholder="t('settings.provider.modelscope.mcpSync.pageNumberPlaceholder')"
          />
        </div>
      </div>

      <!-- 额外选项 -->
      <div class="flex flex-wrap gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="syncOptions.filter.is_hosted" type="checkbox" class="rounded" />
          {{ t('settings.provider.modelscope.mcpSync.onlyHosted') }}
        </label>
      </div>

      <!-- 同步按钮和状态 -->
      <div class="flex items-center gap-4">
        <Button @click="handleSync" :disabled="isSyncing" class="flex items-center gap-2">
          <Icon v-if="isSyncing" icon="lucide:loader-2" class="h-4 w-4 animate-spin" />
          <Icon v-else icon="lucide:download" class="h-4 w-4" />
          {{
            isSyncing
              ? t('settings.provider.modelscope.mcpSync.syncing')
              : t('settings.provider.modelscope.mcpSync.sync')
          }}
        </Button>

        <div v-if="syncResult" class="text-sm">
          <span class="text-green-600">
            {{ t('settings.provider.modelscope.mcpSync.imported', { count: syncResult.imported }) }}
          </span>
          <span v-if="syncResult.skipped > 0" class="text-yellow-600 ml-2">
            {{ t('settings.provider.modelscope.mcpSync.skipped', { count: syncResult.skipped }) }}
          </span>
          <span v-if="syncResult.errors.length > 0" class="text-red-600 ml-2">
            {{
              t('settings.provider.modelscope.mcpSync.errors', { count: syncResult.errors.length })
            }}
          </span>
        </div>
      </div>

      <!-- 错误信息显示 -->
      <div
        v-if="errorMessage"
        class="p-3 bg-destructive/10 border border-destructive/20 rounded-md"
      >
        <p class="text-sm text-destructive">{{ errorMessage }}</p>
      </div>

      <!-- 同步结果详情 -->
      <div v-if="syncResult && syncResult.errors.length > 0" class="space-y-2">
        <h4 class="text-sm font-medium text-destructive">
          {{ t('settings.provider.modelscope.mcpSync.errorDetails') }}
        </h4>
        <div class="max-h-32 overflow-y-auto p-2 bg-muted rounded-md">
          <div
            v-for="(error, index) in syncResult.errors"
            :key="index"
            class="text-xs text-muted-foreground"
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
import { Button } from '@/components/ui/button'
import type { LLM_PROVIDER } from '@shared/presenter'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const llmP = usePresenter('llmproviderPresenter')

const isSyncing = ref(false)
const errorMessage = ref('')
const syncResult = ref<{
  imported: number
  skipped: number
  errors: string[]
} | null>(null)

// 同步选项
const syncOptions = reactive({
  filter: {
    is_hosted: true
  },
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
    const result = await llmP.syncModelScopeMcpServers(props.provider.id, syncOptions)

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
