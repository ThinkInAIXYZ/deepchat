<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@shadcn/components/ui/select'
import { Icon } from '@iconify/vue'
import { useNewThreadStatusBar } from '@/composables/useNewThreadStatusBar'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

const {
  isAcpAgent,
  acpAgentInfo,
  enabledModels,
  activeModel,
  modelDisplayName,
  selectModel,
  selectedEffort,
  selectEffort,
  selectedPermission,
  selectPermission
} = useNewThreadStatusBar()

const acpAgentIconId = computed(() => {
  if (!acpAgentInfo.value) return ''
  return acpAgentInfo.value.builtinId || acpAgentInfo.value.id
})

const displayModelName = computed(() => modelDisplayName.value || t('newThread.noModels'))

const getModelIcon = (model: { id: string }) => {
  const modelId = model.id.toLowerCase()
  if (modelId.includes('claude')) return 'simple-icons:anthropic'
  if (modelId.includes('gpt') || modelId.includes('o1') || modelId.includes('o3'))
    return 'simple-icons:openai'
  if (modelId.includes('gemini')) return 'simple-icons:googlegemini'
  if (modelId.includes('deepseek')) return 'simple-icons:deepseek'
  return 'lucide:bot'
}

function handleModelChange(id: string) {
  const model = enabledModels.value.find((item) => item.id === id)
  if (model) {
    void selectModel(model)
  }
}
</script>

<template>
  <div class="flex items-center gap-4 py-3 px-4 border-t border-border/50">
    <div class="flex items-center gap-2 min-w-0">
      <div
        v-if="isAcpAgent && acpAgentInfo"
        class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent/50 text-sm"
      >
        <ModelIcon :model-id="acpAgentIconId" custom-class="size-4" :is-dark="themeStore.isDark" />
        <span class="font-medium truncate max-w-[180px]">{{ acpAgentInfo.name }}</span>
      </div>

      <template v-else>
        <Select
          :model-value="activeModel.id"
          @update:model-value="(v) => handleModelChange(v as string)"
        >
          <SelectTrigger
            class="h-8 w-auto min-w-0 border-none bg-transparent hover:bg-accent/50 text-sm gap-1 px-2"
          >
            <Icon :icon="getModelIcon(activeModel)" class="size-4 text-muted-foreground" />
            <span class="truncate max-w-[120px]">{{ displayModelName }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="model in enabledModels"
              :key="model.id"
              :value="model.id"
              class="cursor-pointer"
            >
              <div class="flex items-center gap-2">
                <Icon :icon="getModelIcon(model)" class="size-4 text-muted-foreground" />
                <span>{{ model.name.split('/').pop() ?? model.name }}</span>
              </div>
            </SelectItem>
            <div v-if="enabledModels.length === 0" class="px-2 py-4 text-sm text-muted-foreground">
              {{ t('newThread.noModels') }}
            </div>
          </SelectContent>
        </Select>

        <Select
          :model-value="selectedEffort"
          @update:model-value="(v) => selectEffort(v as 'low' | 'medium' | 'high' | 'extra-high')"
        >
          <SelectTrigger
            class="h-8 w-auto min-w-0 border-none bg-transparent hover:bg-accent/50 text-sm gap-1 px-2"
          >
            <Icon icon="lucide:zap" class="size-4 text-muted-foreground" />
            <span class="capitalize">{{ selectedEffort }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low" class="cursor-pointer">Low</SelectItem>
            <SelectItem value="medium" class="cursor-pointer">Medium</SelectItem>
            <SelectItem value="high" class="cursor-pointer">High</SelectItem>
            <SelectItem value="extra-high" class="cursor-pointer">Extra High</SelectItem>
          </SelectContent>
        </Select>
      </template>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <Select
        :model-value="selectedPermission"
        @update:model-value="(v) => selectPermission(v as 'default' | 'restricted' | 'full')"
      >
        <SelectTrigger
          class="h-8 w-auto min-w-0 border-none bg-transparent hover:bg-accent/50 text-sm gap-1 px-2"
        >
          <Icon icon="lucide:shield" class="size-4 text-muted-foreground" />
          <span class="capitalize">{{ selectedPermission }}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default" class="cursor-pointer">Default</SelectItem>
          <SelectItem value="restricted" class="cursor-pointer">Restricted</SelectItem>
          <SelectItem value="full" class="cursor-pointer">Full Access</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
