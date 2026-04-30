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
      <Icon
        v-if="vision"
        icon="lucide:eye"
        class="h-4 w-4 shrink-0 text-blue-500"
        title="视觉能力"
      />
      <Icon
        v-if="functionCall"
        icon="lucide:function-square"
        class="h-4 w-4 shrink-0 text-orange-500"
        title="函数调用能力"
      />
      <Icon
        v-if="showWeakAgentWarning"
        icon="lucide:triangle-alert"
        class="h-4 w-4 shrink-0 text-amber-500"
        :title="$t('settings.modelConfigItem.chatFallbackWarning')"
      />
      <Icon
        v-if="reasoning"
        icon="lucide:brain"
        class="h-4 w-4 shrink-0 text-purple-500"
        title="推理能力"
      />
      <Icon
        v-if="enableSearch"
        icon="lucide:globe"
        class="h-4 w-4 shrink-0 text-green-500"
        title="联网搜索能力"
      />
    </div>
    <div class="flex shrink-0 flex-row items-center gap-2 whitespace-nowrap">
      <span
        v-if="group && group !== 'default'"
        class="max-w-[6rem] truncate text-xs text-muted-foreground"
      >
        {{ group }}
      </span>
      <span
        class="shrink-0 rounded-full border border-muted-foreground/20 bg-muted px-2 py-0.5 text-xs text-muted-foreground select-none"
      >
        {{ type }}
      </span>
      <Switch
        v-if="!hideEnableToggle"
        :key="`${providerId}:${modelId}`"
        :model-value="enabled"
        @update:model-value="onEnabledChange"
      />
      <Button
        v-if="changeable"
        variant="link"
        size="icon"
        class="w-7 h-7 text-xs text-normal rounded-lg"
        @click="onConfigModel"
        :title="$t('settings.model.configureModel')"
      >
        <Icon icon="lucide:settings" class="w-4 h-4 text-muted-foreground" />
      </Button>
      <Button
        v-if="isCustomModel"
        variant="link"
        size="icon"
        class="w-7 h-7 text-xs text-normal rounded-lg"
        @click="onDeleteModel"
      >
        <Icon icon="lucide:trash-2" class="w-4 h-4 text-destructive" />
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
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import { Icon } from '@iconify/vue'
import { hasNativeToolCapability, ModelType, type NewApiEndpointType } from '@shared/model'
import ModelConfigDialog from './ModelConfigDialog.vue'

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
