<template>
  <div class="inline-flex items-center">
    <Button
      variant="outline"
      class="text-xs text-normal rounded-lg"
      @click="showAddModelDialog = true"
    >
      <slot>
        <Icon icon="lucide:plus" class="w-4 h-4 text-muted-foreground" />
        {{ t('model.actions.add') }}
      </slot>
    </Button>
    <ModelConfigDialog
      v-model:open="showAddModelDialog"
      :model-id="modelId"
      :model-name="modelName"
      :provider-id="providerId"
      :mode="mode"
      :is-custom-model="isCustomModel"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import ModelConfigDialog from '@/components/settings/ModelConfigDialog.vue'

const { t } = useI18n()
const showAddModelDialog = ref(false)

interface Props {
  modelId?: string
  modelName?: string
  providerId?: string
  mode?: 'create' | 'edit'
  isCustomModel?: boolean
}

withDefaults(defineProps<Props>(), {
  modelId: '',
  modelName: '',
  mode: 'create',
  providerId: '',
  isCustomModel: true
})

const emit = defineEmits<{
  saved: []
}>()

const handleSaved = () => {
  showAddModelDialog.value = false
  emit('saved')
}
</script>
