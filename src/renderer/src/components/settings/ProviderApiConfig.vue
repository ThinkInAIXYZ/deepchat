<template>
  <div class="flex flex-col gap-4">
    <!-- API URL 配置 -->
    <div class="flex flex-col items-start gap-2">
      <div class="flex justify-between items-center w-full">
        <Label :for="`${provider.id}-url`" class="flex-1 cursor-pointer">API URL</Label>
        <Button v-if="provider.custom" variant="destructive" size="sm" class="text-xs rounded-lg"
          @click="$emit('delete-provider')">
          <Icon icon="lucide:trash-2" class="w-4 h-4 mr-1" />{{ t('settings.provider.delete') }}
        </Button>
      </div>
      <Input :id="`${provider.id}-url`" :model-value="apiHost" :placeholder="t('settings.provider.urlPlaceholder')"
        @blur="handleApiHostChange(String($event.target.value))" @keyup.enter="handleApiHostChange(apiHost)"
        @update:model-value="apiHost = String($event)" />
      <div class="text-xs text-muted-foreground">
        {{
          t('settings.provider.urlFormat', {
            defaultUrl: providerWebsites?.defaultBaseUrl || ''
          })
        }}
      </div>
    </div>

    <!-- GitHub Copilot OAuth 登录 -->
    <GitHubCopilotOAuth v-if="provider.id === 'github-copilot'" :provider="provider" @auth-success="handleOAuthSuccess"
      @auth-error="handleOAuthError" />

    <!-- EasyChat OAuth 登录 -->
    <EasyChatOAuth v-if="provider.id === 'easychat'" :provider="provider" @auth-success="handleOAuthSuccess"
      @auth-error="handleOAuthError" />

    <!-- API Key 配置 (GitHub Copilot 和 EasyChat 时隐藏手动输入) -->
    <div v-if="!['github-copilot', 'easychat'].includes(provider.id)" class="flex flex-col items-start gap-2">
      <Label :for="`${provider.id}-apikey`" class="flex-1 cursor-pointer">API Key</Label>
      <Input :id="`${provider.id}-apikey`" :model-value="apiKey" type="password"
        :placeholder="t('settings.provider.keyPlaceholder')" @blur="handleApiKeyChange($event.target.value)"
        @keyup.enter="$emit('validate-key', apiKey)" @update:model-value="apiKey = String($event)" />
      <div class="flex flex-row gap-2">
        <Button variant="outline" size="xs" class="text-xs text-normal rounded-lg"
          @click="$emit('validate-key', apiKey)">
          <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />{{
            t('settings.provider.verifyKey')
          }}
        </Button>
        <Button v-if="!provider.custom && provider.id !== 'doubao'" variant="outline" size="xs"
          class="text-xs text-normal rounded-lg" @click="openProviderWebsite">
          <Icon icon="lucide:hand-helping" class="w-4 h-4 text-muted-foreground" />{{
            t('settings.provider.howToGet')
          }}
        </Button>
        <Button v-if="!provider.custom && provider.id === 'easychat'" variant="outline" size="xs"
          class="text-xs text-normal rounded-lg" @click="openEasyChatOAuth">
          <Icon icon="lucide:hand-helping" class="w-4 h-4 text-muted-foreground" />{{
            t('settings.provider.oauthLogin')
          }}
        </Button>
        <!-- Key Status Display -->
        <div v-if="keyStatus && (keyStatus.usage !== undefined || keyStatus.limit_remaining !== undefined)"
          class="flex items-center gap-2 text-xs text-muted-foreground">
          <div v-if="keyStatus.usage !== undefined" class="flex items-center gap-1">
            <Icon icon="lucide:activity" class="w-3 h-3" />
            <span>{{ t('settings.provider.keyStatus.usage') }}: {{ keyStatus.usage }}</span>
          </div>
          <div v-if="keyStatus.limit_remaining !== undefined" class="flex items-center gap-1">
            <Icon icon="lucide:coins" class="w-3 h-3" />
            <span>{{ t('settings.provider.keyStatus.remaining') }}: {{ keyStatus.limit_remaining }}</span>
          </div>
        </div>
      </div>
      <div v-if="!provider.custom" class="text-xs text-muted-foreground">
        {{ t('settings.provider.getKeyTip') }}
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
import EasyChatOAuth from './EasyChatOAuth.vue'
import { usePresenter } from '@/composables/usePresenter'
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

const openProviderWebsite = () => {
  const url = props.providerWebsites?.apiKey
  if (url) {
    window.open(url, '_blank')
  }
}

const openEasyChatOAuth = async () => {
  try {
    const oauthPresenter = usePresenter('oauthPresenter')
    await oauthPresenter.startEasyChatLogin(props.provider.id)
  } catch (error) {
    console.error('EasyChat OAuth 启动失败:', error)
  }
}

const handleOAuthSuccess = () => {
  emit('oauth-success')
}

const handleOAuthError = (error: string) => {
  emit('oauth-error', error)
}

const getKeyStatus = async () => {
  if (['ppio', 'openrouter', 'siliconcloud', 'silicon', 'deepseek'].includes(props.provider.id) && props.provider.apiKey) {
    try {
      keyStatus.value = await llmProviderPresenter.getKeyStatus(props.provider.id)
    } catch (error) {
      console.error('Failed to get key status:', error)
      keyStatus.value = null
    }
  }
}

onMounted(() => {
  getKeyStatus()
})
</script>
