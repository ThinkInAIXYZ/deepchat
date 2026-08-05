<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          {{ agent ? agent.name : t('settings.acp.profileManager.title') }}
        </DialogTitle>
        <DialogDescription>
          {{ t('settings.acp.profileManager.description') }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="agent" class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="text-sm text-muted-foreground">
            {{ t('settings.acp.profileManager.count', { count: agent.profiles.length }) }}
          </div>
          <DcButton size="sm" @click="emit('add-profile', agent.id)">
            {{ t('settings.acp.addProfile') }}
          </DcButton>
        </div>
        <div v-if="!agent.profiles.length" class="text-sm text-muted-foreground text-center py-8">
          {{ t('settings.acp.profileManager.empty') }}
        </div>
        <div v-else class="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          <div
            v-for="profile in agent.profiles"
            :key="profile.id"
            class="border rounded-lg p-3 space-y-2"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="text-sm font-semibold flex items-center gap-2">
                  <span>{{ profile.name }}</span>
                  <DcBadge v-if="profile.id === agent.activeProfileId" variant="secondary">
                    {{ t('settings.acp.profileManager.active') }}
                  </DcBadge>
                </div>
                <p class="text-xs text-muted-foreground break-words">
                  {{ profile.command }}
                  <span v-if="profile.args?.length">
                    {{ profile.args.join(' ') }}
                  </span>
                </p>
                <p class="text-[11px] text-muted-foreground break-words">
                  <span class="font-medium">ENV:</span>
                  <span>
                    {{ formatEnv(profile.env) }}
                  </span>
                </p>
              </div>
              <div class="flex flex-col gap-1">
                <DcButton
                  variant="ghost"
                  size="sm"
                  :disabled="profile.id === agent.activeProfileId"
                  @click="emit('set-active', { agentId: agent.id, profileId: profile.id })"
                >
                  {{ t('settings.acp.profileManager.setActive') }}
                </DcButton>
                <DcButton
                  variant="ghost"
                  size="sm"
                  @click="emit('edit-profile', { agentId: agent.id, profile })"
                >
                  {{ t('common.edit') }}
                </DcButton>
                <DcButton
                  variant="ghost"
                  size="sm"
                  :disabled="agent.profiles.length <= 1"
                  @click="emit('delete-profile', { agentId: agent.id, profile })"
                >
                  {{ t('common.delete') }}
                </DcButton>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="py-6 text-center text-sm text-muted-foreground">
        {{ t('settings.acp.profileManager.noAgent') }}
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import type { AcpAgentProfile, AcpBuiltinAgent, AcpBuiltinAgentId } from '@shared/types/acp'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { DcButton } from '@dc-ui/components/button'
import { DcBadge } from '@dc-ui/components/badge'

defineProps<{
  open: boolean
  agent: AcpBuiltinAgent | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'add-profile', agentId: AcpBuiltinAgentId): void
  (e: 'edit-profile', payload: { agentId: AcpBuiltinAgentId; profile: AcpAgentProfile }): void
  (e: 'delete-profile', payload: { agentId: AcpBuiltinAgentId; profile: AcpAgentProfile }): void
  (e: 'set-active', payload: { agentId: AcpBuiltinAgentId; profileId: string }): void
}>()

const { t } = useI18n()

const formatEnv = (env?: Record<string, string>) => {
  if (!env || !Object.keys(env).length) {
    return t('settings.acp.none')
  }

  const maskValue = (val: string | undefined | null) => {
    if (!val) return ''
    const str = String(val)
    return str.length <= 10 ? str : `${str.slice(0, 10)}***`
  }

  return Object.entries(env)
    .map(([key, value]) => `${key}=${maskValue(value)}`)
    .join(', ')
}
</script>
