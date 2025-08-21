<template>
  <section class="w-full h-full">
    <ScrollArea class="w-full h-full p-2 flex flex-col gap-2">
      <div class="flex flex-col gap-4 p-2">
        <div class="flex flex-col items-start gap-2">
          <Label :for="`${provider.id}-accessKeyId`" class="flex-1 cursor-pointer"
            >AWS Access Key Id</Label
          >
          <div class="relative w-full">
            <Input
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
          <Label :for="`${provider.id}-secretAccessKey`" class="flex-1 cursor-pointer"
            >AWS Secret Access Key</Label
          >
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
        <div class="flex flex-col items-start gap-2">
          <Label :for="`${provider.id}-region`" class="flex-1 cursor-pointer">AWS Region</Label>
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
            size="xs"
            class="text-xs text-normal rounded-lg"
            @click="
              handleVerifyCredential({ credential: { accessKeyId, secretAccessKey, region } })
            "
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

        <div class="hint">{{ t('settings.provider.bedrockLimitTip') }}</div>

        <!-- 模型管理 -->
        <ProviderModelManager
          :provider="provider"
          :enabled-models="enabledModels"
          :total-models-count="providerModels.length"
          @show-model-list-dialog="showModelListDialog = true"
          @disable-all-models="disableAllModelsConfirm"
          @model-enabled-change="handleModelEnabledChange"
          @config-changed="handleConfigChanged"
        />
      </div>
    </ScrollArea>

    <!-- 对话框容器 -->
    <ProviderDialogContainer
      v-model:show-confirm-dialog="showConfirmDialog"
      v-model:show-model-list-dialog="showModelListDialog"
      v-model:show-check-model-dialog="showCheckModelDialog"
      v-model:show-disable-all-confirm-dialog="showDisableAllConfirmDialog"
      v-model:show-delete-provider-dialog="showDeleteProviderDialog"
      :provider="provider"
      :provider-models="providerModels"
      :custom-models="[]"
      :model-to-disable="modelToDisable"
      :check-result="checkResult"
      @confirm-disable-model="confirmDisable"
      @model-enabled-change="handleModelEnabledChange"
      @confirm-disable-all-models="confirmDisableAll"
      @confirm-delete-provider="() => {}"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AWS_BEDROCK_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'
import { useSettingsStore } from '@/stores/settings'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Icon } from '@iconify/vue'
import ProviderModelManager from './ProviderModelManager.vue'
import ProviderDialogContainer from './ProviderDialogContainer.vue'

const props = defineProps<{
  provider: AWS_BEDROCK_PROVIDER
}>()

// const emit = defineEmits<{
//   'credential-change': [value: AwsBedrockCredential]
//   'validate-key': [value: AwsBedrockCredential]
// }>()

const { t } = useI18n()
const settingsStore = useSettingsStore()

const accessKeyId = ref(props.provider.credential?.accessKeyId || '')
const secretAccessKey = ref(props.provider.credential?.secretAccessKey || '')
const region = ref(props.provider.credential?.region || '')
const showAccessKeyId = ref(false)
const showSecretAccessKey = ref(false)
const providerModels = ref<RENDERER_MODEL_META[]>([])
const checkResult = ref<boolean>(false)
const modelToDisable = ref<RENDERER_MODEL_META | null>(null)
const showConfirmDialog = ref(false)
const showCheckModelDialog = ref(false)
const showModelListDialog = ref(false)
const showDisableAllConfirmDialog = ref(false)
const showDeleteProviderDialog = ref(false)

const enabledModels = computed(() => {
  const enabledModelsList = providerModels.value.filter((m) => m.enabled)

  return enabledModelsList
})

const initData = async () => {
  console.log('initData for provider:', props.provider.id)
  const providerData = settingsStore.allProviderModels.find(
    (p) => p.providerId === props.provider.id
  )

  if (providerData) {
    providerModels.value = providerData.models.sort(
      (a, b) => a.group.localeCompare(b.group) || a.providerId.localeCompare(b.providerId)
    )
  } else {
    providerModels.value = [] // Reset if provider data not found
  }

  // Fetch Credential if applicable
  // no need
}

watch(
  () => props.provider,
  async () => {
    accessKeyId.value = props.provider.credential?.accessKeyId || ''
    secretAccessKey.value = props.provider.credential?.secretAccessKey || ''
    region.value = props.provider.credential?.region || ''
    await initData() // Ensure initData completes
  },
  { immediate: true } // Removed deep: true as provider object itself changes
)

watch(
  () => settingsStore.allProviderModels,
  () => {
    initData()
  },
  { deep: true }
)

const handleAccessKeyIdChange = (value: string) => {
  settingsStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: {
      accessKeyId: value,
      secretAccessKey: secretAccessKey.value,
      region: region.value
    }
  })
}

const handleSecretAccessKeyChange = (value: string) => {
  settingsStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: {
      accessKeyId: accessKeyId.value,
      secretAccessKey: value,
      region: region.value
    }
  })
}

const handleRegionChange = (value: string) => {
  settingsStore.updateAwsBedrockProviderConfig(props.provider.id, {
    credential: {
      accessKeyId: accessKeyId.value,
      secretAccessKey: secretAccessKey.value,
      region: value || undefined
    }
  })
}

const validateCredential = async () => {
  try {
    const resp = await settingsStore.checkProvider(props.provider.id)
    if (resp.isOk) {
      console.log('验证成功')
      checkResult.value = true
      showCheckModelDialog.value = true
      // 验证成功后刷新当前provider的模型列表
      await settingsStore.refreshProviderModels(props.provider.id)
    } else {
      console.log('验证失败', resp.errorMsg)
      checkResult.value = false
      showCheckModelDialog.value = true
    }
  } catch (error) {
    console.error('Failed to validate credential:', error)
    checkResult.value = false
    showCheckModelDialog.value = true
  }
}

const handleVerifyCredential = async (updates: Partial<AWS_BEDROCK_PROVIDER>) => {
  await settingsStore.updateAwsBedrockProviderConfig(props.provider.id, updates)
  await validateCredential()
}

const confirmDisable = async () => {
  if (modelToDisable.value) {
    try {
      await settingsStore.updateModelStatus(props.provider.id, modelToDisable.value.id, false)
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
    await settingsStore.updateModelStatus(props.provider.id, model.id, enabled)
  }
}

const disableAllModelsConfirm = () => {
  showDisableAllConfirmDialog.value = true
}

const confirmDisableAll = async () => {
  try {
    await settingsStore.disableAllModels(props.provider.id)
    showDisableAllConfirmDialog.value = false
  } catch (error) {
    console.error('Failed to disable all models:', error)
  }
}

// Handler for config changes
const handleConfigChanged = async () => {
  // 模型配置变更后重新初始化数据
  await initData()
}
</script>

<style scoped>
.hint {
  @apply text-xs text-red-700 dark:text-red-400;
}
</style>
