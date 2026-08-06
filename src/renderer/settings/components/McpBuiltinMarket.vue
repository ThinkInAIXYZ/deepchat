<template>
  <div class="w-full h-full flex flex-col">
    <div class="p-4 sticky top-0 z-10 flex items-center gap-2">
      <DcButton
        v-if="embedded"
        variant="ghost"
        size="sm"
        class="h-8 px-2 text-xs"
        :disabled="marketMutationInProgress"
        @click="emit('back')"
      >
        <Icon icon="lucide:chevron-left" class="w-4 h-4 mr-1" />
        {{ t('common.back') }}
      </DcButton>

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
            ref="apiKeyInputRef"
            v-model="apiKeyInput"
            type="password"
            :placeholder="t('mcp.market.apiKeyPlaceholder')"
            class="w-64"
            :disabled="apiKeyLoading || Boolean(apiKeyLoadError) || marketMutationInProgress"
            :aria-invalid="Boolean(apiKeyLoadError || apiKeyRequirementError)"
            @update:model-value="handleApiKeyInputUpdate"
          />
          <DcSubmitButton
            size="sm"
            :status="saveApiKeyStatus"
            :disabled="apiKeyLoading || Boolean(apiKeyLoadError) || marketMutationInProgress"
            @click="saveApiKey"
          >
            {{ t('common.save') }}
          </DcSubmitButton>
        </div>
      </div>
    </div>

    <!-- API Key 获取提示 -->
    <div class="px-4 text-xs text-muted-foreground">
      {{ t('mcp.market.keyHelpText') }}
      <DcButton
        variant="link"
        size="sm"
        class="text-xs p-0 h-auto font-normal text-primary hover:underline"
        @click="openHowToGetKey"
      >
        {{ t('mcp.market.keyGuide') }}
      </DcButton>
      {{ t('mcp.market.keyHelpEnd') }}
      <div
        v-if="apiKeyLoadError"
        role="alert"
        class="mt-2 flex items-center justify-between gap-3 text-destructive"
      >
        <span>{{ apiKeyLoadError }}</span>
        <DcButton variant="outline" size="sm" class="h-7" @click="loadApiKey">
          {{ t('common.retry') }}
        </DcButton>
      </div>
      <DcInlineError
        v-else-if="apiKeyRequirementError"
        :error="apiKeyRequirementError"
        class="mt-2"
      />
      <DcInlineError v-if="apiKeySaveError" :error="apiKeySaveError" class="mt-2" />
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
            <DcButton
              size="sm"
              :variant="installedServers.has(item.server_key) ? 'secondary' : 'outline'"
              :disabled="
                apiKeyLoading ||
                Boolean(apiKeyLoadError) ||
                marketMutationInProgress ||
                installedServers.has(item.server_key) ||
                installingServerKeys.has(item.server_key)
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
            </DcButton>
          </div>
          <DcInlineError
            v-if="installErrors[item.server_key]"
            :error="installErrors[item.server_key]"
            class="mt-2"
          />
        </div>
      </div>

      <div v-if="loading" class="py-4 text-center text-xs text-muted-foreground">
        <Spinner class="mr-1 inline size-4" />
        {{ t('common.loading') }}
      </div>
      <div
        v-if="loadError && !loading"
        class="flex flex-col items-center gap-2 px-4 py-5 text-center text-xs text-muted-foreground"
        role="alert"
      >
        <span>{{ t('common.error.operationFailed') }}</span>
        <DcButton variant="outline" size="sm" class="h-7 text-xs" @click="fetchPage">
          <Icon icon="lucide:refresh-cw" class="mr-1 h-3.5 w-3.5" />
          {{ t('common.retry') }}
        </DcButton>
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
import { computed, ref, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import { createMcpClient } from '@api/McpClient'
import { Separator } from '@shadcn/components/ui/separator'
import { Spinner } from '@shadcn/components/ui/spinner'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcSubmitButton, useDcFormSubmit } from '@dc-ui/components/form'

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
const installErrors = ref<Record<string, string>>({})
const loadError = ref<unknown>(null)

