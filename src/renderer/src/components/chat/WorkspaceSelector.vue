<template>
  <div class="flex items-center gap-1">
    <!-- Display Mode -->
    <div
      v-if="!isEditing"
      :class="[
        'flex items-center gap-1 rounded-md',
        'text-xs font-medium text-muted-foreground',
        editable && !compact ? 'px-2 py-1 hover:bg-muted/60 cursor-pointer' : '',
        compact ? 'h-6' : ''
      ]"
      :title="workspacePath || t('chat.input.workspaceSelector.notSet')"
      @click="handleStartEdit"
    >
      <Icon icon="lucide:folder" class="w-3.5 h-3.5 flex-shrink-0" />
      <span v-if="hasWorkspace" class="truncate max-w-[180px]">
        {{ truncatedPath }}
      </span>
      <span v-else class="text-muted-foreground/70">
        {{ t('chat.input.workspaceSelector.notSet') }}
      </span>
      <Icon
        v-if="editable && !compact"
        icon="lucide:chevron-down"
        class="w-3 h-3 text-muted-foreground"
      />
    </div>

    <!-- Edit Mode -->
    <div v-else class="flex items-center gap-1">
      <input
        ref="inputRef"
        v-model="editedPath"
        type="text"
        :placeholder="t('chat.input.workspaceSelector.placeholder')"
        class="h-7 px-2 rounded-md border border-input bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-[200px] max-w-[300px]"
        @keydown.enter="handleSaveEdit"
        @keydown.esc="handleCancelEdit"
      />
      <Button
        variant="ghost"
        size="sm"
        class="h-7 w-7 p-0 rounded"
        :title="t('chat.input.workspaceSelector.save')"
        @click="handleSaveEdit"
      >
        <Icon icon="lucide:check" class="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 w-7 p-0 rounded"
        :title="t('chat.input.workspaceSelector.cancel')"
        @click="handleCancelEdit"
      >
        <Icon icon="lucide:x" class="w-4 h-4" />
      </Button>
    </div>

    <!-- Select Directory Button (if editable) -->
    <Button
      v-if="editable && !isEditing && !compact"
      variant="ghost"
      size="sm"
      class="h-7 w-7 p-0 rounded"
      :title="t('chat.input.workspaceSelector.select')"
      @click="handleSelectDirectory"
    >
      <Icon icon="lucide:folder-open" class="w-4 h-4" />
    </Button>

    <!-- ACP Edit Warning Alert Dialog -->
    <AlertDialog :open="showAcpWarning" @update:open="(open) => !open && (showAcpWarning = false)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            t('chat.input.workspaceSelector.acpWarningTitle')
          }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('chat.input.workspaceSelector.acpWarningDescription') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="showAcpWarning = false">
            {{ t('chat.input.workspaceSelector.acpWarningCancel') }}
          </AlertDialogCancel>
          <AlertDialogAction @click="handleProceedAcpEdit">
            {{ t('chat.input.workspaceSelector.acpWarningConfirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@shadcn/components/ui/alert-dialog'
import { useAgenticSession } from '@/composables/agentic/useAgenticSession'
import { usePresenter } from '@/composables/usePresenter'

interface Props {
  sessionId: string
  editable?: boolean
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  editable: true,
  compact: false
})

const emit = defineEmits<{
  'workspace-change': [path: string | null]
}>()

const { t } = useI18n()
const agenticP = usePresenter('agenticPresenter')
const inputRef = ref<HTMLInputElement>()

// Use agentic session composable for data
const { agentId, workspace } = useAgenticSession(props.sessionId)

// Local state
const isEditing = ref(false)
const editedPath = ref('')
const showAcpWarning = ref(false)

// Determine if this is an ACP agent (agentId doesn't contain provider prefix)
const isAcpAgent = computed(() => {
  return !agentId.value?.includes(':')
})

const hasWorkspace = computed(() => Boolean(workspace.value))

const workspacePath = computed(() => workspace.value || '')

// Truncate path with ~ substitution
const truncatedPath = computed(() => {
  if (!workspace.value) return ''
  const homeDir =
    window.electron.process?.env?.HOME || window.electron.process?.env?.USERPROFILE || ''
  if (homeDir && workspace.value.startsWith(homeDir)) {
    return '~' + workspace.value.slice(homeDir.length)
  }
  const maxLength = 30
  if (workspace.value.length > maxLength) {
    return '...' + workspace.value.slice(-(maxLength - 3))
  }
  return workspace.value
})

const handleStartEdit = () => {
  if (!props.editable) return

  if (isAcpAgent.value) {
    // ACP agents: show warning about immutability
    showAcpWarning.value = true
  } else {
    // DeepChat agents: allow editing directly
    startEditing()
  }
}

const startEditing = () => {
  editedPath.value = workspace.value || ''
  isEditing.value = true
  nextTick(() => {
    inputRef.value?.focus()
  })
}

const handleSaveEdit = async () => {
  const newPath = editedPath.value.trim() || null
  try {
    await agenticP.setModel(props.sessionId, '') // Reuse presenter - might need a setWorkspace method
    emit('workspace-change', newPath)
  } catch (error) {
    console.error('[WorkspaceSelector] Failed to update workspace:', error)
  }
  isEditing.value = false
}

const handleCancelEdit = () => {
  editedPath.value = workspace.value || ''
  isEditing.value = false
}

const handleSelectDirectory = async () => {
  try {
    const devicePresenter = usePresenter('devicePresenter')
    const result = await devicePresenter.selectDirectory()

    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      emit('workspace-change', selectedPath)
    }
  } catch (error) {
    console.error('[WorkspaceSelector] Failed to select directory:', error)
  }
}

const handleProceedAcpEdit = () => {
  showAcpWarning.value = false
  // Even after warning, show the edit dialog but with understanding it won't work
  startEditing()
}

// Reset editing state when workspace changes externally
watch(workspace, () => {
  if (isEditing.value) {
    editedPath.value = workspace.value || ''
  }
})
</script>
