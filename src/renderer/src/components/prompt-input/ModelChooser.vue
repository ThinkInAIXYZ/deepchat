<template>
  <div
    class="flex w-full flex-col gap-3 rounded-2xl border border-border/60 bg-card/95 p-4 shadow-[0_26px_60px_-32px_rgba(12,18,36,0.85)] backdrop-blur-lg dark:border-white/10 dark:bg-[#0b111b]/95"
    :dir="langStore.dir"
  >
    <Input
      v-model="keyword"
      :placeholder="t('model.search.placeholder')"
      class="h-9 w-full rounded-lg border border-border/50 bg-white/60 px-3 text-xs font-medium text-foreground/80 placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:bg-white focus-visible:ring-0 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/80 dark:placeholder:text-white/50 dark:focus-visible:bg-white/[0.12]"
    />
    <ScrollArea class="h-72 pr-2">
      <div class="flex flex-col gap-4">
        <div v-for="provider in filteredProviders" :key="provider.id" class="flex flex-col gap-2">
          <p
            class="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 dark:text-white/60"
          >
            {{ provider.name }}
          </p>
          <div class="flex flex-col gap-1.5" role="listbox" aria-orientation="vertical">
            <button
              v-for="model in provider.models"
              :key="`${provider.id}-${model.id}`"
              type="button"
              class="relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-white/70 px-4 py-2 text-left text-xs font-semibold text-foreground/80 shadow-[0_1px_0_rgba(9,13,24,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:border-border/80 hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:border-white/12 dark:bg-white/[0.06] dark:text-white/80 dark:shadow-[0_1px_0_rgba(12,18,36,0.4)] dark:hover:border-white/30 dark:hover:bg-white/12 before:absolute before:inset-y-2 before:left-1 before:w-px before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity before:duration-200"
              :class="[
                isSelected(provider.id, model.id)
                  ? 'border-primary/80 bg-primary/12 text-foreground shadow-[0_16px_34px_-22px_rgba(37,99,235,0.55)] ring-1 ring-primary/40 before:opacity-100 dark:border-[#3c82ff]/70 dark:bg-[#162237]/90 dark:text-white dark:ring-[#3c82ff]/45 dark:before:bg-[#3c82ff]'
                  : 'dark:before:bg-white/20'
              ]"
              role="option"
              :aria-selected="isSelected(provider.id, model.id)"
              :data-selected="isSelected(provider.id, model.id)"
              @click="handleModelSelect(provider.id, model)"
            >
              <div
                class="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-white/80 text-[11px] font-semibold uppercase text-muted-foreground/80 transition-all duration-200 group-data-[selected=true]:border-transparent group-data-[selected=true]:bg-primary group-data-[selected=true]:text-white/90 dark:border-white/15 dark:bg-white/[0.08] dark:group-data-[selected=true]:bg-[#3c82ff]"
              >
                <ModelIcon
                  class="h-4 w-4 shrink-0 opacity-70 transition duration-200 group-hover:opacity-100 group-data-[selected=true]:opacity-100"
                  :model-id="provider.id"
                  :is-dark="themeStore.isDark"
                />
              </div>
              <span class="flex-1 truncate text-[13px] font-medium">
                {{ model.name }}
              </span>
              <Icon
                icon="lucide:check"
                class="h-3.5 w-3.5 shrink-0 text-primary opacity-0 transition-opacity duration-200 group-data-[selected=true]:opacity-100 dark:text-[#9db8ff]"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
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
