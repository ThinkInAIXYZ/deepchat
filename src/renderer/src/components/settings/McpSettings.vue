<template>
  <div class="w-full h-full flex flex-col">
    <!-- 固定部分 -->
    <div class="flex-shrink-0 bg-background sticky top-0 z-10">
      <!-- NPM源配置区域 -->
      <div class="border-b bg-card">
        <div class="p-4">
          <h4 class="text-sm font-medium mb-3">{{ t('settings.mcp.npmRegistry.title') }}</h4>
          <div class="space-y-3">
            <!-- 当前源状态 -->
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground"
                >{{ t('settings.mcp.npmRegistry.currentSource') }}:</span
              >
              <div class="flex items-center gap-2">
                <span class="font-mono">{{ npmRegistryStatus.currentRegistry || 'Default' }}</span>
                <Badge v-if="npmRegistryStatus.isFromCache" variant="secondary" class="text-xs">
                  {{ t('settings.mcp.npmRegistry.cached') }}
                </Badge>
              </div>
            </div>

            <!-- 上次检测时间 -->
            <div
              v-if="npmRegistryStatus.lastChecked"
              class="flex items-center justify-between text-xs"
            >
              <span class="text-muted-foreground"
                >{{ t('settings.mcp.npmRegistry.lastChecked') }}:</span
              >
              <span>{{ formatLastChecked(npmRegistryStatus.lastChecked) }}</span>
            </div>

            <!-- 控制按钮 -->
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="refreshing"
                @click="refreshNpmRegistry"
                class="text-xs h-7"
              >
                <Icon
                  :icon="refreshing ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                  :class="['w-3 h-3 mr-1', refreshing && 'animate-spin']"
                />
                {{ t('settings.mcp.npmRegistry.refresh') }}
              </Button>

              <!-- 高级设置弹窗 -->
              <Dialog v-model:open="advancedDialogOpen">
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" class="text-xs h-7">
                    <Icon icon="lucide:settings" class="w-3 h-3 mr-1" />
                    {{ t('settings.mcp.npmRegistry.advanced') }}
                  </Button>
                </DialogTrigger>
                <DialogContent class="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{{ t('settings.mcp.npmRegistry.advancedSettings') }}</DialogTitle>
                    <DialogDescription>
                      {{ t('settings.mcp.npmRegistry.advancedSettingsDesc') }}
                    </DialogDescription>
                  </DialogHeader>

                  <div class="space-y-4">
                    <!-- 自动检测开关 -->
                    <div class="flex items-center justify-between">
                      <div class="space-y-1">
                        <div class="text-sm font-medium">
                          {{ t('settings.mcp.npmRegistry.autoDetect') }}
                        </div>
                        <div class="text-xs text-muted-foreground">
                          {{ t('settings.mcp.npmRegistry.autoDetectDesc') }}
                        </div>
                      </div>
                      <Switch
                        :checked="npmRegistryStatus.autoDetectEnabled"
                        @update:checked="setAutoDetectNpmRegistry"
                      />
                    </div>

                    <!-- 自定义源输入 -->
                    <div class="space-y-2">
                      <label class="text-sm font-medium">{{
                        t('settings.mcp.npmRegistry.customSource')
                      }}</label>
                      <div class="space-y-2">
                        <Input
                          v-model="customRegistryInput"
                          :placeholder="t('settings.mcp.npmRegistry.customSourcePlaceholder')"
                          class="font-mono"
                        />
                        <div class="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            @click="saveCustomNpmRegistry"
                            :disabled="
                              !customRegistryInput.trim() ||
                              customRegistryInput.trim() === npmRegistryStatus.customRegistry
                            "
                            class="flex-1"
                          >
                            {{ t('common.save') }}
                          </Button>
                          <Button
                            v-if="npmRegistryStatus.customRegistry"
                            variant="outline"
                            size="sm"
                            @click="clearCustomNpmRegistry"
                            class="flex-1"
                          >
                            {{ t('common.clear') }}
                          </Button>
                        </div>
                        <div
                          v-if="npmRegistryStatus.customRegistry"
                          class="text-xs text-muted-foreground"
                        >
                          {{ t('settings.mcp.npmRegistry.currentCustom') }}:
                          {{ npmRegistryStatus.customRegistry }}
                        </div>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>

      <!-- MCP全局开关 -->
      <div class="p-4 flex-shrink-0">
        <div class="flex items-center justify-between">
          <div :dir="languageStore.dir">
            <h3 class="text-sm font-medium">{{ t('settings.mcp.enabledTitle') }}</h3>
            <p class="text-xs text-muted-foreground mt-1">
              {{ t('settings.mcp.enabledDescription') }}
            </p>
          </div>
          <Switch dir="ltr" :checked="mcpEnabled" @update:checked="handleMcpEnabledChange" />
        </div>
      </div>

      <!-- MCP Marketplace 入口 -->
      <div class="px-4 pb-4 flex-shrink-0">
        <div class="flex gap-2">
          <Button
            v-if="false"
            variant="outline"
            class="flex-1 flex items-center justify-center gap-2"
            @click="openMcpMarketplace"
          >
            <Icon icon="lucide:shopping-bag" class="w-4 h-4" />
            <span>{{ t('settings.mcp.marketplace') }}</span>
            <Icon icon="lucide:external-link" class="w-3.5 h-3.5 text-muted-foreground" />
          </Button>

          <!-- Higress MCP Marketplace 入口 -->
          <Button
            variant="outline"
            class="flex-1 flex items-center justify-center gap-2"
            @click="openHigressMcpMarketplace"
          >
            <img src="@/assets/mcp-icons/higress.avif" class="w-4 h-4" />
            <span>{{ $t('settings.mcp.higressMarket') }}</span>
            <Icon icon="lucide:external-link" class="w-3.5 h-3.5 text-muted-foreground" />
          </Button>

          <Button
            variant="outline"
            class="flex-1 flex items-center justify-center gap-2"
            @click="openBuiltinMarket"
          >
            <Icon icon="lucide:gallery-vertical-end" class="w-4 h-4" />
            <span>{{ t('mcp.market.browseBuiltin') }}</span>
            <Icon icon="lucide:arrow-right" class="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
    </div>

    <!-- 可滚动部分 -->
    <!-- MCP配置 -->
    <div class="flex-grow overflow-y-auto">
      <div v-if="mcpEnabled" class="border-t h-full">
        <McpServers />
      </div>
      <div v-else class="p-4 text-center text-muted-foreground text-sm">
        {{ t('settings.mcp.enableToAccess') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref, onMounted } from 'vue'
import McpServers from '@/components/mcp-config/components/McpServers.vue'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Icon } from '@iconify/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { useMcpStore } from '@/stores/mcp'
import { useLanguageStore } from '@/stores/language'
import { useToast } from '@/components/ui/toast'
import { MCP_MARKETPLACE_URL, HIGRESS_MCP_MARKETPLACE_URL } from '../mcp-config/const'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const languageStore = useLanguageStore()
const router = useRouter()
const mcpStore = useMcpStore()
const { toast } = useToast()

