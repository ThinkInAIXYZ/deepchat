<template>
  <div
    class="p-3 md:p-4 border rounded-lg bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60 shadow-sm"
  >
    <h3 class="text-sm md:text-base font-semibold mb-2 flex items-center gap-2 tracking-tight">
      <Icon icon="lucide:cloud-download" class="h-5 w-5 text-primary" />
      <span>{{ t('settings.provider.modelscope.mcpSync.title') }}</span>
    </h3>

    <div class="space-y-3">
      <p
        class="text-[12px] md:text-[13px] text-muted-foreground leading-relaxed truncate"
        :title="t('settings.provider.modelscope.mcpSync.description')"
      >
        {{ t('settings.provider.modelscope.mcpSync.description') }}
      </p>

      <!-- 紧凑工具栏布局：控件与按钮同行（小屏自动换行） -->
      <div
        class="grid items-end gap-2 md:gap-3 grid-cols-1 sm:grid-cols-2 lg:[grid-template-columns:theme(spacing.40)_theme(spacing.40)_1fr_auto]"
      >
        <!-- Page Size -->
        <div class="space-y-1">
          <label class="sr-only">
            {{ t('settings.provider.modelscope.mcpSync.pageSize') }}
          </label>
          <select
            v-model="syncOptions.page_size"
            class="w-full h-8 text-xs px-2 border rounded-md bg-background/60 border-border focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            :aria-label="t('settings.provider.modelscope.mcpSync.pageSize')"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        <!-- Page Number -->
        <div class="space-y-1">
          <label class="sr-only">
            {{ t('settings.provider.modelscope.mcpSync.pageNumber') }}
          </label>
          <input
            v-model.number="syncOptions.page_number"
            type="number"
            min="1"
            class="w-full h-8 text-xs px-2 border rounded-md bg-background/60 border-border focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            :placeholder="t('settings.provider.modelscope.mcpSync.pageNumberPlaceholder')"
            :aria-label="t('settings.provider.modelscope.mcpSync.pageNumber')"
          />
        </div>

        <!-- Spacer for alignment on large screens -->
        <div class="hidden lg:block"></div>

        <!-- Action Button -->
        <div class="flex lg:justify-end">
          <Button
            @click="handleSync"
            :disabled="isSyncing"
            class="h-8 px-2.5 inline-flex items-center gap-2"
          >
            <Icon v-if="isSyncing" icon="lucide:loader-2" class="h-4 w-4 animate-spin" />
            <Icon v-else icon="lucide:download" class="h-4 w-4" />
            <span class="text-xs md:text-sm">
              {{
                isSyncing
                  ? t('settings.provider.modelscope.mcpSync.syncing')
                  : t('settings.provider.modelscope.mcpSync.sync')
              }}
            </span>
          </Button>
        </div>
      </div>

      <!-- 同步状态与结果（更紧凑） -->
      <div v-if="syncResult" class="flex flex-wrap items-center gap-1.5 md:gap-2 text-xs">
        <Badge variant="outline" class="border-green-500/30 text-green-600 bg-green-500/10">
          {{ t('settings.provider.modelscope.mcpSync.imported', { count: syncResult.imported }) }}
        </Badge>
        <Badge
          v-if="syncResult.skipped > 0"
          variant="outline"
          class="border-amber-500/30 text-amber-600 bg-amber-500/10"
        >
          {{ t('settings.provider.modelscope.mcpSync.skipped', { count: syncResult.skipped }) }}
        </Badge>
        <Badge
          v-if="syncResult.errors.length > 0"
          variant="outline"
          class="border-red-500/30 text-red-600 bg-red-500/10"
        >
          {{
            t('settings.provider.modelscope.mcpSync.errors', { count: syncResult.errors.length })
          }}
        </Badge>
      </div>

      <!-- 错误信息显示 -->
      <div
        v-if="errorMessage"
        class="p-2.5 md:p-3 bg-destructive/10 border border-destructive/20 rounded-md"
      >
        <p class="text-[12px] md:text-[13px] text-destructive">{{ errorMessage }}</p>
      </div>

      <!-- 同步结果详情 -->
      <div v-if="syncResult && syncResult.errors.length > 0" class="space-y-1.5">
        <h4 class="text-xs md:text-sm font-medium text-destructive">
          {{ t('settings.provider.modelscope.mcpSync.errorDetails') }}
        </h4>
        <div class="max-h-28 overflow-y-auto p-2 bg-muted/40 rounded-md border border-border/60">
          <div
            v-for="(error, index) in syncResult.errors"
            :key="index"
            class="text-[12px] text-muted-foreground py-1 first:pt-0 last:pb-0 border-b border-border/40 last:border-0"
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
import { Badge } from '@/components/ui/badge'
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
