<template>
  <section class="w-full h-full">
    <ScrollArea class="w-full h-full">
      <div class="flex flex-col gap-4 p-4">
        <div class="rounded-lg border border-border bg-card p-4">
          <div class="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <h2 class="truncate text-lg font-semibold">{{ title }}</h2>
              <p class="mt-1 truncate text-sm text-muted-foreground">
                {{ subtitle || t('settings.provider.center.noApiUrl') }}
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant="outline">
                {{ t('settings.provider.center.enabledModels', { count: enabledCount }) }}
              </Badge>
            </div>
          </div>
        </div>

        <Tabs v-model="activeTabModel" class="flex min-h-0 flex-1 flex-col gap-4">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger data-testid="provider-connection-tab-trigger" value="connection">
              {{ t('settings.provider.center.tabs.connection') }}
            </TabsTrigger>
            <TabsTrigger data-testid="provider-models-tab-trigger" value="models">
              {{ t('settings.provider.center.tabs.models') }}
            </TabsTrigger>
            <TabsTrigger value="advanced">
              {{ t('settings.provider.center.tabs.advanced') }}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connection" class="mt-0">
            <slot name="connection" />
          </TabsContent>

          <TabsContent value="models" class="mt-0">
            <slot name="models" />
          </TabsContent>

          <TabsContent value="advanced" class="mt-0">
            <div class="flex flex-col gap-4">
              <slot name="advanced">
                <p class="text-xs leading-5 text-muted-foreground">
                  {{ t('settings.provider.center.noAdvancedConfig') }}
                </p>
              </slot>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>

    <slot name="dialogs" />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Badge } from '@shadcn/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'

type ProviderSettingsTab = 'connection' | 'models' | 'advanced'

const props = defineProps<{
  title: string
  subtitle?: string
  enabledCount: number
  activeTab: ProviderSettingsTab
}>()

const emit = defineEmits<{
  'update:activeTab': [value: ProviderSettingsTab]
}>()

const { t } = useI18n()

const activeTabModel = computed<ProviderSettingsTab>({
  get: () => props.activeTab,
  set: (value) => emit('update:activeTab', value)
})
</script>
