<template>
  <section class="w-full h-full" data-testid="provider-catalog">
    <ScrollArea class="w-full h-full">
      <div class="flex flex-col gap-4 p-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-lg font-semibold">{{ t('settings.provider.catalog.title') }}</h2>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.catalog.description') }}
          </p>
        </div>

        <div class="relative max-w-md">
          <Input
            v-model="searchQueryBase"
            data-testid="provider-catalog-search"
            :placeholder="t('settings.provider.catalog.searchPlaceholder')"
            class="h-9 pr-8 text-sm"
            @keydown.esc="searchQueryBase = ''"
          />
          <Icon
            v-if="!searchQueryBase.trim()"
            icon="lucide:search"
            class="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <button
            v-else
            type="button"
            :aria-label="t('common.clear')"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            @click="searchQueryBase = ''"
          >
            <Icon icon="lucide:x" class="h-4 w-4" />
          </button>
        </div>

        <button
          data-testid="catalog-add-custom"
          type="button"
          class="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 text-start transition-colors hover:bg-accent"
          @click="$emit('add-custom')"
        >
          <Icon icon="lucide:plus" class="h-5 w-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">
              {{ t('settings.provider.addCustomProvider') }}
            </div>
            <div class="truncate text-xs text-muted-foreground">
              {{ t('settings.provider.dialog.addCustomProvider.description') }}
            </div>
          </div>
          <Icon icon="lucide:chevron-right" class="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>

        <div v-if="filteredProviders.length === 0" class="py-10 text-center">
          <p class="text-sm text-muted-foreground">
            {{ t('settings.provider.catalog.noResults') }}
          </p>
        </div>

        <div v-else class="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <button
            v-for="provider in filteredProviders"
            :key="provider.id"
            :data-provider-id="provider.id"
            type="button"
            class="flex items-center gap-3 rounded-lg border border-border p-3 text-start transition-colors hover:bg-accent"
            @click="$emit('select', provider.id)"
          >
            <ModelIcon
              :model-id="provider.id"
              :custom-class="'w-5 h-5 shrink-0 text-muted-foreground'"
              :is-dark="themeStore.isDark"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ t(provider.name) }}</div>
              <div class="truncate text-xs text-muted-foreground">
                {{ provider.baseUrl || t('settings.provider.center.noApiUrl') }}
              </div>
            </div>
            <DcBadge v-if="providerStore.isProviderConfigured(provider.id)" variant="outline">
              {{ t('settings.provider.catalog.configured') }}
            </DcBadge>
            <Icon
              v-else
              icon="lucide:chevron-right"
              class="h-4 w-4 shrink-0 text-muted-foreground"
            />
          </button>
        </div>
      </div>
    </ScrollArea>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { refDebounced } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { Input } from '@shadcn/components/ui/input'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { DcBadge } from '@dc-ui/components/badge'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useProviderStore } from '@/stores/providerStore'
import { useThemeStore } from '@/stores/theme'

defineEmits<{
  select: [providerId: string]
  'add-custom': []
}>()

const { t } = useI18n()
const providerStore = useProviderStore()
const themeStore = useThemeStore()

const searchQueryBase = ref('')
const searchQuery = refDebounced(searchQueryBase, 150)

const catalogProviders = computed(() =>
  providerStore.sortedProviders.filter((provider) => provider.id !== 'acp')
)

const filteredProviders = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return catalogProviders.value
  }
  return catalogProviders.value.filter((provider) => t(provider.name).toLowerCase().includes(query))
})
</script>