const apiKeyInput = ref('')
const apiKeyInputRef = ref<{ $el?: HTMLInputElement } | HTMLInputElement | null>(null)
const apiKeyLoading = ref(false)
const apiKeyLoadError = ref<string | null>(null)
const apiKeyRequirementError = ref<string | null>(null)
const apiKeySaveError = ref<string | null>(null)
const { status: saveApiKeyStatus, run: runSaveApiKey } = useDcFormSubmit()
const savingApiKey = computed(() => saveApiKeyStatus.value === 'submitting')
const installInProgress = computed(() => installingServerKeys.value.size > 0)
const marketMutationInProgress = computed(() => savingApiKey.value || installInProgress.value)

const loadApiKey = async () => {
  if (apiKeyLoading.value) return
  apiKeyLoading.value = true
  apiKeyLoadError.value = null
  try {
    const key = await mcpClient.getMcpRouterApiKey()
    apiKeyInput.value = key || ''
  } catch (error) {
    console.error('[McpBuiltinMarket] Failed to load API key:', error)
    apiKeyLoadError.value = t('common.error.requestFailed')
  } finally {
    apiKeyLoading.value = false
  }
}

const synchronizeApiKey = async (apiKey: string) => {
  await mcpClient.setMcpRouterApiKey(apiKey.trim())
}

const saveApiKey = async () => {
  if (apiKeyLoading.value || apiKeyLoadError.value || marketMutationInProgress.value) return
  apiKeySaveError.value = null
  try {
    await runSaveApiKey(async () => {
      await synchronizeApiKey(apiKeyInput.value)
    })
  } catch (error) {
    console.error('[McpBuiltinMarket] Failed to save API key:', error)
    apiKeySaveError.value = t('common.error.requestFailed')
  }
}

const handleApiKeyInputUpdate = () => {
  apiKeyRequirementError.value = null
  apiKeySaveError.value = null
}

const openHowToGetKey = () => {
  window.open('https://mcprouter.co/settings/keys', '_blank')
}

const mergeInstalledServers = async (marketItems: MarketItem[]) => {
  const sourceIds = [...new Set(marketItems.map((item) => item.server_key))]
  if (sourceIds.length === 0) return

  const installedIds = await mcpClient.listInstalledServerIds('mcprouter', sourceIds)
  installedServers.value = new Set([...installedServers.value, ...installedIds])
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
    console.error('[McpBuiltinMarket] Failed to load market page:', e)
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
    marketMutationInProgress.value ||
    installedServers.value.has(item.server_key) ||
    installingServerKeys.value.has(item.server_key)
  ) {
    return
  }

  try {
    if (!apiKeyInput.value.trim()) {
      apiKeyRequirementError.value = t('mcp.market.apiKeyRequiredDesc')
      const inputElement =
        apiKeyInputRef.value instanceof HTMLInputElement
          ? apiKeyInputRef.value
          : apiKeyInputRef.value?.$el
      inputElement?.focus()
      return
    }
    const nextErrors = { ...installErrors.value }
    delete nextErrors[item.server_key]
    installErrors.value = nextErrors
    installingServerKeys.value = new Set([...installingServerKeys.value, item.server_key])
    await synchronizeApiKey(apiKeyInput.value)
    const ok = await mcpClient.installMcpRouterServer(item.server_key)
    if (ok) {
      installedServers.value = new Set([...installedServers.value, item.server_key])
    } else {
      installErrors.value = {
        ...installErrors.value,
        [item.server_key]: t('mcp.market.installFailed')
      }
    }
  } catch (error) {
    console.error('[McpBuiltinMarket] Failed to install server:', item.server_key, error)
    installErrors.value = {
      ...installErrors.value,
      [item.server_key]: t('mcp.market.installFailed')
    }
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
