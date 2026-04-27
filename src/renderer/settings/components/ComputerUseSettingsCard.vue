<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import { Badge } from '@shadcn/components/ui/badge'
import { useToast } from '@/components/use-toast'
import { useMcpStore } from '@/stores/mcp'
import { createComputerUseClient } from '../../api'
import type {
  ComputerUseMcpState,
  ComputerUsePermissionName,
  ComputerUsePermissionState,
  ComputerUseStatus
} from '@shared/types/computerUse'

type StatusTone = 'success' | 'warning' | 'muted' | 'danger'

type StatusRow = {
  key: string
  icon: string
  label: string
  value: string
  tone: StatusTone
}

const { t } = useI18n()
const { toast } = useToast()
const mcpStore = useMcpStore()
const computerUseClient = createComputerUseClient()

const status = ref<ComputerUseStatus | null>(null)
const loading = ref(false)
const actionLoading = ref(false)

const isVisible = computed(() => status.value?.platform === 'darwin')
const isBusy = computed(() => loading.value || actionLoading.value)

const toneClass = (tone: StatusTone) => {
  switch (tone) {
    case 'success':
      return 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
    case 'danger':
      return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
    default:
      return 'border-border bg-muted/40 text-muted-foreground'
  }
}

const permissionValue = (state: ComputerUsePermissionState) => {
  return t(`settings.mcp.computerUse.status.${state}`)
}

const permissionTone = (state: ComputerUsePermissionState): StatusTone => {
  if (state === 'granted') {
    return 'success'
  }
  if (state === 'missing') {
    return 'warning'
  }
  return 'muted'
}

const mcpValue = (state: ComputerUseMcpState) => {
  return t(`settings.mcp.computerUse.status.${state}`)
}

const mcpTone = (state: ComputerUseMcpState): StatusTone => {
  if (state === 'running') {
    return 'success'
  }
  if (state === 'registered') {
    return 'warning'
  }
  if (state === 'error') {
    return 'danger'
  }
  return 'muted'
}

const helperRow = computed<StatusRow>(() => {
  const current = status.value
  if (!current) {
    return {
      key: 'helper',
      icon: 'lucide:hard-drive',
      label: t('settings.mcp.computerUse.helper'),
      value: t('settings.mcp.computerUse.status.unknown'),
      tone: 'muted'
    }
  }

  if (current.available) {
    return {
      key: 'helper',
      icon: 'lucide:hard-drive',
      label: t('settings.mcp.computerUse.helper'),
      value: t('settings.mcp.computerUse.status.ready'),
      tone: 'success'
    }
  }

  if (current.lastError === 'missingHelper') {
    return {
      key: 'helper',
      icon: 'lucide:hard-drive',
      label: t('settings.mcp.computerUse.helper'),
      value: t('settings.mcp.computerUse.status.missingHelper'),
      tone: 'danger'
    }
  }

  return {
    key: 'helper',
    icon: 'lucide:hard-drive',
    label: t('settings.mcp.computerUse.helper'),
    value: t('settings.mcp.computerUse.status.error'),
    tone: 'danger'
  }
})

const permissionRows = computed<StatusRow[]>(() => {
  const permissionConfig: Array<{
    key: ComputerUsePermissionName
    icon: string
    label: string
  }> = [
    {
      key: 'accessibility',
      icon: 'lucide:mouse-pointer-click',
      label: t('settings.mcp.computerUse.accessibility')
    },
    {
      key: 'screenRecording',
      icon: 'lucide:scan-eye',
      label: t('settings.mcp.computerUse.screenRecording')
    }
  ]

  return permissionConfig.map((permission) => {
    const value = status.value?.permissions[permission.key] ?? 'unknown'
    return {
      key: permission.key,
      icon: permission.icon,
      label: permission.label,
      value: permissionValue(value),
      tone: permissionTone(value)
    }
  })
})

const mcpRow = computed<StatusRow>(() => {
  const current = status.value
  if (!current?.enabled) {
    return {
      key: 'mcp',
      icon: 'lucide:server',
      label: t('settings.mcp.computerUse.mcpServer'),
      value: t('settings.mcp.computerUse.status.disabled'),
      tone: 'muted'
    }
  }

  return {
    key: 'mcp',
    icon: 'lucide:server',
    label: t('settings.mcp.computerUse.mcpServer'),
    value: mcpValue(current.mcpServer),
    tone: mcpTone(current.mcpServer)
  }
})

