<template>
  <div class="w-full h-full flex flex-col">
    <!-- MCP 总开关 - 卡片样式 -->
    <div class="shrink-0 px-4 pt-4">
      <div class="flex items-center justify-between">
        <div :dir="languageStore.dir" class="flex-1">
          <div class="font-medium">
            {{ t('settings.mcp.enabledTitle') }}
          </div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.mcp.enabledDescription') }}
          </p>
        </div>
        <Switch
          dir="ltr"
          :model-value="mcpEnabled"
          @update:model-value="handleMcpEnabledChange"
          class="scale-125"
        />
      </div>
      <!-- NPM 源折叠区域 -->
      <Collapsible v-model:open="npmSourceExpanded" class="mt-3">
        <CollapsibleTrigger as-child>
          <Button variant="ghost" size="sm" class="w-full text-xs h-8 px-2">
            <Icon
              :icon="npmSourceExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'"
              class="w-3 h-3 text-muted-foreground"
            />
            <span class="text-muted-foreground flex items-center gap-1">
              {{ t('settings.mcp.npmRegistry.advancedSettings') }}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent class="mt-2">
          <div class="border rounded-lg bg-card/50 p-3 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">{{ t('settings.mcp.npmRegistry.title') }}</span>
            </div>

            <!-- 当前源 -->
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{{
                t('settings.mcp.npmRegistry.currentSource')
              }}</span>
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs">{{
                  npmRegistryStatus.currentRegistry || 'Default'
                }}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="refreshing"
                  @click="refreshNpmRegistry"
                  class="h-6 w-6 p-0"
                >
                  <Icon
                    :icon="refreshing ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                    :class="['w-3 h-3', refreshing && 'animate-spin']"
                  />
                </Button>
              </div>
            </div>

            <!-- 自动检测 -->
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">{{
                t('settings.mcp.npmRegistry.autoDetect')
              }}</span>
              <Switch
                :model-value="npmRegistryStatus.autoDetectEnabled"
                @update:model-value="setAutoDetectNpmRegistry"
              />
            </div>

            <!-- 自定义源 -->
            <div class="space-y-2">
              <Dialog v-model:open="customSourceDialogOpen">
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" class="w-full h-7 text-xs">
                    <Icon icon="lucide:link" class="w-3 h-3 mr-1" />
                    {{ t('settings.mcp.npmRegistry.customSource') }}
                  </Button>
                </DialogTrigger>
                <DialogContent class="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{{ t('settings.mcp.npmRegistry.customSource') }}</DialogTitle>
                    <DialogDescription>
                      {{ t('settings.mcp.npmRegistry.customSourcePlaceholder') }}
                    </DialogDescription>
                  </DialogHeader>

                  <div class="space-y-4">
                    <Input
                      v-model="customRegistryInput"
                      :placeholder="t('settings.mcp.npmRegistry.customSourcePlaceholder')"
                      class="font-mono"
                    />
                    <div
                      v-if="npmRegistryStatus.customRegistry"
                      class="text-xs text-muted-foreground"
                    >
                      {{ t('settings.mcp.npmRegistry.currentCustom') }}:
                      {{ npmRegistryStatus.customRegistry }}
                    </div>
                    <div class="flex gap-2">
                      <Button
                        variant="outline"
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
                        @click="clearCustomNpmRegistry"
                        class="flex-1"
                      >
                        {{ t('common.clear') }}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <Separator class="mt-2" />
    </div>

    <!-- 服务器列表 -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="mcpEnabled" class="h-full">
        <McpServers />
      </div>
      <div v-else class="p-8 text-center text-muted-foreground text-sm">
        {{ t('settings.mcp.enableToAccess') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref, onMounted } from 'vue'
import McpServers from '@/components/mcp-config/components/McpServers.vue'
import { Switch } from '@shadcn/components/ui/switch'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Icon } from '@iconify/vue'
import { Separator } from '@shadcn/components/ui/separator'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import { useMcpStore } from '@/stores/mcp'
import { useLanguageStore } from '@/stores/language'
import { useToast } from '@/components/use-toast'

const { t } = useI18n()
const languageStore = useLanguageStore()
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
const npmSourceExpanded = ref(false)
const customSourceDialogOpen = ref(false)
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
      customSourceDialogOpen.value = false
    } catch (detectError) {
      console.error('Failed to re-detect optimal registry:', detectError)
      await loadNpmRegistryStatus()
      toast({
        title: t('settings.mcp.npmRegistry.redetectFailed'),
        description: t('settings.mcp.npmRegistry.redetectFailedDesc'),
        variant: 'destructive'
      })
      customSourceDialogOpen.value = false
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

onMounted(() => {
  loadNpmRegistryStatus()
})
</script>
