<template>
  <div class="flex items-center gap-3 h-10">
    <span
      class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
      :dir="langStore.dir"
    >
      <Icon icon="lucide:bot" class="w-4 h-4 text-muted-foreground" />
      <span class="truncate">{{ t('settings.common.searchAssistantModel') }}</span>
    </span>
    <div class="ml-auto">
      <Popover v-model:open="modelSelectOpen">
        <PopoverTrigger as-child>
          <Button variant="outline" class="w-full justify-between h-8 text-sm">
            <div class="flex items-center gap-2">
              <ModelIcon
                :model-id="selectedSearchModel?.id || ''"
                class="h-4 w-4"
                :is-dark="themeStore.isDark"
              />
              <span class="truncate">
                {{ selectedSearchModel?.name || t('settings.common.selectModel') }}
              </span>
            </div>
            <Icon
              icon="lucide:chevron-down"
              class="h-4 w-4 ml-2 shrink-0 text-muted-foreground/50"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-80 p-0" align="end">
          <ModelSelect
            :type="[ModelType.Chat, ModelType.ImageGeneration]"
            @update:model="handleSearchModelSelect"
          />
        </PopoverContent>
      </Popover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { ModelType } from '@shared/model'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const langStore = useLanguageStore()

const selectedSearchModel = computed(() => settingsStore.searchAssistantModel)
const modelSelectOpen = ref(false)

const handleSearchModelSelect = (model: RENDERER_MODEL_META, providerId: string) => {
  settingsStore.setSearchAssistantModel(model, providerId)
  modelSelectOpen.value = false
}
</script>
