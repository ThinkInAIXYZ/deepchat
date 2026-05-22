<template>
  <ScrollArea data-testid="settings-scheduled-tasks-page" class="h-full w-full">
    <div class="flex h-full w-full flex-col gap-4 p-4">
      <div v-if="isLoading" class="text-sm text-muted-foreground">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="!settings" class="text-sm text-muted-foreground">
        {{ t('common.error.requestFailed') }}
      </div>
      <template v-else>
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <div class="text-base font-medium">
              {{ t('settings.scheduledTasks.title') }}
            </div>
            <span v-if="isSaving" class="text-xs text-muted-foreground">
              {{ t('common.saving') }}
            </span>
          </div>
          <div class="text-sm text-muted-foreground">
            {{ t('settings.scheduledTasks.description') }}
          </div>
          <div class="text-xs text-muted-foreground">
            {{ t('settings.scheduledTasks.hint') }}
          </div>
        </div>

        <div class="rounded-lg border p-4">
          <div class="space-y-4">
            <div class="flex justify-end">
              <Button
                data-testid="scheduled-tasks-add"
                variant="outline"
                size="sm"
                @click="addTask"
              >
                <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
                {{ t('settings.scheduledTasks.newTask') }}
              </Button>
            </div>

            <div v-if="settings.tasks.length === 0" class="text-sm text-muted-foreground">
              {{ t('settings.scheduledTasks.empty') }}
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="(task, index) in settings.tasks"
                :key="task.id"
                class="rounded-md border p-4"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="flex flex-1 items-center gap-3">
                    <Switch
                      :model-value="task.enabled"
                      @update:model-value="(value) => toggleTask(task.id, value)"
                    />
                    <Input
                      :model-value="task.name"
                      :placeholder="t('settings.scheduledTasks.namePlaceholder')"
                      class="max-w-xs"
                      @update:model-value="(value) => updateField(index, 'name', String(value))"
                      @blur="commitTask(index)"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="firingId === task.id"
                      @click="runTaskNow(task.id)"
                    >
                      <Icon
                        :icon="firingId === task.id ? 'lucide:loader-2' : 'lucide:play'"
                        :class="firingId === task.id ? 'mr-1 h-4 w-4 animate-spin' : 'mr-1 h-4 w-4'"
                      />
                      {{ t('settings.scheduledTasks.fireNow') }}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      :aria-label="t('common.delete')"
                      @click="deleteTask(task.id)"
                    >
                      <Icon icon="lucide:trash-2" class="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div class="mt-4 grid gap-4 md:grid-cols-2">
                  <!-- Trigger -->
                  <div class="space-y-3">
                    <div class="text-xs font-medium text-muted-foreground">
                      {{ t('settings.scheduledTasks.trigger.title') }}
                    </div>
                    <div class="space-y-2">
                      <Label class="text-xs">
                        {{ t('settings.scheduledTasks.trigger.kind') }}
                      </Label>
                      <Select
                        :model-value="task.trigger.kind"
                        @update:model-value="
                          (value) => updateTriggerKind(index, value as TriggerKind)
                        "
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="once">
                            {{ t('settings.scheduledTasks.trigger.kindOnce') }}
                          </SelectItem>
                          <SelectItem value="daily">
                            {{ t('settings.scheduledTasks.trigger.kindDaily') }}
                          </SelectItem>
                          <SelectItem value="weekly">
                            {{ t('settings.scheduledTasks.trigger.kindWeekly') }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div v-if="task.trigger.kind === 'once'" class="space-y-2">
                      <Label class="text-xs">
                        {{ t('settings.scheduledTasks.trigger.firesAt') }}
                      </Label>
                      <Input
                        type="datetime-local"
                        :model-value="onceInputValues[index] ?? ''"
                        @update:model-value="(value) => updateOnceInput(index, String(value))"
                        @blur="commitTask(index)"
                      />
                    </div>

                    <div
                      v-if="task.trigger.kind === 'daily' || task.trigger.kind === 'weekly'"
                      class="flex flex-wrap items-end gap-2"
                    >
                      <div v-if="task.trigger.kind === 'weekly'" class="space-y-2">
                        <Label class="text-xs">
                          {{ t('settings.scheduledTasks.trigger.dayOfWeek') }}
                        </Label>
                        <Select
                          :model-value="String((task.trigger as WeeklyTrigger).dayOfWeek)"
                          @update:model-value="(value) => updateWeeklyDay(index, Number(value))"
                        >
                          <SelectTrigger class="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              v-for="(label, value) in dayOfWeekOptions"
                              :key="value"
                              :value="String(value)"
                            >
                              {{ t(label) }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div class="space-y-2">
                        <Label class="text-xs">
                          {{ t('settings.scheduledTasks.trigger.time') }}
                        </Label>
                        <Input
                          type="time"
                          :model-value="recurringTimeValues[index] ?? '09:00'"
                          @update:model-value="(value) => updateRecurringTime(index, String(value))"
                          @blur="commitTask(index)"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- Action -->
                  <div class="space-y-3">
                    <div class="text-xs font-medium text-muted-foreground">
                      {{ t('settings.scheduledTasks.action.title') }}
                    </div>
                    <div class="space-y-2">
                      <Label class="text-xs">
                        {{ t('settings.scheduledTasks.action.kind') }}
                      </Label>
                      <Select
                        :model-value="task.action.kind"
                        @update:model-value="
                          (value) => updateActionKind(index, value as ActionKind)
                        "
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="notify">
                            {{ t('settings.scheduledTasks.action.kindNotify') }}
                          </SelectItem>
                          <SelectItem value="prompt">
                            {{ t('settings.scheduledTasks.action.kindPrompt') }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div class="space-y-2">
                      <Label class="text-xs">
                        {{ t('settings.scheduledTasks.action.titleField') }}
                      </Label>
                      <Input
                        :model-value="task.action.title"
                        :placeholder="t('settings.scheduledTasks.action.titlePlaceholder')"
                        @update:model-value="
                          (value) => updateActionField(index, 'title', String(value))
                        "
                        @blur="commitTask(index)"
                      />
                    </div>

                    <div v-if="task.action.kind === 'notify'" class="space-y-2">
                      <Label class="text-xs">
                        {{ t('settings.scheduledTasks.action.body') }}
                      </Label>
                      <textarea
                        :value="(task.action as NotifyAction).body"
                        class="w-full rounded-md border bg-background p-2 text-sm"
                        rows="3"
                        @input="
                          (event) =>
                            updateActionField(
                              index,
                              'body',
                              (event.target as HTMLTextAreaElement).value
                            )
                        "
                        @blur="commitTask(index)"
                      />
                    </div>

                    <div v-if="task.action.kind === 'prompt'" class="space-y-3">
                      <div class="space-y-2">
                        <Label class="text-xs">
                          {{ t('settings.scheduledTasks.action.message') }}
                        </Label>
                        <textarea
                          :value="(task.action as PromptAction).message"
                          class="w-full rounded-md border bg-background p-2 text-sm"
                          rows="3"
                          @input="
                            (event) =>
                              updateActionField(
                                index,
                                'message',
                                (event.target as HTMLTextAreaElement).value
                              )
                          "
                          @blur="commitTask(index)"
                        />
                      </div>
                      <div class="grid gap-2 sm:grid-cols-2">
                        <div class="space-y-2">
                          <Label class="text-xs">
                            {{ t('settings.scheduledTasks.action.agentId') }}
                          </Label>
                          <Input
                            :model-value="(task.action as PromptAction).agentId ?? ''"
                            :placeholder="t('settings.scheduledTasks.action.agentIdPlaceholder')"
                            @update:model-value="
                              (value) => updateActionField(index, 'agentId', String(value))
                            "
                            @blur="commitTask(index)"
                          />
                        </div>
                        <div class="space-y-2">
                          <Label class="text-xs">
                            {{ t('settings.scheduledTasks.action.modelId') }}
                          </Label>
                          <Input
                            :model-value="(task.action as PromptAction).modelId ?? ''"
                            :placeholder="t('settings.scheduledTasks.action.modelIdPlaceholder')"
                            @update:model-value="
                              (value) => updateActionField(index, 'modelId', String(value))
                            "
                            @blur="commitTask(index)"
                          />
                        </div>
                      </div>
                      <div class="space-y-2">
                        <Label class="text-xs">
                          {{ t('settings.scheduledTasks.action.systemPrompt') }}
                        </Label>
                        <textarea
                          :value="(task.action as PromptAction).systemPrompt ?? ''"
                          class="w-full rounded-md border bg-background p-2 text-sm"
                          rows="2"
                          @input="
                            (event) =>
                              updateActionField(
                                index,
                                'systemPrompt',
                                (event.target as HTMLTextAreaElement).value
                              )
                          "
                          @blur="commitTask(index)"
                        />
                      </div>
                      <label class="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          :checked="(task.action as PromptAction).autoSend"
                          @change="
                            (event) =>
                              updateActionField(
                                index,
                                'autoSend',
                                (event.target as HTMLInputElement).checked
                              )
                          "
                          @blur="commitTask(index)"
                        />
                        {{ t('settings.scheduledTasks.action.autoSend') }}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { useToast } from '@/components/use-toast'
import { createScheduledTasksClient } from '@api/ScheduledTasksClient'
import type {
  ScheduledTask,
  ScheduledTaskAction,
  ScheduledTaskTrigger,
  ScheduledTasksSettings
} from '@shared/scheduledTasks'

type TriggerKind = ScheduledTaskTrigger['kind']
type ActionKind = ScheduledTaskAction['kind']
type NotifyAction = Extract<ScheduledTaskAction, { kind: 'notify' }>
type PromptAction = Extract<ScheduledTaskAction, { kind: 'prompt' }>
type WeeklyTrigger = Extract<ScheduledTaskTrigger, { kind: 'weekly' }>

const { t } = useI18n()
const { toast } = useToast()
const client = createScheduledTasksClient()

const settings = ref<ScheduledTasksSettings | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const firingId = ref<string | null>(null)

const onceInputValues = ref<string[]>([])
const recurringTimeValues = ref<string[]>([])

const dayOfWeekOptions: Record<number, string> = {
  0: 'settings.scheduledTasks.weekday.sun',
  1: 'settings.scheduledTasks.weekday.mon',
  2: 'settings.scheduledTasks.weekday.tue',
  3: 'settings.scheduledTasks.weekday.wed',
  4: 'settings.scheduledTasks.weekday.thu',
  5: 'settings.scheduledTasks.weekday.fri',
  6: 'settings.scheduledTasks.weekday.sat'
}

const tasks = computed(() => settings.value?.tasks ?? [])

const padTwo = (value: number): string => value.toString().padStart(2, '0')

const formatDateTimeLocal = (timestamp: number): string => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = padTwo(date.getMonth() + 1)
  const day = padTwo(date.getDate())
  const hour = padTwo(date.getHours())
  const minute = padTwo(date.getMinutes())
  return `${year}-${month}-${day}T${hour}:${minute}`
}

const parseDateTimeLocal = (value: string): number | null => {
  if (!value) {
    return null
  }
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

const refreshFormBuffers = () => {
  onceInputValues.value = tasks.value.map((task) =>
    task.trigger.kind === 'once' ? formatDateTimeLocal(task.trigger.firesAt) : ''
  )
  recurringTimeValues.value = tasks.value.map((task) => {
    if (task.trigger.kind === 'daily' || task.trigger.kind === 'weekly') {
      return `${padTwo(task.trigger.hour)}:${padTwo(task.trigger.minute)}`
    }
    return '09:00'
  })
}

watch(
  () => tasks.value.map((task) => task.id).join('|'),
  () => {
    refreshFormBuffers()
  }
)

const loadSettings = async () => {
  isLoading.value = true
  try {
    settings.value = await client.list()
    refreshFormBuffers()
  } catch (error) {
    console.error('[ScheduledTasks] Failed to load settings:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isLoading.value = false
  }
}

const persistTask = async (task: ScheduledTask): Promise<void> => {
  isSaving.value = true
  try {
    const response = await client.upsert({
      id: task.id,
      name: task.name,
      enabled: task.enabled,
      trigger: task.trigger,
      action: task.action
    })
    settings.value = response.settings
    refreshFormBuffers()
  } catch (error) {
    console.error('[ScheduledTasks] Failed to persist task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isSaving.value = false
  }
}

const commitTask = async (index: number) => {
  const task = tasks.value[index]
  if (!task) {
    return
  }
  await persistTask(task)
}

const updateField = (index: number, field: 'name', value: string) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  next[index] = { ...target, [field]: value }
  settings.value = { ...settings.value, tasks: next }
}

const updateTriggerKind = (index: number, kind: TriggerKind) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  let trigger: ScheduledTaskTrigger
  switch (kind) {
    case 'once': {
      const future = Date.now() + 60 * 60 * 1000
      trigger = { kind: 'once', firesAt: future }
      break
    }
    case 'daily':
      trigger = { kind: 'daily', hour: 9, minute: 0 }
      break
    case 'weekly':
      trigger = { kind: 'weekly', dayOfWeek: 1, hour: 9, minute: 0 }
      break
  }
  next[index] = { ...target, trigger }
  settings.value = { ...settings.value, tasks: next }
  void commitTask(index)
}

const updateOnceInput = (index: number, value: string) => {
  onceInputValues.value[index] = value
  const parsed = parseDateTimeLocal(value)
  if (!parsed || !settings.value) {
    return
  }
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target || target.trigger.kind !== 'once') return
  next[index] = { ...target, trigger: { kind: 'once', firesAt: parsed } }
  settings.value = { ...settings.value, tasks: next }
}

const updateRecurringTime = (index: number, value: string) => {
  recurringTimeValues.value[index] = value
  const [hourString, minuteString] = value.split(':')
  const hour = Number(hourString)
  const minute = Number(minuteString)
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !settings.value) {
    return
  }
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  if (target.trigger.kind === 'daily') {
    next[index] = { ...target, trigger: { kind: 'daily', hour, minute } }
  } else if (target.trigger.kind === 'weekly') {
    next[index] = {
      ...target,
      trigger: { kind: 'weekly', dayOfWeek: target.trigger.dayOfWeek, hour, minute }
    }
  } else {
    return
  }
  settings.value = { ...settings.value, tasks: next }
}

const updateWeeklyDay = (index: number, dayOfWeek: number) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target || target.trigger.kind !== 'weekly') return
  next[index] = {
    ...target,
    trigger: { ...target.trigger, dayOfWeek }
  }
  settings.value = { ...settings.value, tasks: next }
  void commitTask(index)
}