const statusRows = computed(() => [helperRow.value, ...permissionRows.value, mcpRow.value])

const mcpDisabledNotice = computed(() => {
  return Boolean(status.value?.enabled && !mcpStore.mcpEnabled)
})

const loadStatus = async () => {
  loading.value = true
  try {
    status.value = await computerUseClient.getStatus()
  } catch (error) {
    toast({
      title: t('settings.mcp.computerUse.loadFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    loading.value = false
  }
}

const refreshMcpConfig = async () => {
  await mcpStore.loadConfig({ force: true })
}

const handleEnabledChange = async (enabled: boolean) => {
  actionLoading.value = true
  try {
    status.value = await computerUseClient.setEnabled(enabled)
    await refreshMcpConfig()
  } catch (error) {
    toast({
      title: t('settings.mcp.computerUse.updateFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    actionLoading.value = false
  }
}

const handleOpenPermissions = async () => {
  actionLoading.value = true
  try {
    await computerUseClient.openPermissionGuide('all')
    status.value = await computerUseClient.getStatus()
  } catch (error) {
    toast({
      title: t('settings.mcp.computerUse.openPermissionsFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    actionLoading.value = false
  }
}

const handleCheckAgain = async () => {
  await loadStatus()
}

const handleRestart = async () => {
  actionLoading.value = true
  try {
    status.value = await computerUseClient.restartMcpServer()
    await refreshMcpConfig()
  } catch (error) {
    toast({
      title: t('settings.mcp.computerUse.restartFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => {
  void loadStatus()
})
</script>

<template>
  <div v-if="isVisible" class="shrink-0 px-4 pb-3">
    <div class="border rounded-lg bg-card/50 p-3 space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <Icon icon="lucide:monitor-up" class="h-4 w-4 text-primary" />
            <h3 class="text-sm font-medium truncate">
              {{ t('settings.mcp.computerUse.title') }}
            </h3>
            <Icon v-if="loading" icon="lucide:loader-2" class="h-3.5 w-3.5 animate-spin" />
          </div>
          <p class="mt-1 text-xs text-muted-foreground leading-5">
            {{ t('settings.mcp.computerUse.description') }}
          </p>
        </div>
        <Switch
          dir="ltr"
          :model-value="status?.enabled ?? false"
          :disabled="isBusy"
          @update:model-value="handleEnabledChange"
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <div
          v-for="row in statusRows"
          :key="row.key"
          class="rounded-md border bg-background/60 px-2.5 py-2 min-w-0"
        >
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon :icon="row.icon" class="h-3.5 w-3.5 shrink-0" />
            <span class="truncate">{{ row.label }}</span>
          </div>
          <Badge variant="outline" :class="['mt-2 max-w-full truncate', toneClass(row.tone)]">
            {{ row.value }}
          </Badge>
        </div>
      </div>

      <div
        v-if="mcpDisabledNotice"
        class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
      >
        {{ t('settings.mcp.computerUse.mcpDisabledNotice') }}
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-8 text-xs"
          :disabled="isBusy"
          @click="handleOpenPermissions"
        >
          <Icon icon="lucide:shield-check" class="h-3.5 w-3.5 mr-1.5" />
          {{ t('settings.mcp.computerUse.openPermissions') }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-8 text-xs"
          :disabled="isBusy"
          @click="handleCheckAgain"
        >
          <Icon icon="lucide:refresh-cw" class="h-3.5 w-3.5 mr-1.5" />
          {{ t('settings.mcp.computerUse.checkAgain') }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-8 text-xs"
          :disabled="isBusy || !status?.enabled || !status?.available"
          @click="handleRestart"
        >
          <Icon icon="lucide:rotate-cw" class="h-3.5 w-3.5 mr-1.5" />
          {{ t('settings.mcp.computerUse.restart') }}
        </Button>
      </div>
    </div>
  </div>
</template>
