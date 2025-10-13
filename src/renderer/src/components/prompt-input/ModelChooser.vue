<template>
  <Card
    class="w-full border-border/60 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80"
    :dir="langStore.dir"
  >
    <CardContent class="flex flex-col gap-4 p-4">
      <Input
        v-model="keyword"
        :placeholder="t('model.search.placeholder')"
        class="h-9 w-full text-sm"
      />
      <ScrollArea class="h-72 pr-2">
        <div class="flex flex-col gap-5">
          <div v-for="provider in filteredProviders" :key="provider.id" class="flex flex-col gap-2">
            <Badge
              variant="outline"
              class="w-fit uppercase tracking-[0.18em] text-[10px] font-semibold text-muted-foreground"
            >
              {{ provider.name }}
            </Badge>
            <div class="flex flex-col gap-1.5" role="listbox" aria-orientation="vertical">
              <Button
                v-for="model in provider.models"
                :key="`${provider.id}-${model.id}`"
                type="button"
                variant="outline"
                class="group w-full justify-start gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition data-[selected=true]:border-primary data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground/90 dark:data-[selected=true]:bg-primary/15"
                role="option"
                :aria-selected="isSelected(provider.id, model.id)"
                :data-selected="isSelected(provider.id, model.id)"
                @click="handleModelSelect(provider.id, model)"
              >
                <div
                  class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground transition group-data-[selected=true]:border-primary group-data-[selected=true]:bg-primary/20 group-data-[selected=true]:text-primary"
                >
                  <ModelIcon
                    class="h-4 w-4 shrink-0 opacity-80 transition group-hover:opacity-100 group-data-[selected=true]:opacity-100"
                    :model-id="provider.id"
                    :is-dark="themeStore.isDark"
                  />
                </div>
                <span class="flex-1 truncate">
                  {{ model.name }}
                </span>
                <Icon
                  v-if="isSelected(provider.id, model.id)"
                  icon="lucide:check"
                  class="h-4 w-4 shrink-0 text-primary dark:text-primary/80"
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, ref, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Card, CardContent } from '@shadcn/components/ui/card'
import { Input } from '@shadcn/components/ui/input'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { ModelType } from '@shared/model'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import { Icon } from '@iconify/vue'

const { t } = useI18n()
const keyword = ref('')
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const langStore = useLanguageStore()

const emit = defineEmits<{
  (e: 'update:model', model: RENDERER_MODEL_META, providerId: string): void
}>()

const props = defineProps({
  type: {
    type: Array as PropType<ModelType[]>,
    default: undefined
  }
})

const providers = computed(() => {
  const sortedProviders = settingsStore.sortedProviders
  const enabledModels = settingsStore.enabledModels

  const orderedProviders = sortedProviders
    .filter((provider) => provider.enable)
    .map((provider) => {
      const enabledProvider = enabledModels.find((entry) => entry.providerId === provider.id)
      if (!enabledProvider || enabledProvider.models.length === 0) {
        return null
      }

      const models =
        !props.type || props.type.length === 0
          ? enabledProvider.models
          : enabledProvider.models.filter(
              (model) => model.type !== undefined && props.type!.includes(model.type as ModelType)
            )

      if (!models || models.length === 0) return null

      return {
        id: provider.id,
        name: provider.name,
        models
      }
    })
    .filter(
      (provider): provider is { id: string; name: string; models: RENDERER_MODEL_META[] } =>
        provider !== null
    )

  return orderedProviders
})

const filteredProviders = computed(() => {
  if (!keyword.value) return providers.value

  return providers.value
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) =>
        model.name.toLowerCase().includes(keyword.value.toLowerCase())
      )
    }))
    .filter((provider) => provider.models.length > 0)
})

const isSelected = (providerId: string, modelId: string) => {
  return chatStore.chatConfig.providerId === providerId && chatStore.chatConfig.modelId === modelId
}

const handleModelSelect = (providerId: string, model: RENDERER_MODEL_META) => {
  emit('update:model', model, providerId)
}
</script>
