<template>
  <ProviderSettingsShell
    v-model:active-tab="activeTab"
    :title="t(provider.name)"
    :subtitle="region"
    :enabled-count="enabledModels.length"
  >
    <template #connection>
      <div class="flex flex-col gap-4">
        <!-- Auth mode selector -->
        <div class="flex flex-col items-start gap-2">
          <Label class="flex-1">{{ t('settings.provider.authMode') }}</Label>
          <RadioGroup
            :model-value="authMode"
            class="flex flex-row gap-4"
            @update:model-value="handleAuthModeChange"
          >
            <div class="flex items-center gap-1.5">
              <RadioGroupItem value="accessKeys" :id="`${provider.id}-auth-keys`" />
              <Label :for="`${provider.id}-auth-keys`" class="cursor-pointer text-sm">
                {{ t('settings.provider.authModeAccessKeys') }}
              </Label>
            </div>
            <div class="flex items-center gap-1.5">
              <RadioGroupItem value="profile" :id="`${provider.id}-auth-profile`" />
              <Label :for="`${provider.id}-auth-profile`" class="cursor-pointer text-sm">
                {{ t('settings.provider.authModeProfile') }}
              </Label>
            </div>
          </RadioGroup>
        </div>

        <!-- Access Keys mode fields -->
        <template v-if="authMode === 'accessKeys'">
          <div class="flex flex-col items-start gap-2">
            <Label :for="`${provider.id}-accessKeyId`" class="flex-1">AWS Access Key Id</Label>
            <div class="relative w-full">
              <Input
                data-testid="provider-api-key-input"
                :id="`${provider.id}-accessKeyId`"
                :model-value="accessKeyId"
                :type="showAccessKeyId ? 'text' : 'password'"
                :placeholder="t('settings.provider.accessKeyIdPlaceholder')"
                style="padding-right: 2.5rem !important"
                @blur="handleAccessKeyIdChange(String($event.target.value))"
                @keyup.enter="handleAccessKeyIdChange(accessKeyId)"
                @update:model-value="accessKeyId = String($event)"
              />
              <Button
                variant="ghost"
                size="sm"
                class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
                @click="showAccessKeyId = !showAccessKeyId"
              >
                <Icon
                  :icon="showAccessKeyId ? 'lucide:eye-off' : 'lucide:eye'"
                  class="w-4 h-4 text-muted-foreground hover:text-foreground"
                />
              </Button>
            </div>
          </div>
          <div class="flex flex-col items-start gap-2">
            <Label :for="`${provider.id}-secretAccessKey`" class="flex-1">
              AWS Secret Access Key
            </Label>
            <div class="relative w-full">
              <Input
                :id="`${provider.id}-secretAccessKey`"
                :model-value="secretAccessKey"
                :type="showSecretAccessKey ? 'text' : 'password'"
                :placeholder="t('settings.provider.secretAccessKeyPlaceholder')"
                style="padding-right: 2.5rem !important"
                @blur="handleSecretAccessKeyChange(String($event.target.value))"
                @keyup.enter="handleSecretAccessKeyChange(secretAccessKey)"
                @update:model-value="secretAccessKey = String($event)"
              />
              <Button
                variant="ghost"
                size="sm"
                class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
                @click="showSecretAccessKey = !showSecretAccessKey"
              >
                <Icon
                  :icon="showSecretAccessKey ? 'lucide:eye-off' : 'lucide:eye'"
                  class="w-4 h-4 text-muted-foreground hover:text-foreground"
                />
              </Button>
            </div>
          </div>
        </template>

        <!-- Profile mode field -->
        <template v-else>
          <div class="flex flex-col items-start gap-2">
            <Label :for="`${provider.id}-profile`" class="flex-1">
              {{ t('settings.provider.profileNameLabel') }}
            </Label>
            <Input
              :id="`${provider.id}-profile`"
              :model-value="profile"
              :placeholder="t('settings.provider.profilePlaceholder')"
              @blur="handleProfileChange(String($event.target.value))"
              @keyup.enter="handleProfileChange(profile)"
              @update:model-value="profile = String($event)"
            />
          </div>
        </template>

        <!-- Region (shared by both modes) -->
        <div class="flex flex-col items-start gap-2">
          <Label :for="`${provider.id}-region`" class="flex-1">AWS Region</Label>
          <Input
            :id="`${provider.id}-region`"
            :model-value="region"
            :placeholder="t('settings.provider.regionPlaceholder')"
            @blur="handleRegionChange(String($event.target.value))"
            @keyup.enter="handleRegionChange(region)"
            @update:model-value="region = String($event)"
          />
        </div>

        <div class="flex flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            class="text-xs text-normal rounded-lg"
            :disabled="!provider.enable"
            @click="handleVerifyCredential"
          >
            <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />{{
              t('settings.provider.verifyKey')
            }}
          </Button>
          <TooltipProvider :delayDuration="200">
            <Tooltip>
              <TooltipTrigger>
                <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t('settings.provider.bedrockVerifyTip') }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div class="text-xs leading-4 text-muted-foreground">
          {{ t('settings.provider.bedrockLimitTip') }}
        </div>
      </div>
    </template>

    <template #models>
      <ProviderModelManager
        :provider="provider"
        :enabled-models="enabledModels"
        :total-models-count="providerModels.length + customModels.length"
        :provider-models="providerModels"
        :custom-models="customModels"
        @custom-model-added="handleAddModelSaved"
        @disable-all-models="disableAllModelsConfirm"
        @model-enabled-change="handleModelEnabledChange"
        @config-changed="handleConfigChanged"
      />
    </template>

    <template #advanced>
      <ProviderRateLimitConfig :provider="provider" @config-changed="handleConfigChanged" />
    </template>

    <template #dialogs>
      <ProviderDialogContainer
        v-model:show-confirm-dialog="showConfirmDialog"
        v-model:show-check-model-dialog="showCheckModelDialog"
        v-model:show-disable-all-confirm-dialog="showDisableAllConfirmDialog"
        v-model:show-delete-provider-dialog="showDeleteProviderDialog"
        :provider="provider"
        :model-to-disable="modelToDisable"
        :check-result="checkResult"
        @confirm-disable-model="confirmDisable"
        @confirm-disable-all-models="confirmDisableAll"
        @confirm-delete-provider="() => {}"
      />
    </template>
  </ProviderSettingsShell>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AWS_BEDROCK_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'
