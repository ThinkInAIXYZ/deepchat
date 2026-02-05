<template>
  <Card
    class="w-full p-0"
    :class="embedded ? 'border-none bg-transparent shadow-none' : 'border-border bg-card shadow-sm'"
    :dir="langStore.dir"
  >
    <CardContent :class="embedded ? 'flex flex-col p-0' : 'flex flex-col p-2'">
      <Input
        v-model="keyword"
        :placeholder="t('model.search.placeholder')"
        class="h-9 w-full text-sm"
      />
      <ScrollArea class="h-72">
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
                    v-if="provider.id === 'acp'"
                    class="h-4 w-4 shrink-0 opacity-80 transition group-hover:opacity-100 group-data-[selected=true]:opacity-100"
                    :model-id="model.id"
                    :is-dark="themeStore.isDark"
                  />
                  <ModelIcon
                    v-else
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
// import { useChatStore } from '@/stores/chat' // Removed in Phase 6
import { useModelStore } from '@/stores/modelStore'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { ModelType } from '@shared/model'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import { Icon } from '@iconify/vue'

const { t } = useI18n()
const keyword = ref('')
// const chatStore = useChatStore() // Removed in Phase 6
const modelStore = useModelStore()
const themeStore = useThemeStore()
const langStore = useLanguageStore()

const emit = defineEmits<{
  (e: 'update:model', model: RENDERER_MODEL_META, providerId: string): void
}>()

const props = defineProps({
  type: {
    type: Array as PropType<ModelType[]>,
    default: undefined
  },
  requiresVision: {
    type: Boolean,
    default: false
  },
  embedded: {
    type: Boolean,
    default: false
  }
})

const providers = computed(() => {
  return modelStore.getSelectableProviders({
    types: props.type,
    requiresVision: props.requiresVision,
    mode: 'agent'
  })
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

const isSelected = (_providerId: string, _modelId: string) => {
  // Model selection is now managed by agent configuration (Phase 6: chatConfig removed)
  return false
}

const handleModelSelect = (providerId: string, model: RENDERER_MODEL_META) => {
  emit('update:model', model, providerId)
}
</script>
