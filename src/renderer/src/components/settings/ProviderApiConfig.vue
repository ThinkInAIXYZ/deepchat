<template>
  <div class="flex flex-col gap-4">
    <!-- API URL 配置 -->
    <div class="flex flex-col items-start gap-2">
      <div class="flex justify-between items-center w-full">
        <Label :for="`${provider.id}-url`" class="flex-1 cursor-pointer">API URL</Label>
        <Button
          v-if="provider.custom"
          variant="destructive"
          size="sm"
          class="text-xs rounded-lg"
          @click="$emit('delete-provider')"
        >
          <Icon icon="lucide:trash-2" class="w-4 h-4 mr-1" />{{ t('settings.provider.delete') }}
        </Button>
      </div>
      <Input
        :id="`${provider.id}-url`"
        :model-value="apiHost"
        :placeholder="t('settings.provider.urlPlaceholder')"
        @blur="handleApiHostChange(String($event.target.value))"
        @keyup.enter="handleApiHostChange(apiHost)"
        @update:model-value="apiHost = String($event)"
      />
      <div class="text-xs text-muted-foreground">
        {{
          t('settings.provider.urlFormat', {
            defaultUrl: providerWebsites?.defaultBaseUrl || ''
          })
        }}
      </div>
    </div>

    <!-- GitHub Copilot OAuth 登录 -->
    <GitHubCopilotOAuth
      v-if="provider.id === 'github-copilot'"
      :provider="provider"
      @auth-success="handleOAuthSuccess"
      @auth-error="handleOAuthError"
    />

    <!-- API Key 配置 (GitHub Copilot 时隐藏手动输入) -->
    <div v-if="provider.id !== 'github-copilot'" class="flex flex-col items-start gap-2">
      <Label :for="`${provider.id}-apikey`" class="flex-1 cursor-pointer">API Key</Label>
      <div class="relative w-full">
        <Input
          :id="`${provider.id}-apikey`"
          :model-value="apiKey"
          :type="showApiKey ? 'text' : 'password'"
          :placeholder="t('settings.provider.keyPlaceholder')"
          style="padding-right: 2.5rem !important"
          @blur="handleApiKeyChange($event.target.value)"
          @keyup.enter="$emit('validate-key', apiKey)"
          @update:model-value="apiKey = String($event)"
        />
        <Button
          variant="ghost"
          size="sm"
          class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
          @click="showApiKey = !showApiKey"
        >
          <Icon
            :icon="showApiKey ? 'lucide:eye-off' : 'lucide:eye'"
            class="w-4 h-4 text-muted-foreground hover:text-foreground"
          />
        </Button>
      </div>
      <div class="flex flex-row gap-2">
        <Button
          variant="outline"
          size="xs"
          class="text-xs text-normal rounded-lg"
          @click="openModelCheckDialog"
        >
          <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />{{
            t('settings.provider.verifyKey')
          }}
        </Button>
        <Button
          v-if="!provider.custom && provider.id !== 'doubao'"
          variant="outline"
          size="xs"
          class="text-xs text-normal rounded-lg"
          :disabled="isRefreshing"
          @click="refreshModels"
        >
          <Icon
            :icon="isRefreshing ? 'lucide:loader-2' : 'lucide:refresh-cw'"
            :class="['w-4 h-4 text-muted-foreground', { 'animate-spin': isRefreshing }]"
          />
          {{
            isRefreshing
              ? t('settings.provider.refreshingModels')
              : t('settings.provider.refreshModels')
          }}
        </Button>
        <!-- Key Status Display -->
        <div
          v-if="
            keyStatus && (keyStatus.usage !== undefined || keyStatus.limit_remaining !== undefined)
          "
          class="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <div v-if="keyStatus.usage !== undefined" class="flex items-center gap-1">
            <Icon icon="lucide:activity" class="w-3 h-3" />
            <span>{{ t('settings.provider.keyStatus.usage') }}: {{ keyStatus.usage }}</span>
          </div>
          <div v-if="keyStatus.limit_remaining !== undefined" class="flex items-center gap-1">
            <Icon icon="lucide:coins" class="w-3 h-3" />
            <span
              >{{ t('settings.provider.keyStatus.remaining') }}:
              {{ keyStatus.limit_remaining }}</span
            >
          </div>
        </div>
      </div>
      <div v-if="!provider.custom" class="text-xs text-muted-foreground">
        {{ t('settings.provider.howToGet') }}: {{ t('settings.provider.getKeyTip') }}
        <a :href="providerWebsites?.apiKey" target="_blank" class="text-primary">{{
          provider.name
        }}</a>
        {{ t('settings.provider.getKeyTipEnd') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import GitHubCopilotOAuth from './GitHubCopilotOAuth.vue'
import { usePresenter } from '@/composables/usePresenter'
import { useModelCheckStore } from '@/stores/modelCheck'
import type { LLM_PROVIDER, KeyStatus } from '@shared/presenter'

interface ProviderWebsites {
  official: string
  apiKey: string
  docs: string
  models: string
  defaultBaseUrl: string
}

const { t } = useI18n()
const llmProviderPresenter = usePresenter('llmproviderPresenter')
const modelCheckStore = useModelCheckStore()

const props = defineProps<{
  provider: LLM_PROVIDER
  providerWebsites?: ProviderWebsites
}>()

const emit = defineEmits<{
  'api-host-change': [value: string]
  'api-key-change': [value: string]
  'validate-key': [value: string]
  'delete-provider': []
  'oauth-success': []
  'oauth-error': [error: string]
}>()

const apiKey = ref(props.provider.apiKey || '')
const apiHost = ref(props.provider.baseUrl || '')
const keyStatus = ref<KeyStatus | null>(null)
const isRefreshing = ref(false)
const showApiKey = ref(false)

watch(
  () => props.provider,
  () => {
    apiKey.value = props.provider.apiKey || ''
    apiHost.value = props.provider.baseUrl || ''
  },
  { immediate: true }
)

const handleApiKeyChange = (value: string) => {
  emit('api-key-change', value)
}

const handleApiHostChange = (value: string) => {
  emit('api-host-change', value)
}

const handleOAuthSuccess = () => {
  emit('oauth-success')
}

const handleOAuthError = (error: string) => {
  emit('oauth-error', error)
}

const openModelCheckDialog = () => {
  modelCheckStore.openDialog(props.provider.id)
}

const getKeyStatus = async () => {
  if (
    ['ppio', 'openrouter', 'siliconcloud', 'silicon', 'deepseek', '302ai'].includes(
      props.provider.id
    ) &&
    props.provider.apiKey
  ) {
    try {
      keyStatus.value = await llmProviderPresenter.getKeyStatus(props.provider.id)
    } catch (error) {
      console.error('Failed to get key status:', error)
      keyStatus.value = null
    }
  }
}

const refreshModels = async () => {
  if (isRefreshing.value) return

  isRefreshing.value = true
  try {
    await llmProviderPresenter.refreshModels(props.provider.id)
  } catch (error) {
    console.error('Failed to refresh models:', error)
  } finally {
    isRefreshing.value = false
  }
}

onMounted(() => {
  getKeyStatus()
})
</script>