import ProviderSettingsShell from './ProviderSettingsShell.vue'
import ProviderModelManager from './ProviderModelManager.vue'
import ProviderDialogContainer from './ProviderDialogContainer.vue'
import ProviderRateLimitConfig from './ProviderRateLimitConfig.vue'

const props = defineProps<{
  provider: AWS_BEDROCK_PROVIDER
}>()

const emit = defineEmits<{
  'provider-configured': []
  'provider-model-enabled': []
}>()

const { t } = useI18n()
const providerStore = useProviderStore()
const modelStore = useModelStore()

const authMode = ref<'accessKeys' | 'profile'>(props.provider.credential?.authMode || 'accessKeys')
const accessKeyId = ref(props.provider.credential?.accessKeyId || '')
const secretAccessKey = ref(props.provider.credential?.secretAccessKey || '')
const region = ref(props.provider.credential?.region || '')
const profile = ref(props.provider.credential?.profile || '')
const showAccessKeyId = ref(false)
const showSecretAccessKey = ref(false)
const activeTab = ref<'connection' | 'models' | 'advanced'>('connection')
const providerModels = ref<RENDERER_MODEL_META[]>([])
const customModels = computed(() => {
  const providerCustomModels = modelStore.customModels.find(
    (entry) => entry.providerId === props.provider.id
  )
  return providerCustomModels?.models || []
})
const checkResult = ref<boolean>(false)
const modelToDisable = ref<RENDERER_MODEL_META | null>(null)
const showConfirmDialog = ref(false)
const showCheckModelDialog = ref(false)
const showDisableAllConfirmDialog = ref(false)
const showDeleteProviderDialog = ref(false)

const isProviderReadyForOnboarding = (
  provider: Pick<AWS_BEDROCK_PROVIDER, 'credential' | 'enable'>
) => {
  if (!provider.enable) return false
  const credential = provider.credential
  if (!credential?.region?.trim()) return false

  if (credential.authMode === 'profile') {
    return Boolean(credential.profile?.trim())
  }
  return Boolean(credential.accessKeyId?.trim() && credential.secretAccessKey?.trim())
}

const maybeEmitProviderConfigured = (provider: AWS_BEDROCK_PROVIDER) => {
  if (isProviderReadyForOnboarding(provider)) {
    emit('provider-configured')
  }
}

const enabledModels = computed(() => {
  const enabledCustom = customModels.value.filter((m) => m.enabled)
  const enabledBuiltIn = providerModels.value.filter((m) => m.enabled)
  const uniqueModels = new Map<string, RENDERER_MODEL_META>()
  const merged = [...enabledCustom, ...enabledBuiltIn]
  merged.forEach((model) => {
    if (!uniqueModels.has(model.id)) {
      uniqueModels.set(model.id, model)
    }
  })
  return Array.from(uniqueModels.values())
})

