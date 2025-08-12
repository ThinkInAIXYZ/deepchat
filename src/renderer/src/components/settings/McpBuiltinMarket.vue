<template>
  <div class="w-full h-full flex flex-col">
    <div class="p-4 border-b bg-card sticky top-0 z-10 flex items-center gap-2">
      <Icon icon="lucide:shopping-bag" class="w-4 h-4" />
      <h3 class="text-sm font-medium">{{ t('mcp.market.builtinTitle') }}</h3>
      <a
        href="https://mcprouter.co/"
        target="_blank"
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {{ t('mcp.market.poweredBy') }}
      </a>
      <div class="ml-auto flex items-center gap-2">
        <div class="flex items-center gap-2">
          <Input
            v-model="apiKeyInput"
            type="password"
            :placeholder="t('mcp.market.apiKeyPlaceholder')"
            class="w-64"
          />
          <Button size="sm" @click="saveApiKey">{{ t('common.save') }}</Button>
        </div>
      </div>
    </div>

    <!-- API Key 获取提示 -->
    <div class="px-4 py-2 bg-muted/30 border-b text-xs text-muted-foreground">
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
    </div>

    <div class="flex-1 overflow-auto" ref="scrollContainer" @scroll="onScroll">
      <div
        class="p-4 grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      >
        <div
          v-for="item in items"
          :key="item.uuid"
          class="border rounded-lg p-3 bg-card hover:bg-accent/30 transition-colors flex flex-col"
        >
          <div class="text-xs text-muted-foreground">{{ item.author_name }}</div>
          <div class="text-sm font-semibold mt-1 line-clamp-1" :title="item.title">
            {{ item.title }}
          </div>
          <div class="text-xs mt-1 text-muted-foreground line-clamp-3" :title="item.description">
            {{ item.description }}
          </div>
          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs font-mono px-2 py-0.5 bg-muted rounded">{{
              item.server_key
            }}</span>
            <Button size="sm" @click="install(item)">
              <Icon icon="lucide:download" class="w-3.5 h-3.5 mr-1" />
              {{ t('mcp.market.install') }}
            </Button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="py-4 text-center text-xs text-muted-foreground">
        <Icon icon="lucide:loader-2" class="inline w-4 h-4 animate-spin mr-1" />
        {{ t('common.loading') }}
      </div>
      <div
        v-if="showPullToLoad && !loading"
        class="py-4 text-center text-xs text-muted-foreground"
      >
        {{ t('mcp.market.pullDownToLoad') }}
      </div>
      <div
        v-if="!hasMore && !showPullToLoad && items.length > 0"
        class="py-4 text-center text-xs text-muted-foreground"
      >
        {{ t('mcp.market.noMore') }}
      </div>
      <div
        v-if="!loading && items.length === 0"
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/ui/toast'

const { t } = useI18n()
const { toast } = useToast()
const mcpP = usePresenter('mcpPresenter')

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
const showPullToLoad = ref(false)
const canPullMore = ref(false)

const apiKeyInput = ref('')

const loadApiKey = async () => {
  try {
    const key = await mcpP.getMcpRouterApiKey?.()
    apiKeyInput.value = key || ''
  } catch {}
}

const saveApiKey = async () => {
  try {
    await mcpP.setMcpRouterApiKey?.(apiKeyInput.value.trim())
    toast({ title: t('common.saved') })
  } catch (e) {
    toast({ title: t('common.error'), description: String(e), variant: 'destructive' })
  }
}

const openHowToGetKey = () => {
  window.open('https://mcprouter.co/settings/keys', '_blank')
}

const fetchPage = async (forcePull = false) => {
  if (loading.value || (!hasMore.value && !forcePull)) return
  loading.value = true
  showPullToLoad.value = false

  try {
    const data = await mcpP.listMcpRouterServers?.(page.value, limit.value)
    const list = data?.servers || []
    if (list.length === 0) {
      hasMore.value = false
      canPullMore.value = false
      return
    }
    items.value.push(...list)
    page.value += 1

    // 如果是强制拉取且成功获取到数据，重新启用拉取功能
    if (forcePull) {
      hasMore.value = true
      canPullMore.value = true
    }
  } catch (e) {
    toast({
      title: t('settings.provider.operationFailed'),
      description: String(e),
      variant: 'destructive'
    })
    // 错误时重置状态
    if (forcePull) {
      canPullMore.value = false
    }
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
    fetchPage()
    return
  }

  // 检测过度滚动（内容不足一屏或已滚动到底部且没有更多内容）
  if (!hasMore.value) {
    const atBottom = scrollTop + clientHeight >= scrollHeight - 50
    const overScroll = scrollTop + clientHeight > scrollHeight
    const contentTooShort = scrollHeight <= clientHeight

    // 启用强制拉取模式
    if ((atBottom || overScroll || contentTooShort) && !canPullMore.value) {
      canPullMore.value = true
      showPullToLoad.value = true
    }

    // 检测强制拉取触发条件
    if (canPullMore.value && (overScroll || (contentTooShort && scrollTop > 0))) {
      fetchPage(true)
    }
  }
}

const install = async (item: MarketItem) => {
  try {
    if (!apiKeyInput.value.trim()) {
      toast({
        title: t('mcp.market.apiKeyRequiredTitle'),
        description: t('mcp.market.apiKeyRequiredDesc'),
        variant: 'destructive'
      })
      return
    }
    await mcpP.setMcpRouterApiKey?.(apiKeyInput.value.trim())
    const ok = await mcpP.installMcpRouterServer?.(item.server_key)
    if (ok) {
      toast({ title: t('mcp.market.installSuccess') })
    } else {
      toast({ title: t('mcp.market.installFailed'), variant: 'destructive' })
    }
  } catch (e) {
    toast({ title: t('mcp.market.installFailed'), description: String(e), variant: 'destructive' })
  }
}

onMounted(async () => {
  await loadApiKey()
  await fetchPage()

  // 初始加载后检查是否需要启用强制拉取模式
  setTimeout(() => {
    const el = scrollContainer.value
    if (el && !hasMore.value) {
      const contentTooShort = el.scrollHeight <= el.clientHeight
      if (contentTooShort && items.value.length > 0) {
        canPullMore.value = true
        showPullToLoad.value = true
      }
    }
  }, 100)
})
</script>

<style scoped></style>
