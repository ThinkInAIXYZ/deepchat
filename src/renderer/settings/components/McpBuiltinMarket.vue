<template>
  <div class="w-full h-full flex flex-col">
    <div class="p-4 sticky top-0 z-10 flex items-center gap-2">
      <Button
        v-if="embedded"
        variant="ghost"
        size="sm"
        class="h-8 px-2 text-xs"
        @click="emit('back')"
      >
        <Icon icon="lucide:chevron-left" class="w-4 h-4 mr-1" />
        {{ t('common.back') }}
      </Button>

      <div class="flex flex-col">
        <div class="font-medium">{{ t('mcp.market.builtinTitle') }}</div>
        <a
          href="https://mcprouter.co/"
          target="_blank"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {{ t('mcp.market.poweredBy') }}
        </a>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <div class="flex items-center gap-2">
          <Input
            v-model="apiKeyInput"
            type="password"
            :placeholder="t('mcp.market.apiKeyPlaceholder')"
            class="w-64"
          />
          <Button size="sm" :disabled="savingApiKey" @click="saveApiKey">
            <Spinner v-if="savingApiKey" class="mr-1 size-3.5" data-icon="inline-start" />
            {{ t('common.save') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- API Key 获取提示 -->
    <div class="px-4 text-xs text-muted-foreground">
      {{ t('mcp.market.keyHelpText') }}
      <Button
        variant="link"
        size="sm"
        class="text-xs p-0 h-auto font-normal text-primary hover:underline"
        @click="openHowToGetKey"
      >
        {{ t('mcp.market.keyGuide') }}
      </Button>
      {{ t('mcp.market.keyHelpEnd') }}
      <Separator class="mt-4" />
    </div>

    <div class="flex-1 overflow-auto" ref="scrollContainer" @scroll="onScroll">
      <div
        class="p-4 grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 items-stretch"
      >
        <div
          v-for="item in items"
          :key="item.uuid"
          class="border rounded-lg p-3 bg-card hover:bg-accent/30 transition-colors flex flex-col h-full"
        >
          <div class="text-xs text-muted-foreground">{{ item.author_name }}</div>
          <div class="text-sm font-semibold mt-1 line-clamp-1" :title="item.title">
            {{ item.title }}
          </div>
          <div
            class="text-xs mt-1 text-muted-foreground line-clamp-3 min-h-0 overflow-hidden"
            :title="item.description"
          >
            {{ item.description }}
          </div>
          <div
            class="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between mt-auto"
          >
            <span
              class="text-xs font-mono px-2 py-0.5 bg-muted rounded truncate"
              :title="item.server_key"
              >{{ item.server_key }}</span
            >
            <Button
              size="sm"
              :variant="installedServers.has(item.server_key) ? 'secondary' : 'outline'"
              :disabled="
                installedServers.has(item.server_key) || installingServerKeys.has(item.server_key)
              "
              @click="install(item)"
              :title="
                installedServers.has(item.server_key)
                  ? t('mcp.market.installed')
                  : t('mcp.market.install')
              "
              class="w-full md:w-auto"
            >
              <Spinner
                v-if="installingServerKeys.has(item.server_key)"
                class="mr-1 size-3.5"
                data-icon="inline-start"
              />
              <Icon
                v-else
                :icon="installedServers.has(item.server_key) ? 'lucide:check' : 'lucide:download'"
                class="mr-1 size-3.5"
                data-icon="inline-start"
              />
              {{
                installingServerKeys.has(item.server_key)
                  ? t('common.loading')
                  : installedServers.has(item.server_key)
                    ? t('mcp.market.installed')
                    : t('mcp.market.install')
              }}
            </Button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="py-4 text-center text-xs text-muted-foreground">
        <Spinner class="mr-1 inline size-4" />
        {{ t('common.loading') }}
      </div>
      <div
        v-if="loadError && !loading"
        class="flex flex-col items-center gap-2 px-4 py-5 text-center text-xs text-muted-foreground"
        role="status"
      >
        <span>{{ t('common.error.operationFailed') }}</span>
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="fetchPage">
          <Icon icon="lucide:refresh-cw" class="mr-1 h-3.5 w-3.5" />
          {{ t('mcp.market.loadMore') }}
        </Button>
      </div>
      <div
        v-if="!hasMore && !loadError && items.length > 0"
        class="py-4 text-center text-xs text-muted-foreground"
      >
        {{ t('mcp.market.noMore') }}
      </div>
      <div
        v-if="!loading && !loadError && items.length === 0"
        class="py-8 text-center text-xs text-muted-foreground"
      >
        {{ t('mcp.market.empty') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { createMcpClient } from '@api/McpClient'
import { useToast } from '@/components/use-toast'
import { Separator } from '@shadcn/components/ui/separator'
import { Spinner } from '@shadcn/components/ui/spinner'

withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  {
    embedded: false
  }
)

const emit = defineEmits<{
  back: []
}>()

const { t } = useI18n()
const { toast } = useToast()
const mcpClient = createMcpClient()

type MarketItem = {
  uuid: string
  created_at: string
  updated_at: string
  name: string
  author_name: string
  title: string
  description: string
  content?: string
  server_key: string
  config_name?: string
  server_url?: string
}

const items = ref<MarketItem[]>([])
const page = ref(1)
const limit = ref(20)
const loading = ref(false)
const hasMore = ref(true)
const scrollContainer = ref<HTMLDivElement | null>(null)
const installedServers = ref<Set<string>>(new Set())
const installingServerKeys = ref<Set<string>>(new Set())
const loadError = ref<unknown>(null)

const apiKeyInput = ref('')
const savingApiKey = ref(false)

const loadApiKey = async () => {
  try {
    const key = await mcpClient.getMcpRouterApiKey()
    apiKeyInput.value = key || ''
  } catch {}
}

const saveApiKey = async () => {
  if (savingApiKey.value) return
  savingApiKey.value = true
  try {
    const newKey = apiKeyInput.value.trim()
    await mcpClient.setMcpRouterApiKey(newKey)

    // 更新现有 mcprouter 服务器的 Authorization header
    if (newKey) {
      await mcpClient.updateMcpRouterServersAuth(newKey)
    }

    toast({ title: t('common.saved') })
  } catch (e) {
    toast({
      title: t('common.error.operationFailed'),
      description: String(e),
      variant: 'destructive'
    })
  } finally {
    savingApiKey.value = false
  }
}

const openHowToGetKey = () => {
  window.open('https://mcprouter.co/settings/keys', '_blank')
}

const mergeInstalledServers = async (marketItems: MarketItem[]) => {
  const sourceIds = [...new Set(marketItems.map((item) => item.server_key))]
  if (sourceIds.length === 0) return

  try {
    const installedIds = await mcpClient.listInstalledServerIds('mcprouter', sourceIds)
    installedServers.value = new Set([...installedServers.value, ...installedIds])
  } catch (error) {
    console.error('Failed to check MCP Router installation status:', error)
  }
}

const fetchPage = async () => {
  if (loading.value || !hasMore.value) return
  loading.value = true
  loadError.value = null

  try {
    const data = await mcpClient.listMcpRouterServers(page.value, limit.value)
    const list = data?.servers || []
    if (list.length === 0) {
      hasMore.value = false
      return
    }
    await mergeInstalledServers(list)
    items.value.push(...list)
    page.value += 1
    hasMore.value = list.length >= limit.value
  } catch (e) {
    loadError.value = e
    toast({
      title: t('settings.provider.operationFailed'),
      description: String(e),
      variant: 'destructive'
    })
  } finally {
    loading.value = false
  }
}

const onScroll = () => {
  const el = scrollContainer.value
  if (!el || loading.value) return

  const scrollTop = el.scrollTop
  const clientHeight = el.clientHeight
  const scrollHeight = el.scrollHeight
  const nearBottom = scrollTop + clientHeight >= scrollHeight - 400

  // 正常滚动加载
  if (hasMore.value && nearBottom) {
    void fetchPage()
  }
}

const install = async (item: MarketItem) => {
  if (
    installedServers.value.has(item.server_key) ||
    installingServerKeys.value.has(item.server_key)
  ) {
    return
  }

  try {
    if (!apiKeyInput.value.trim()) {
      toast({
        title: t('mcp.market.apiKeyRequiredTitle'),
        description: t('mcp.market.apiKeyRequiredDesc'),
        variant: 'destructive'
      })
      return
    }
    installingServerKeys.value = new Set([...installingServerKeys.value, item.server_key])
    await mcpClient.setMcpRouterApiKey(apiKeyInput.value.trim())
    const ok = await mcpClient.installMcpRouterServer(item.server_key)
    if (ok) {
      toast({ title: t('mcp.market.installSuccess') })
      installedServers.value = new Set([...installedServers.value, item.server_key])
    } else {
      toast({ title: t('mcp.market.installFailed'), variant: 'destructive' })
    }
  } catch (e) {
    toast({ title: t('mcp.market.installFailed'), description: String(e), variant: 'destructive' })
  } finally {
    const nextInstalling = new Set(installingServerKeys.value)
    nextInstalling.delete(item.server_key)
    installingServerKeys.value = nextInstalling
  }
}

onMounted(async () => {
  await Promise.all([loadApiKey(), fetchPage()])
})
</script>

<style scoped></style>
