<template>
  <div
    :class="[
      'flex h-12 min-h-12 flex-row items-center gap-2 overflow-hidden bg-muted/50 px-2.5 py-1.5 transition-colors hover:bg-accent border-b last:border-none'
    ]"
  >
    <div class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      <span class="truncate text-xs" :class="!enabled ? 'text-foreground/70' : ''">
        {{ modelName }}
      </span>
      <Tooltip v-if="vision">
        <TooltipTrigger as-child>
          <span class="inline-flex shrink-0">
            <Icon icon="lucide:eye" class="size-4 text-blue-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.modelConfigItem.capability.vision') }}</TooltipContent>
      </Tooltip>
      <Tooltip v-if="functionCall">
        <TooltipTrigger as-child>
          <span class="inline-flex shrink-0">
            <Icon icon="lucide:function-square" class="size-4 text-orange-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {{ t('settings.modelConfigItem.capability.functionCall') }}
        </TooltipContent>
      </Tooltip>
      <Tooltip v-if="showWeakAgentWarning">
        <TooltipTrigger as-child>
          <span class="inline-flex shrink-0">
            <Icon icon="lucide:triangle-alert" class="size-4 text-amber-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.modelConfigItem.chatFallbackWarning') }}</TooltipContent>
      </Tooltip>
      <Tooltip v-if="reasoning">
        <TooltipTrigger as-child>
          <span class="inline-flex shrink-0">
            <Icon icon="lucide:brain" class="size-4 text-purple-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.modelConfigItem.capability.reasoning') }}</TooltipContent>
      </Tooltip>
      <Tooltip v-if="enableSearch">
        <TooltipTrigger as-child>
          <span class="inline-flex shrink-0">
            <Icon icon="lucide:globe" class="size-4 text-green-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.modelConfigItem.capability.search') }}</TooltipContent>
      </Tooltip>
    </div>
    <div class="flex shrink-0 flex-row items-center gap-2 whitespace-nowrap">
      <span
        v-if="group && group !== 'default'"
        class="max-w-[6rem] truncate text-xs text-muted-foreground"
      >
        {{ group }}
      </span>
      <Badge variant="outline" class="shrink-0 select-none text-xs text-muted-foreground">
        {{ type }}
      </Badge>
      <Switch
        v-if="!hideEnableToggle"
        :key="`${providerId}:${modelId}`"
        :data-testid="`provider-model-toggle-${providerId}-${modelId}`"
        :model-value="enabled"
        @update:model-value="onEnabledChange"
      />
      <Tooltip v-if="changeable">
        <TooltipTrigger as-child>
          <Button
            variant="link"
            size="icon"
            class="h-7 w-7 rounded-lg text-xs"
            @click="onConfigModel"
          >
            <Icon icon="lucide:settings" class="size-4 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.model.configureModel') }}</TooltipContent>
      </Tooltip>
      <Button
        v-if="isCustomModel"
        variant="link"
        size="icon"
        class="h-7 w-7 rounded-lg text-xs"
        @click="onDeleteModel"
      >
        <Icon icon="lucide:trash-2" class="size-4 text-destructive" />
      </Button>
    </div>
  </div>

  <!-- 模型配置对话框 -->
  <ModelConfigDialog
    v-if="showConfigDialog"
    v-model:open="showConfigDialog"
    :model-id="modelId"
    :model-name="modelName"
    :provider-id="providerId"
    mode="edit"
    :is-custom-model="isCustomModel"
    @saved="onConfigSaved"
  />
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'
import { hasNativeToolCapability, ModelType, type NewApiEndpointType } from '@shared/model'
import ModelConfigDialog from './ModelConfigDialog.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    modelName: string
    modelId: string
    providerId: string
    group?: string
    enabled: boolean
    isCustomModel?: boolean
    vision?: boolean
    functionCall?: boolean
    explicitFunctionCall?: boolean
    reasoning?: boolean
    enableSearch?: boolean
    type?: ModelType
    supportedEndpointTypes?: NewApiEndpointType[]
    endpointType?: NewApiEndpointType
    changeable?: boolean
    hideEnableToggle?: boolean
  }>(),
  {
    type: ModelType.Chat,
    changeable: true,
    hideEnableToggle: false
  }
)

const {
  modelName,
  modelId,
  providerId,
  group,
  enabled,
  isCustomModel,
  vision,
  functionCall,
  reasoning,
  enableSearch,
  type,
  changeable,
  hideEnableToggle
} = toRefs(props)

const emit = defineEmits<{
  enabledChange: [boolean]
  deleteModel: []
  configChanged: []
}>()

// 配置对话框状态
const showConfigDialog = ref(false)
const showWeakAgentWarning = computed(
  () =>
    type.value === ModelType.Chat &&
    !hasNativeToolCapability(
      {
        endpointType: props.endpointType,
        supportedEndpointTypes: props.supportedEndpointTypes
      },
      props.explicitFunctionCall
    )
)

const onEnabledChange = (enabled: boolean) => emit('enabledChange', enabled)
const onDeleteModel = () => emit('deleteModel')
const onConfigModel = () => {
  showConfigDialog.value = true
}
const onConfigSaved = () => {
  emit('configChanged')
}
</script>
