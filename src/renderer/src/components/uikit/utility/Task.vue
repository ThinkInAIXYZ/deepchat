<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { BaseComponentProps, TaskItem } from '../types'

interface Props extends BaseComponentProps {
  task: TaskItem
  compact?: boolean
  showProgress?: boolean
  showActions?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  showProgress: true,
  showActions: true
})

const emit = defineEmits<{
  statusChange: [taskId: string, status: TaskItem['status']]
  edit: [task: TaskItem]
  delete: [task: TaskItem]
}>()

const containerClasses = computed(() =>
  cn(
    'w-full',
    {
      'p-3': props.compact,
      'p-4': !props.compact
    },
    props.class
  )
)

const statusClasses = computed(() =>
  cn('text-xs px-2 py-1 rounded-full', {
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200':
      props.task.status === 'pending',
    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200':
      props.task.status === 'in_progress',
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200':
      props.task.status === 'completed',
    'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200':
      props.task.status === 'cancelled'
  })
)

const statusIcons = {
  pending: '⏳',
  in_progress: '⚡',
  completed: '✅',
  cancelled: '❌'
}

const handleStatusChange = (status: TaskItem['status']) => {
  emit('statusChange', props.task.id, status)
}

const handleEdit = () => {
  emit('edit', props.task)
}

const handleDelete = () => {
  emit('delete', props.task)
}

const formatDate = (date?: Date) => {
  if (!date) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

const isOverdue = computed(() => {
  if (!props.task.dueDate) return false
  return new Date(props.task.dueDate) < new Date() && props.task.status !== 'completed'
})
</script>

<template>
  <Card :class="containerClasses">
    <CardHeader :class="cn('pb-3', { 'pb-2': compact })">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <CardTitle :class="cn('text-base', { 'text-sm': compact })">
            {{ task.title }}
          </CardTitle>

          <CardDescription
            v-if="task.description && !compact"
            class="mt-1 text-sm text-muted-foreground line-clamp-2"
          >
            {{ task.description }}
          </CardDescription>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <Badge :class="statusClasses">
            {{ statusIcons[task.status] }} {{ task.status.replace('_', ' ') }}
          </Badge>

          <!-- Overdue indicator -->
          <Badge v-if="isOverdue" variant="destructive" class="text-xs"> Overdue </Badge>
        </div>
      </div>

      <!-- Task metadata -->
      <div v-if="!compact" class="flex items-center gap-4 text-xs text-muted-foreground mt-2">
        <span v-if="task.assignee"> 👤 {{ task.assignee }} </span>

        <span v-if="task.dueDate"> 📅 {{ formatDate(task.dueDate) }} </span>
      </div>
    </CardHeader>

    <CardContent v-if="showProgress || showActions" class="pt-0">
      <!-- Progress Bar -->
      <div v-if="showProgress && task.progress !== undefined" class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs text-muted-foreground">Progress</span>
          <span class="text-xs font-medium">{{ task.progress }}%</span>
        </div>
        <Progress :value="task.progress" class="h-2" />
      </div>

      <!-- Actions -->
      <div v-if="showActions" class="flex items-center gap-2">
        <!-- Status quick actions -->
        <div class="flex items-center gap-1">
          <Button
            v-if="task.status === 'pending'"
            variant="outline"
            size="xs"
            @click="handleStatusChange('in_progress')"
          >
            Start
          </Button>

          <Button
            v-if="task.status === 'in_progress'"
            variant="outline"
            size="xs"
            @click="handleStatusChange('completed')"
          >
            Complete
          </Button>

          <Button
            v-if="task.status !== 'cancelled'"
            variant="outline"
            size="xs"
            @click="handleStatusChange('cancelled')"
          >
            Cancel
          </Button>
        </div>

        <div class="ml-auto flex items-center gap-1">
          <!-- Edit -->
          <Button variant="ghost" size="xs" @click="handleEdit">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </Button>

          <!-- Delete -->
          <Button variant="ghost" size="xs" @click="handleDelete">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </Button>
        </div>
      </div>

      <!-- Custom actions slot -->
      <div v-if="$slots.actions" class="mt-3 pt-3 border-t border-border">
        <slot
          name="actions"
          :task="task"
          :handleStatusChange="handleStatusChange"
          :handleEdit="handleEdit"
          :handleDelete="handleDelete"
        />
      </div>
    </CardContent>
  </Card>
</template>
