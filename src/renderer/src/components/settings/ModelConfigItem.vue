<template>
  <div
    :class="[
      'flex flex-row bg-muted/50 hover:bg-accent items-center gap-2 px-3 py-2 border-b last:border-none transition-colors'
    ]"
  >
    <div class="flex gap-1 items-center">
      <span class="text-xs" :class="!enabled ? 'text-foreground/70' : ''">
        {{ modelName }}
      </span>
      <Icon
        v-if="vision"
        icon="lucide:eye"
        class="w-4 h-4 text-blue-500"
        :title="t('settings.model.modelConfig.vision.label')"
      />
      <Icon
        v-if="functionCall"
        icon="lucide:function-square"
        class="w-4 h-4 text-orange-500"
        :title="t('settings.model.modelConfig.functionCall.label')"
      />
      <Icon
        v-if="reasoning"
        icon="lucide:brain"
        class="w-4 h-4 text-purple-500"
        :title="t('settings.model.modelConfig.reasoning.label')"
      />
      <Icon
        v-if="enableSearch"
        icon="lucide:book-open"
        class="w-4 h-4 text-green-500"
        :title="t('settings.model.modelConfig.enableSearch.label')"
      />
    </div>
    <div class="grow"></div>
    <div class="flex flex-row items-center gap-2">
      <span v-if="group && group !== 'default'" class="text-xs text-muted-foreground">{{
        group
      }}</span>
      <span
        class="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground border border-muted-foreground/20 select-none"
      >
        {{ type }}
      </span>
      <Switch
        v-if="!hideEnableToggle"
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
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import { Icon } from '@iconify/vue'
import { ModelType } from '@shared/model'
import ModelConfigDialog from './ModelConfigDialog.vue'

withDefaults(
  defineProps<{
    modelName: string
    modelId: string
    providerId: string
    group?: string
    enabled: boolean
    isCustomModel?: boolean
    vision?: boolean
    functionCall?: boolean
    reasoning?: boolean
    enableSearch?: boolean
    type?: ModelType
    changeable?: boolean
    hideEnableToggle?: boolean
  }>(),
  {
    type: ModelType.Chat,
    changeable: true,
    hideEnableToggle: false
  }
)

const emit = defineEmits<{
  enabledChange: [boolean]
  deleteModel: []
  configChanged: []
}>()

const { t } = useI18n()

// 配置对话框状态
const showConfigDialog = ref(false)

const onEnabledChange = (enabled: boolean) => emit('enabledChange', enabled)
const onDeleteModel = () => emit('deleteModel')
const onConfigModel = () => {
  showConfigDialog.value = true
}
const onConfigSaved = () => {
  emit('configChanged')
}
</script>