// 计算属性
const mcpEnabled = computed(() => mcpStore.mcpEnabled)

// NPM Registry 相关状态
const npmRegistryStatus = ref<{
  currentRegistry: string | null
  isFromCache: boolean
  lastChecked?: number
  autoDetectEnabled: boolean
  customRegistry?: string
}>({
  currentRegistry: null,
  isFromCache: false,
  lastChecked: undefined,
  autoDetectEnabled: true,
  customRegistry: undefined
})

const refreshing = ref(false)
const customRegistryInput = ref('')
const advancedDialogOpen = ref(false)

// 处理MCP开关状态变化
const handleMcpEnabledChange = async (enabled: boolean) => {
  await mcpStore.setMcpEnabled(enabled)
}

// NPM Registry 相关方法
const loadNpmRegistryStatus = async () => {
  try {
    const status = await mcpStore.getNpmRegistryStatus()
    npmRegistryStatus.value = status
    customRegistryInput.value = status.customRegistry || ''
  } catch (error) {
    console.error('Failed to load npm registry status:', error)
  }
}

const refreshNpmRegistry = async () => {
  try {
    refreshing.value = true
    await mcpStore.refreshNpmRegistry()
    await loadNpmRegistryStatus()
    toast({
      title: t('settings.mcp.npmRegistry.refreshSuccess'),
      description: t('settings.mcp.npmRegistry.refreshSuccessDesc')
    })
  } catch (error) {
    console.error('Failed to refresh npm registry:', error)
    toast({
      title: t('settings.mcp.npmRegistry.refreshFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    refreshing.value = false
  }
}

const setAutoDetectNpmRegistry = async (enabled: boolean) => {
  try {
    await mcpStore.setAutoDetectNpmRegistry(enabled)
    await loadNpmRegistryStatus()
    toast({
      title: t('settings.mcp.npmRegistry.autoDetectUpdated'),
      description: enabled
        ? t('settings.mcp.npmRegistry.autoDetectEnabled')
        : t('settings.mcp.npmRegistry.autoDetectDisabled')
    })
  } catch (error) {
    console.error('Failed to set auto detect npm registry:', error)
    toast({
      title: t('settings.mcp.npmRegistry.updateFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const normalizeNpmRegistryUrl = (registry: string): string => {
  let normalized = registry.trim()
  if (!normalized.endsWith('/')) {
    normalized += '/'
  }
  return normalized
}

// 验证自定义NPM源是否可用
const validateCustomRegistry = async (registry: string): Promise<boolean> => {
  try {
    if (!registry.startsWith('http://') && !registry.startsWith('https://')) {
      toast({
        title: t('settings.mcp.npmRegistry.invalidUrl'),
        description: t('settings.mcp.npmRegistry.invalidUrlDesc'),
        variant: 'destructive'
      })
      return false
    }
    const normalizedRegistry = normalizeNpmRegistryUrl(registry)
    const testPackage = 'tiny-runtime-injector'
    const testUrl = `${normalizedRegistry}${testPackage}`
    toast({
      title: t('settings.mcp.npmRegistry.testing'),
      description: t('settings.mcp.npmRegistry.testingDesc', { registry: normalizedRegistry })
    })
    const response = await fetch(testUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return true
  } catch (error) {
    console.error('Custom registry validation failed:', error)
    toast({
      title: t('settings.mcp.npmRegistry.testFailed'),
      description: t('settings.mcp.npmRegistry.testFailedDesc', {
        registry: normalizeNpmRegistryUrl(registry),
        error: error instanceof Error ? error.message : String(error)
      }),
      variant: 'destructive'
    })
    return false
  }
}

const saveCustomNpmRegistry = async () => {
  try {
    const registry = customRegistryInput.value.trim()
    if (!registry) {
      return
    }
    const isValid = await validateCustomRegistry(registry)
    if (!isValid) {
      return
    }
    await mcpStore.setCustomNpmRegistry(registry)
    await loadNpmRegistryStatus()
    const normalizedRegistry = npmRegistryStatus.value.customRegistry
    if (normalizedRegistry) {
      customRegistryInput.value = normalizedRegistry
    }
    toast({
      title: t('settings.mcp.npmRegistry.customSourceSet'),
      description: t('settings.mcp.npmRegistry.customSourceSetDesc', {
        registry: normalizedRegistry || registry
      })
    })
  } catch (error) {
    console.error('Failed to save custom npm registry:', error)
    toast({
      title: t('settings.mcp.npmRegistry.updateFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const clearCustomNpmRegistry = async () => {
  try {
    await mcpStore.setCustomNpmRegistry(undefined)
    customRegistryInput.value = ''
    await mcpStore.clearNpmRegistryCache()
    toast({
      title: t('settings.mcp.npmRegistry.customSourceCleared'),
      description: t('settings.mcp.npmRegistry.redetectingOptimal')
    })
    try {
      await mcpStore.refreshNpmRegistry()
      await loadNpmRegistryStatus()
      toast({
        title: t('settings.mcp.npmRegistry.redetectComplete'),
        description: t('settings.mcp.npmRegistry.redetectCompleteDesc')
      })
      advancedDialogOpen.value = false
    } catch (detectError) {
      console.error('Failed to re-detect optimal registry:', detectError)
      await loadNpmRegistryStatus()
      toast({
        title: t('settings.mcp.npmRegistry.redetectFailed'),
        description: t('settings.mcp.npmRegistry.redetectFailedDesc'),
        variant: 'destructive'
      })
      advancedDialogOpen.value = false
    }
  } catch (error) {
    console.error('Failed to clear custom npm registry:', error)
    toast({
      title: t('settings.mcp.npmRegistry.updateFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const formatLastChecked = (timestamp: number) => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (minutes < 1) {
    return t('settings.mcp.npmRegistry.justNow')
  } else if (minutes < 60) {
    return t('settings.mcp.npmRegistry.minutesAgo', { minutes })
  } else if (hours < 24) {
    return t('settings.mcp.npmRegistry.hoursAgo', { hours })
  } else {
    return t('settings.mcp.npmRegistry.daysAgo', { days })
  }
}

onMounted(() => {
  loadNpmRegistryStatus()
})

// 打开MCP Marketplace
const openMcpMarketplace = () => {
  window.open(MCP_MARKETPLACE_URL, '_blank')
}

// 打开Higress MCP Marketplace
const openHigressMcpMarketplace = () => {
  window.open(HIGRESS_MCP_MARKETPLACE_URL, '_blank')
}

// 打开内置 MCP 市场
const openBuiltinMarket = () => {
  router.push('/settings/mcp-market')
}
</script>
