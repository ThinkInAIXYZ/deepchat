<template>
  <div class="space-y-3">
    <div class="flex flex-row items-center gap-2">
      <div class="flex-1">
        <Label class="text-sm font-medium flex-1">
          {{ t('promptSetting.defaultSystemPrompt') }}
        </Label>
        <p class="text-xs text-muted-foreground">
          {{ t('promptSetting.systemPromptDescription') }}
        </p>
      </div>

      <Select v-model="selectedSystemPromptId" @update:model-value="handleSystemPromptChange">
        <SelectTrigger class="w-32 border-border hover:bg-accent h-8!">
          <SelectValue :placeholder="t('promptSetting.selectSystemPrompt')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="prompt in systemPrompts" :key="prompt.id" :value="prompt.id">
            {{ prompt.name }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon-sm" @click="openCreatePrompt">
        <Icon icon="lucide:plus" class="w-4 h-4" />
      </Button>
    </div>

    <div v-if="currentSystemPrompt" class="space-y-2">
      <Textarea
        v-model="currentSystemPrompt.content"
        class="w-full h-48"
        :placeholder="t('promptSetting.contentPlaceholder')"
        @blur="saveCurrentSystemPrompt"
      />
      <div class="flex items-center gap-2">
        <Button
          v-if="currentSystemPrompt.id === 'default'"
          variant="outline"
          size="sm"
          @click="resetDefaultSystemPrompt"
        >
          <Icon icon="lucide:rotate-ccw" class="w-3.5 h-3.5 mr-1" />
          {{ t('promptSetting.resetToDefault') }}
        </Button>
        <AlertDialog v-else>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              class="text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Icon icon="lucide:trash-2" class="w-3.5 h-3.5 mr-1" />
              {{ t('common.delete') }}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {{
                  t('promptSetting.confirmDeleteSystemPrompt', {
                    name: currentSystemPrompt.name
                  })
                }}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {{ t('promptSetting.confirmDeleteSystemPromptDescription') }}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
              <AlertDialogAction @click="deleteSystemPrompt(currentSystemPrompt.id)">
                {{ t('common.confirm') }}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>

    <SystemPromptEditorSheet
      :open="systemPromptEditorOpen"
      :prompt="editingSystemPrompt"
      @update:open="handleEditorOpenChange"
      @save="handleSaveSystemPrompt"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { useToast } from '@/components/use-toast'
import { useSettingsStore } from '@/stores/settings'
import { Button } from '@shadcn/components/ui/button'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@shadcn/components/ui/alert-dialog'
import type { AcceptableValue } from 'reka-ui'
import SystemPromptEditorSheet from './SystemPromptEditorSheet.vue'

interface SystemPromptItem {
  id: string
  name: string
  content: string
  isDefault?: boolean
  createdAt?: number
  updatedAt?: number
}

const { t } = useI18n()
const { toast } = useToast()
const settingsStore = useSettingsStore()

const systemPrompts = ref<SystemPromptItem[]>([])
const selectedSystemPromptId = ref('')
const currentSystemPrompt = ref<SystemPromptItem | null>(null)
const systemPromptEditorOpen = ref(false)
const editingSystemPrompt = ref<SystemPromptItem | null>(null)

const loadSystemPrompts = async () => {
  try {
    systemPrompts.value = await settingsStore.getSystemPrompts()
    selectedSystemPromptId.value = await settingsStore.getDefaultSystemPromptId()
    updateCurrentSystemPrompt()
  } catch (error) {
    console.error('Failed to load system prompts:', error)
  }
}

const updateCurrentSystemPrompt = () => {
  currentSystemPrompt.value =
    systemPrompts.value.find((prompt) => prompt.id === selectedSystemPromptId.value) || null
}

const handleSystemPromptChange = async (promptId: AcceptableValue) => {
  try {
    await settingsStore.setDefaultSystemPromptId(promptId as string)
    selectedSystemPromptId.value = promptId as string
    updateCurrentSystemPrompt()
  } catch (error) {
    console.error('Failed to change default system prompt:', error)
    toast({
      title: t('promptSetting.systemPromptSaveFailed'),
      variant: 'destructive'
    })
  }
}

const saveCurrentSystemPrompt = async () => {
  if (!currentSystemPrompt.value) return

  try {
    await settingsStore.updateSystemPrompt(currentSystemPrompt.value.id, {
      content: currentSystemPrompt.value.content,
      updatedAt: Date.now()
    })

    const index = systemPrompts.value.findIndex(
      (prompt) => prompt.id === currentSystemPrompt.value!.id
    )
    if (index !== -1) {
      systemPrompts.value[index].content = currentSystemPrompt.value.content
      systemPrompts.value[index].updatedAt = Date.now()
    }

    toast({
      title: t('promptSetting.systemPromptUpdated'),
      variant: 'default'
    })
  } catch (error) {
    console.error('Failed to save system prompt:', error)
    toast({
      title: t('promptSetting.systemPromptSaveFailed'),
      variant: 'destructive'
    })
  }
}

const resetDefaultSystemPrompt = async () => {
  try {
    const originalContent = `You are DeepChat, a highly capable AI assistant. Your goal is to fully complete the user's requested task before handing the conversation back to them. Keep working autonomously until the task is fully resolved.
Be thorough in gathering information. Before replying, make sure you have all the details necessary to provide a complete solution. Use additional tools or ask clarifying questions when needed, but if you can find the answer on your own, avoid asking the user for help.
When using tools, briefly describe your intended steps first—for example, which tool you'll use and for what purpose.
Adhere to this in all languages.Always respond in the same language as the user's query.`

    await settingsStore.updateSystemPrompt('default', {
      content: originalContent,
      updatedAt: Date.now()
    })

    if (currentSystemPrompt.value && currentSystemPrompt.value.id === 'default') {
      currentSystemPrompt.value.content = originalContent
    }

    const index = systemPrompts.value.findIndex((prompt) => prompt.id === 'default')
    if (index !== -1) {
      systemPrompts.value[index].content = originalContent
      systemPrompts.value[index].updatedAt = Date.now()
    }

    toast({
      title: t('promptSetting.resetToDefaultSuccess'),
      variant: 'default'
    })
  } catch (error) {
    console.error('Failed to reset system prompt:', error)
    toast({
      title: t('promptSetting.resetToDefaultFailed'),
      variant: 'destructive'
    })
  }
}

const deleteSystemPrompt = async (promptId: string) => {
  try {
    await settingsStore.deleteSystemPrompt(promptId)
    await loadSystemPrompts()
    toast({
      title: t('promptSetting.systemPromptDeleted'),
      variant: 'default'
    })
  } catch (error) {
    console.error('Failed to delete system prompt:', error)
    toast({
      title: t('promptSetting.systemPromptDeleteFailed'),
      variant: 'destructive'
    })
  }
}

const openCreatePrompt = () => {
  editingSystemPrompt.value = null
  systemPromptEditorOpen.value = true
}

const handleEditorOpenChange = (open: boolean) => {
  systemPromptEditorOpen.value = open
  if (!open) {
    editingSystemPrompt.value = null
  }
}

const handleSaveSystemPrompt = async ({
  id,
  name,
  content
}: {
  id?: string
  name: string
  content: string
}) => {
  const timestamp = Date.now()

  try {
    if (id) {
      await settingsStore.updateSystemPrompt(id, {
        name,
        content,
        updatedAt: timestamp
      })
    } else {
      const newId = timestamp.toString()
      const newPrompt = {
        id: newId,
        name,
        content,
        isDefault: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      await settingsStore.addSystemPrompt(newPrompt)
      await settingsStore.setDefaultSystemPromptId(newId)
    }

    await loadSystemPrompts()
    systemPromptEditorOpen.value = false
    editingSystemPrompt.value = null

    toast({
      title: id
        ? t('promptSetting.systemPromptUpdated')
        : t('promptSetting.systemPromptAddedAndSwitched'),
      variant: 'default'
    })
  } catch (error) {
    console.error('Failed to save system prompt:', error)
    toast({
      title: t('promptSetting.systemPromptSaveFailed'),
      variant: 'destructive'
    })
  }
}

onMounted(async () => {
  await loadSystemPrompts()
})
</script>