const buildCredential = () => ({
  authMode: authMode.value,
  accessKeyId: accessKeyId.value,
  secretAccessKey: secretAccessKey.value,
  region: region.value,
  profile: profile.value
})

const initData = async () => {
  const providerData = modelStore.allProviderModels.find((p) => p.providerId === props.provider.id)
  if (providerData) {
    providerModels.value = providerData.models.sort(
      (a, b) => a.group.localeCompare(b.group) || a.providerId.localeCompare(b.providerId)
    )
  } else {
    providerModels.value = []
  }
}

watch(
  () => props.provider,
  async () => {
    authMode.value = props.provider.credential?.authMode || 'accessKeys'
    accessKeyId.value = props.provider.credential?.accessKeyId || ''
    secretAccessKey.value = props.provider.credential?.secretAccessKey || ''
    region.value = props.provider.credential?.region || ''
    profile.value = props.provider.credential?.profile || ''
    await initData()
  },
  { immediate: true }
)

watch(
  () => modelStore.allProviderModels,
  () => {
    initData()
  },
  { deep: true }
)

const handleAuthModeChange = async (value: unknown) => {
  if (value !== 'accessKeys' && value !== 'profile') return
  authMode.value = value
  const result = await providerStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: buildCredential()
  })
  maybeEmitProviderConfigured(result.updated as AWS_BEDROCK_PROVIDER)
}

const handleAccessKeyIdChange = async (value: string) => {
  accessKeyId.value = value
  const result = await providerStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: buildCredential()
  })
  maybeEmitProviderConfigured(result.updated as AWS_BEDROCK_PROVIDER)
}

const handleSecretAccessKeyChange = async (value: string) => {
  secretAccessKey.value = value
  const result = await providerStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: buildCredential()
  })
  maybeEmitProviderConfigured(result.updated as AWS_BEDROCK_PROVIDER)
}

const handleRegionChange = async (value: string) => {
  region.value = value
  const result = await providerStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: buildCredential()
  })
  maybeEmitProviderConfigured(result.updated as AWS_BEDROCK_PROVIDER)
}

const handleProfileChange = async (value: string) => {
  profile.value = value
  const result = await providerStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: buildCredential()
  })
  maybeEmitProviderConfigured(result.updated as AWS_BEDROCK_PROVIDER)
}

const validateCredential = async () => {
  if (!props.provider.enable) return
  try {
    const resp = await providerStore.checkProvider(props.provider.id)
    checkResult.value = resp.isOk
    showCheckModelDialog.value = true
    if (resp.isOk) {
      await modelStore.refreshProviderModels(props.provider.id)
    }
  } catch (error) {
    console.error('Failed to validate credential:', error)
    checkResult.value = false
    showCheckModelDialog.value = true
  }
}

const handleVerifyCredential = async () => {
  const result = await providerStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: buildCredential()
  })
  maybeEmitProviderConfigured(result.updated as AWS_BEDROCK_PROVIDER)
  await validateCredential()
}

const confirmDisable = async () => {
  if (modelToDisable.value) {
    try {
      await modelStore.updateModelStatus(props.provider.id, modelToDisable.value.id, false)
    } catch (error) {
      console.error('Failed to disable model:', error)
    }
    showConfirmDialog.value = false
    modelToDisable.value = null
  }
}

const disableModel = (model: RENDERER_MODEL_META) => {
  modelToDisable.value = model
  showConfirmDialog.value = true
}

const handleModelEnabledChange = async (
  model: RENDERER_MODEL_META,
  enabled: boolean,
  comfirm: boolean = false
) => {
  if (!enabled && comfirm) {
    disableModel(model)
  } else {
    await modelStore.updateModelStatus(props.provider.id, model.id, enabled)
    if (enabled) {
      emit('provider-model-enabled')
    }
  }
}

const disableAllModelsConfirm = () => {
  showDisableAllConfirmDialog.value = true
}

const confirmDisableAll = async () => {
  try {
    await modelStore.disableAllModels(props.provider.id)
    showDisableAllConfirmDialog.value = false
  } catch (error) {
    console.error('Failed to disable all models:', error)
  }
}

const handleConfigChanged = async () => {
  await initData()
}

const handleAddModelSaved = async () => {
  await modelStore.refreshCustomModels(props.provider.id)
  await initData()
}
</script>