const updateActionKind = (index: number, kind: ActionKind) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  let action: ScheduledTaskAction
  if (kind === 'notify') {
    action = {
      kind: 'notify',
      title: target.action.title || target.name || t('settings.scheduledTasks.defaults.title'),
      body: ''
    }
  } else {
    action = {
      kind: 'prompt',
      title: target.action.title || target.name || t('settings.scheduledTasks.defaults.title'),
      message: target.action.kind === 'notify' ? target.action.body : '',
      autoSend: false,
      agentId: 'deepchat'
    }
  }
  next[index] = { ...target, action }
  settings.value = { ...settings.value, tasks: next }
  void commitTask(index)
}

const updateActionField = (
  index: number,
  field: keyof PromptAction | keyof NotifyAction,
  value: string | boolean
) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  const updatedAction = { ...target.action, [field]: value } as ScheduledTaskAction
  next[index] = { ...target, action: updatedAction }
  settings.value = { ...settings.value, tasks: next }
}

const addTask = async () => {
  isSaving.value = true
  try {
    const response = await client.upsert({
      name: t('settings.scheduledTasks.defaults.name'),
      enabled: false,
      trigger: { kind: 'daily', hour: 9, minute: 0 },
      action: {
        kind: 'notify',
        title: t('settings.scheduledTasks.defaults.title'),
        body: t('settings.scheduledTasks.defaults.body')
      }
    })
    settings.value = response.settings
    refreshFormBuffers()
  } catch (error) {
    console.error('[ScheduledTasks] Failed to add task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isSaving.value = false
  }
}

const toggleTask = async (id: string, enabled: boolean) => {
  try {
    const response = await client.toggle(id, enabled)
    settings.value = response.settings
    refreshFormBuffers()
  } catch (error) {
    console.error('[ScheduledTasks] Failed to toggle task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const deleteTask = async (id: string) => {
  try {
    const response = await client.remove(id)
    settings.value = response
    refreshFormBuffers()
  } catch (error) {
    console.error('[ScheduledTasks] Failed to delete task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const runTaskNow = async (id: string) => {
  firingId.value = id
  try {
    const response = await client.fireNow(id)
    settings.value = response.settings
    refreshFormBuffers()
    toast({
      title: t('settings.scheduledTasks.fireNowSuccess'),
      description: response.task.name
    })
  } catch (error) {
    console.error('[ScheduledTasks] Failed to fire task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    firingId.value = null
  }
}

onMounted(() => {
  void loadSettings()
})
</script>
