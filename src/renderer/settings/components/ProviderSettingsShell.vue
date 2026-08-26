<template>
  <section class="w-full h-full">
    <ScrollArea class="w-full h-full">
      <div class="flex flex-col gap-4 p-4">
        <div class="rounded-lg border border-border bg-card p-4">
          <div class="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="truncate text-lg font-semibold">{{ title }}</h2>
                <DcStatusPill
                  v-if="health"
                  data-testid="provider-health-pill"
                  :status="healthPillStatus"
                  :pulse="health.status === 'checking'"
                  size="xs"
                  :label="healthPillLabel"
                />
              </div>
              <p class="mt-1 truncate text-sm text-muted-foreground">
                {{ subtitle || t('settings.provider.center.noApiUrl') }}
              </p>
              <p
                v-if="health?.checkedAt"
                class="mt-1 text-xs text-muted-foreground"
                data-testid="provider-health-checked-at"
              >
                {{
                  t('settings.provider.health.lastChecked', {
                    time: new Date(health.checkedAt).toLocaleString(locale)
                  })
                }}
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <DcBadge variant="outline">
                {{ t('settings.provider.center.enabledModels', { count: enabledCount }) }}
              </DcBadge>
            </div>
          </div>
        </div>

        <section
          data-testid="provider-connection-section"
          class="rounded-lg border border-border bg-card p-4"
        >
          <h3 class="mb-3 text-sm font-semibold">
            {{ t('settings.provider.center.tabs.connection') }}
          </h3>
          <slot name="connection" />
        </section>

        <Collapsible v-model:open="isAdvancedOpen" class="rounded-lg border border-border bg-card">
          <CollapsibleTrigger as-child>
            <button
              type="button"
              data-testid="provider-advanced-toggle"
              class="flex w-full items-center justify-between p-4 text-start"
            >
              <h3 class="text-sm font-semibold">
                {{ t('settings.provider.center.tabs.advanced') }}
              </h3>
              <Icon
                :icon="isAdvancedOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                class="h-4 w-4 text-muted-foreground"
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="flex flex-col gap-4 p-4 pt-0">
              <slot name="advanced">
                <p class="text-xs leading-5 text-muted-foreground">
                  {{ t('settings.provider.center.noAdvancedConfig') }}
                </p>
              </slot>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <section
          data-testid="provider-models-section"
          class="rounded-lg border border-border bg-card p-4"
        >
          <h3 class="mb-3 text-sm font-semibold">
            {{ t('settings.provider.center.tabs.models') }}
          </h3>
          <slot name="models" />
        </section>
      </div>
    </ScrollArea>

    <slot name="dialogs" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { DcBadge } from '@dc-ui/components/badge'
import { DcStatusPill } from '@dc-ui/components/status-pill'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import type { ProviderHealthView } from '@/stores/providerStore'

const props = defineProps<{
  title: string
  subtitle?: string
  enabledCount: number
  health?: ProviderHealthView | null
}>()

const { t, locale } = useI18n()

const isAdvancedOpen = ref(false)

const healthPillStatus = computed(() => {
  switch (props.health?.status) {
    case 'verified':
      return 'success' as const
    case 'checking':
      return 'active' as const
    case 'needs_attention':
      return 'warning' as const
    default:
      return 'neutral' as const
  }
})

const healthPillLabel = computed(() => {
  switch (props.health?.status) {
    case 'verified':
      return t('settings.provider.health.verified')
    case 'checking':
      return t('settings.provider.health.checking')
    case 'needs_attention':
      return t('settings.provider.health.needsAttention')
    default:
      return t('settings.provider.health.notChecked')
  }
})
</script>
