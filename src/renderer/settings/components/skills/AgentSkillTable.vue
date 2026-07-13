<template>
  <div class="overflow-hidden rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[28%]">{{ t('settings.skills.agents.table.skill') }}</TableHead>
          <TableHead class="w-[18%]">{{ t('settings.skills.agents.table.owner') }}</TableHead>
          <TableHead class="w-[18%]">{{ t('settings.skills.agents.table.status') }}</TableHead>
          <TableHead class="w-[120px]">{{ t('settings.skills.agents.table.preview') }}</TableHead>
          <TableHead class="w-[120px] text-right">
            {{ t('settings.skills.agents.table.action') }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-if="agent.skills.length === 0">
          <TableCell colspan="5" class="h-24 text-center text-sm text-muted-foreground">
            {{ t('settings.skills.agents.emptySkills') }}
          </TableCell>
        </TableRow>
        <TableRow v-for="skill in agent.skills" v-else :key="skill.name">
          <TableCell class="min-w-0">
            <div class="truncate font-medium text-sm" :title="skill.name">
              {{ skill.name }}
            </div>
          </TableCell>
          <TableCell>
            <span class="text-sm">{{ ownerLabel(skill.owner) }}</span>
          </TableCell>
          <TableCell>
            <Badge variant="outline" :class="statusBadgeClass(skill.status)">
              {{ statusLabel(skill.status) }}
            </Badge>
          </TableCell>
          <TableCell>
            <Button variant="ghost" size="sm" class="h-7 px-2" @click="emit('view-detail', skill)">
              <Icon icon="lucide:eye" class="mr-1 h-3.5 w-3.5" />
              {{ t('settings.skills.agents.actions.view') }}
            </Button>
          </TableCell>
          <TableCell class="text-right">
            <Button
              v-if="skill.action"
              variant="outline"
              size="sm"
              class="h-7"
              :disabled="!isEnabledAction(skill.action)"
              :title="actionTitle(skill.action)"
              @click="emit('action', skill)"
            >
              <Icon :icon="actionIcon(skill.action)" class="mr-1 h-3.5 w-3.5" />
              {{ actionLabel(skill.action) }}
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@shadcn/components/ui/table'
import type {
  AgentSkillAction,
  AgentSkillItem,
  AgentSkillOwner,
  AgentSkillStatus,
  InstalledSkillAgentDetail
} from '@shared/types/skillSync'

const props = defineProps<{
  agent: InstalledSkillAgentDetail
}>()

const emit = defineEmits<{
  action: [skill: AgentSkillItem]
  'view-detail': [skill: AgentSkillItem]
}>()

const { t } = useI18n()

const ownerLabel = (owner: AgentSkillOwner) => {
  if (owner === 'agent') return props.agent.name
  return t(`settings.skills.agents.owner.${owner}`)
}

const statusLabel = (status: AgentSkillStatus) => t(`settings.skills.agents.status.${status}`)

const actionLabel = (action: AgentSkillAction) => t(`settings.skills.agents.actions.${action}`)

const isEnabledAction = (action: AgentSkillAction) =>
  action === 'adopt' ||
  action === 'resolve-conflict' ||
  action === 'repair-link' ||
  action === 'remove-link'

const actionTitle = (action: AgentSkillAction) =>
  isEnabledAction(action) ? actionLabel(action) : t('settings.skills.agents.actions.pending')

const actionIcon = (action: AgentSkillAction) => {
  if (action === 'resolve-conflict') return 'lucide:git-compare-arrows'
  if (action === 'repair-link') return 'lucide:wrench'
  if (action === 'remove-link') return 'lucide:unlink'
  if (action === 'open') return 'lucide:external-link'
  return 'lucide:copy-plus'
}

const statusBadgeClass = (status: AgentSkillStatus) => {
  if (status === 'linked') {
    return 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
  }
  if (status === 'conflict' || status === 'linked-out') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (status === 'broken-link') {
    return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
  return ''
}
</script>
