<template>
  <div class="space-y-6">
    <section class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h3 class="text-base font-semibold">{{ t('settings.agents.templateSection') }}</h3>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.agents.templateSectionHint') }}
          </p>
        </div>
      </div>

      <div v-if="loading && templateAgents.length === 0" class="text-sm text-muted-foreground">
        {{ t('common.loading') }}
      </div>

      <div
        v-else-if="templateAgents.length === 0"
        class="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground"
      >
        {{ t('settings.agents.emptyTemplate') }}
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="agent in templateAgents"
          :key="agent.id"
          class="rounded-lg border p-3 transition-colors hover:bg-accent/30"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50"
                >
                  <Icon :icon="agent.icon || 'lucide:bot'" class="h-4 w-4" />
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-semibold" :title="agent.name">{{
                      agent.name
                    }}</span>
                    <Badge v-if="isDefaultAgent(agent.id)" variant="secondary" class="text-[10px]">
                      {{ t('settings.agents.defaultBadge') }}
                    </Badge>
                  </div>
                </div>
              </div>

              <div class="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>
                  {{
                    t('settings.agents.providerModelLine', {
                      provider: resolveProviderName(agent.providerId),
                      model: resolveModelName(agent.providerId, agent.modelId)
                    })
                  }}
                </div>
                <div>
                  {{ t('settings.agents.workdirLine', { path: resolveWorkdir(agent.id) }) }}
                </div>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <Button type="button" size="sm" variant="ghost" @click="emit('edit-template', agent)">
                {{ t('common.edit') }}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                :disabled="isDefaultAgent(agent.id)"
                @click="emit('delete-template', agent)"
              >
                {{ t('common.delete') }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <div>
        <h3 class="text-base font-semibold">{{ t('settings.agents.acpSection') }}</h3>
        <p class="text-xs text-muted-foreground">{{ t('settings.agents.acpSectionHint') }}</p>
      </div>

      <div
        v-if="acpAgents.length === 0"
        class="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground"
      >
        {{ t('settings.agents.emptyAcp') }}
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="agent in acpAgents"
          :key="agent.id"
          class="rounded-lg border border-border/80 p-3 text-sm"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50"
                >
                  <Icon :icon="agent.icon || 'lucide:terminal'" class="h-4 w-4" />
                </div>
                <span class="truncate font-semibold" :title="agent.name">{{ agent.name }}</span>
                <Badge :variant="agent.enabled ? 'secondary' : 'outline'" class="text-[10px]">
                  {{ agent.enabled ? t('common.enabled') : t('common.disabled') }}
                </Badge>
              </div>

              <div class="mt-2 text-xs text-muted-foreground">
                {{ t('settings.agents.commandLine', { command: agent.command || '-' }) }}
              </div>
            </div>

            <Button type="button" size="sm" variant="outline" @click="emit('view-acp')">
              {{ t('settings.agents.viewInAcp') }}
            </Button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import type { AcpAgent, TemplateAgent } from '@shared/presenter'

const DEFAULT_AGENT_ID = 'default-local-agent'

type ModelLabelMap = Record<string, string>

type ProviderLabelMap = Record<string, string>

const props = defineProps<{
  loading: boolean
  templateAgents: TemplateAgent[]
  acpAgents: AcpAgent[]
  providerLabelMap: ProviderLabelMap
  modelLabelMap: ModelLabelMap
  workdirMap: Record<string, string>
}>()

const { loading, templateAgents, acpAgents } = toRefs(props)

const emit = defineEmits<{
  (e: 'edit-template', agent: TemplateAgent): void
  (e: 'delete-template', agent: TemplateAgent): void
  (e: 'view-acp'): void
}>()

const { t } = useI18n()

const isDefaultAgent = (agentId: string) => agentId === DEFAULT_AGENT_ID

const resolveProviderName = (providerId: string) => {
  return props.providerLabelMap[providerId] || providerId
}

const resolveModelName = (providerId: string, modelId: string) => {
  const key = `${providerId}::${modelId}`
  return props.modelLabelMap[key] || modelId
}

const resolveWorkdir = (agentId: string) => {
  return props.workdirMap[agentId] || t('settings.agents.workdirNotSet')
}
</script>
