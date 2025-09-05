<template>
  <div class="flex flex-row items-center gap-2 p-2 border-b last:border-none">
    <div class="flex gap-1">
      <span class="text-xs">
        {{ modelName }}
      </span>
      <Icon v-if="vision" icon="lucide:eye" class="w-4 h-4 text-blue-500" title="视觉能力" />
      <Icon
        v-if="functionCall"
        icon="lucide:function-square"
        class="w-4 h-4 text-orange-500"
        title="函数调用能力"
      />
      <Icon v-if="reasoning" icon="lucide:brain" class="w-4 h-4 text-purple-500" title="推理能力" />
      <Icon
        v-if="enableSearch"
        icon="lucide:globe"
        class="w-4 h-4 text-green-500"
        title="联网搜索能力"
      />
    </div>
    <div class="flex-grow"></div>
    <div class="flex flex-row items-center gap-2">
      <span v-if="group" class="text-xs text-muted-foreground">{{ group }}</span>
      <span
        class="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground border border-muted-foreground/20 select-none"
      >
        {{ type }}
      </span>
      <Button
        v-if="!enabled"
        variant="link"
        size="icon"
        class="w-7 h-7 text-xs text-normal rounded-lg"
        @click="onEnabledChange(true)"
      >
        <Icon icon="lucide:circle-minus" class="w-4 h-4 text-destructive" />
      </Button>
      <Button
        v-if="enabled"
        variant="link"
        size="icon"
        class="w-7 h-7 text-xs text-normal rounded-lg"
        @click="onEnabledChange(false)"
      >
        <Icon icon="lucide:circle-check" class="w-4 h-4 text-green-500" />
      </Button>
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
    @saved="onConfigSaved"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
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
  }>(),
  {
    type: ModelType.Chat,
    changeable: true
  }
)

const emit = defineEmits<{
  enabledChange: [boolean]
  deleteModel: []
  configChanged: []
}>()

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
