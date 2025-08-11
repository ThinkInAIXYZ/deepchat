<template>
  <div class="p-4 border rounded-lg bg-card">
    <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <Icon icon="lucide:cloud-download" class="h-5 w-5" />
      {{ $t('settings.providers.modelscope.mcpSync.title') }}
    </h3>

    <div class="space-y-4">
      <p class="text-sm text-muted-foreground">
        {{ $t('settings.providers.modelscope.mcpSync.description') }}
      </p>

      <!-- 同步选项 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium">
            {{ $t('settings.providers.modelscope.mcpSync.pageSize') }}
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
            {{ $t('settings.providers.modelscope.mcpSync.category') }}
          </label>
          <select
            v-model="syncOptions.filter.category"
            class="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          >
            <option value="">{{ $t('common.all') }}</option>
            <option value="communication">{{ $t('settings.providers.modelscope.mcpSync.categories.communication') }}</option>
            <option value="productivity">{{ $t('settings.providers.modelscope.mcpSync.categories.productivity') }}</option>
            <option value="development">{{ $t('settings.providers.modelscope.mcpSync.categories.development') }}</option>
            <option value="data">{{ $t('settings.providers.modelscope.mcpSync.categories.data') }}</option>
          </select>
        </div>
      </div>

      <!-- 搜索框 -->
      <div>
        <label class="text-sm font-medium">
          {{ $t('settings.providers.modelscope.mcpSync.search') }}
        </label>
        <input
          v-model="syncOptions.search"
          type="text"
          class="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          :placeholder="$t('settings.providers.modelscope.mcpSync.searchPlaceholder')"
        />
      </div>

      <!-- 同步选项 -->
      <div class="flex flex-wrap gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input
            v-model="importOptions.enableByDefault"
            type="checkbox"
            class="rounded"
          />
          {{ $t('settings.providers.modelscope.mcpSync.enableByDefault') }}
        </label>

        <label class="flex items-center gap-2 text-sm">
          <input
            v-model="importOptions.overwriteExisting"
            type="checkbox"
            class="rounded"
          />
          {{ $t('settings.providers.modelscope.mcpSync.overwriteExisting') }}
        </label>
      </div>

      <!-- 同步按钮和状态 -->
      <div class="flex items-center gap-4">
        <Button
          @click="handleSync"
          :disabled="isSyncing"
          class="flex items-center gap-2"
        >
          <Icon
            v-if="isSyncing"
            icon="lucide:loader-2"
            class="h-4 w-4 animate-spin"
          />
          <Icon
            v-else
            icon="lucide:download"
            class="h-4 w-4"
          />
          {{ isSyncing ? $t('settings.providers.modelscope.mcpSync.syncing') : $t('settings.providers.modelscope.mcpSync.sync') }}
        </Button>

        <div v-if="syncResult" class="text-sm">
          <span class="text-green-600">
            {{ $t('settings.providers.modelscope.mcpSync.imported', { count: syncResult.imported }) }}
          </span>
          <span v-if="syncResult.skipped > 0" class="text-yellow-600 ml-2">
            {{ $t('settings.providers.modelscope.mcpSync.skipped', { count: syncResult.skipped }) }}
          </span>
          <span v-if="syncResult.errors.length > 0" class="text-red-600 ml-2">
            {{ $t('settings.providers.modelscope.mcpSync.errors', { count: syncResult.errors.length }) }}
          </span>
        </div>
      </div>

      <!-- 错误信息显示 -->
      <div v-if="errorMessage" class="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
        <p class="text-sm text-destructive">{{ errorMessage }}</p>
      </div>

      <!-- 同步结果详情 -->
      <div v-if="syncResult && syncResult.errors.length > 0" class="space-y-2">
        <h4 class="text-sm font-medium text-destructive">
          {{ $t('settings.providers.modelscope.mcpSync.errorDetails') }}
        </h4>
        <div class="max-h-32 overflow-y-auto p-2 bg-muted rounded-md">
          <div v-for="(error, index) in syncResult.errors" :key="index" class="text-xs text-muted-foreground">
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
const configP = usePresenter('configPresenter')

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
    category: '',
    is_hosted: true,
    tag: ''
  },
  page_number: 1,
  page_size: 50,
  search: ''
})

// 导入选项
const importOptions = reactive({
  enableByDefault: false,
  overwriteExisting: false,
  skipExisting: true
})

const handleSync = async () => {
  if (!props.provider.apiKey) {
    errorMessage.value = t('settings.providers.modelscope.mcpSync.noApiKey')
    return
  }

  isSyncing.value = true
  errorMessage.value = ''
  syncResult.value = null

  try {
    // 通过 usePresenter 调用主进程的同步功能
    const mcpServers = await (llmP as any).syncModelScopeMcpServers(
      props.provider.id,
      syncOptions
    )

    if (mcpServers && mcpServers.data && mcpServers.data.mcp_server_list) {
      // 将 ModelScope MCP 服务器转换为内部格式
      const serversToImport = mcpServers.data.mcp_server_list.map((server: any) => ({
        name: server.locales?.zh?.name || server.name,
        description: server.locales?.zh?.description || server.description,
        package: server.id,
        version: 'latest',
        type: 'npm',
        args: [],
        env: {},
        enabled: importOptions.enableByDefault,
        source: 'modelscope',
        logo_url: server.logo_url,
        publisher: server.publisher,
        tags: server.tags || [],
        view_count: server.view_count || 0
      }))

      // 批量导入 MCP 服务器
      const result = await (configP as any).batchImportMcpServers(serversToImport, {
        skipExisting: !importOptions.overwriteExisting,
        enableByDefault: importOptions.enableByDefault,
        overwriteExisting: importOptions.overwriteExisting
      })

      syncResult.value = result

      if (result.imported > 0) {
        // 触发 MCP 服务器列表更新 - 这里可能需要通过事件或其他方式通知
        // 可以考虑触发一个事件或调用相关的刷新方法
        console.log('MCP servers imported successfully')
      }
    } else {
      errorMessage.value = t('settings.providers.modelscope.mcpSync.noServersFound')
    }
  } catch (error) {
    console.error('MCP sync error:', error)
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    isSyncing.value = false
  }
}
</script>
