<template>
  <div
    v-bind="attrs"
    class="sticky top-0 z-10 flex items-center justify-between h-12 px-4 bg-background/60 backdrop-blur-lg window-drag-region"
  >
    <div class="flex items-center gap-2 min-w-0">
      <Button
        v-if="parentSessionId"
        variant="ghost"
        size="sm"
        class="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        :title="t('chat.topbar.backToParent')"
        @click="handleBackToParent"
      >
        <Icon icon="lucide:corner-up-left" class="h-3.5 w-3.5" />
        <span>{{ t('chat.topbar.backToParent') }}</span>
      </Button>
      <div v-if="project" class="flex items-center gap-1.5 text-muted-foreground">
        <Icon icon="lucide:folder" class="w-3.5 h-3.5 shrink-0" />
        <span class="text-xs truncate">{{ projectName }}</span>
        <Icon icon="lucide:chevron-right" class="w-3 h-3 shrink-0" />
      </div>
      <h2 class="text-sm font-medium truncate">{{ title }}</h2>
    </div>

    <div class="flex items-center gap-1 no-drag">
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-muted-foreground hover:text-foreground"
        :title="t('chat.workspace.title')"
        @click="sidepanelStore.toggleWorkspace(props.sessionId)"
      >
        <Icon icon="lucide:folder-tree" class="w-4 h-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
            :title="t('chat.topbar.share')"
          >
            <Icon icon="lucide:share" class="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" class="w-52">
          <DropdownMenuItem @select="handleExport('markdown')">
            <Icon icon="lucide:file-text" class="mr-2 h-4 w-4" />
            <span>{{ t('artifacts.markdownDocument') }} (.md)</span>
          </DropdownMenuItem>
          <DropdownMenuItem @select="handleExport('html')">
            <Icon icon="lucide:globe" class="mr-2 h-4 w-4" />
            <span>{{ t('artifacts.htmlDocument') }} (.html)</span>
          </DropdownMenuItem>
          <DropdownMenuItem @select="handleExport('txt')">
            <Icon icon="lucide:file-type" class="mr-2 h-4 w-4" />
            <span>{{ t('thread.actions.exportText') }} (.txt)</span>
          </DropdownMenuItem>
          <DropdownMenuItem @select="handleExport('nowledge-mem')">
            <Icon icon="lucide:brain" class="mr-2 h-4 w-4" />
            <span>{{ t('thread.actions.exportNowledgeMem') }} (.json)</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
            :title="t('chat.topbar.more')"
          >
            <Icon icon="lucide:ellipsis" class="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem @select="handleTogglePin">
            <Icon :icon="isPinned ? 'lucide:pin-off' : 'lucide:pin'" class="mr-2 h-4 w-4" />
            <span>{{ isPinned ? t('thread.actions.unpin') : t('thread.actions.pin') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem @select="openRenameDialog">
            <Icon icon="lucide:pencil" class="mr-2 h-4 w-4" />
            <span>{{ t('thread.actions.rename') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem @select="openClearDialog">
            <Icon icon="lucide:eraser" class="mr-2 h-4 w-4" />
            <span>{{ t('thread.actions.cleanMessages') }}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive" @select="openDeleteDialog">
            <Icon icon="lucide:trash-2" class="mr-2 h-4 w-4" />
            <span>{{ t('thread.actions.delete') }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>

  <Dialog v-model:open="renameDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.rename.title') }}</DialogTitle>
        <DialogDescription>{{ t('dialog.rename.description') }}</DialogDescription>
      </DialogHeader>
      <Input v-model="renameValue" />
      <DialogFooter>
        <Button variant="outline" @click="renameDialogOpen = false">{{
          t('dialog.cancel')
        }}</Button>
        <Button variant="default" @click="handleRenameConfirm">{{ t('dialog.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="clearDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.cleanMessages.title') }}</DialogTitle>
        <DialogDescription>{{ t('dialog.cleanMessages.description') }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="clearDialogOpen = false">{{ t('dialog.cancel') }}</Button>
        <Button variant="destructive" @click="handleClearConfirm">{{
          t('dialog.cleanMessages.confirm')
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="deleteDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.delete.title') }}</DialogTitle>
        <DialogDescription>{{ t('dialog.delete.description') }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="deleteDialogOpen = false">{{
          t('dialog.cancel')
        }}</Button>
        <Button variant="destructive" @click="handleDeleteConfirm">{{
          t('dialog.delete.confirm')
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { useSessionStore } from '@/stores/ui/session'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useToast } from '@/components/use-toast'

defineOptions({
  inheritAttrs: false
})

const props = defineProps<{
  sessionId: string
  title: string
  project: string
}>()

const attrs = useAttrs()
const { t } = useI18n()
const sessionStore = useSessionStore()
const sidepanelStore = useSidepanelStore()
const { toast } = useToast()

const renameDialogOpen = ref(false)
const clearDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const renameValue = ref('')

const projectName = computed(() => props.project.split('/').pop() ?? props.project)
const currentSession = computed(
  () => sessionStore.sessions.find((session) => session.id === props.sessionId) ?? null
)
const parentSessionId = computed(() => currentSession.value?.parentSessionId ?? null)
const isPinned = computed(() => Boolean(currentSession.value?.isPinned))

const openRenameDialog = () => {
  renameValue.value = currentSession.value?.title ?? props.title
  renameDialogOpen.value = true
}

const openClearDialog = () => {
  clearDialogOpen.value = true
}

const openDeleteDialog = () => {
  deleteDialogOpen.value = true
}

const handleTogglePin = async () => {
  try {
    await sessionStore.toggleSessionPinned(props.sessionId, !isPinned.value)
  } catch (error) {
    console.error('Failed to toggle pin status:', error)
  }
}

const handleRenameConfirm = async () => {
  try {
    await sessionStore.renameSession(props.sessionId, renameValue.value)
  } catch (error) {
    console.error(t('common.error.renameChatFailed'), error)
  }

  renameDialogOpen.value = false
}

const handleClearConfirm = async () => {
  try {
    await sessionStore.clearSessionMessages(props.sessionId)
  } catch (error) {
    console.error(t('common.error.cleanMessagesFailed'), error)
  }

  clearDialogOpen.value = false
}

const handleDeleteConfirm = async () => {
  try {
    await sessionStore.deleteSession(props.sessionId)
  } catch (error) {
    console.error(t('common.error.deleteChatFailed'), error)
  }

  deleteDialogOpen.value = false
}

const handleExport = async (format: 'markdown' | 'html' | 'txt' | 'nowledge-mem') => {
  try {
    await sessionStore.exportSession(props.sessionId, format)

    const isNowledgeMem = format === 'nowledge-mem'
    toast({
      title: isNowledgeMem ? t('thread.export.nowledgeMemSuccess') : t('thread.export.success'),
      description: isNowledgeMem
        ? t('thread.export.nowledgeMemSuccessDesc')
        : t('thread.export.successDesc'),
      variant: 'default'
    })
  } catch (error) {
    console.error('Export failed:', error)
    toast({
      title: t('thread.export.failed'),
      description: t('thread.export.failedDesc'),
      variant: 'destructive'
    })
  }
}

const handleBackToParent = async () => {
  if (!parentSessionId.value) {
    return
  }

  try {
    await sessionStore.selectSession(parentSessionId.value)
  } catch (error) {
    console.error('Failed to navigate to parent session:', error)
  }
}
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

button {
  -webkit-app-region: no-drag;
}
</style>
