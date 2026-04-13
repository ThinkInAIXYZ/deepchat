<template>
  <div
    :class="[
      'w-full overflow-hidden rounded-xl border bg-card/30 shadow-sm backdrop-blur-lg',
      props.maxWidthClass
    ]"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <input ref="fileInput" type="file" class="hidden" multiple @change="files.handleFileSelect" />

    <div v-if="activeSkillNames.length > 0" class="flex flex-wrap gap-2 px-4 pt-3">
      <div
        v-for="skillName in activeSkillNames"
        :key="skillName"
        class="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary"
      >
        <Icon icon="lucide:sparkles" class="h-3 w-3 shrink-0" />
        <span class="truncate max-w-[160px]">{{ skillName }}</span>
        <button
          type="button"
          class="inline-flex h-4 w-4 items-center justify-center rounded-sm hover:bg-primary/20"
          @click="removeSkill(skillName)"
        >
          <Icon icon="lucide:x" class="h-3 w-3" />
        </button>
      </div>
    </div>

    <div
      v-if="files.selectedFiles.value.length > 0"
      :class="['flex flex-wrap gap-2 px-4', activeSkillNames.length > 0 ? 'pt-2' : 'pt-3']"
    >
      <ChatAttachmentItem
        v-for="(file, index) in files.selectedFiles.value"
        :key="file.path || `${file.name}-${index}`"
        :file="file"
        removable
        @remove="files.deleteFile(index)"
      />
    </div>

    <div
      class="chat-input-editor px-4 pt-4 pb-2 text-sm"
      @keydown="handleKeydown"
      @paste.capture="onPaste"
    >
      <EditorContent
        :editor="editor"
        class="min-h-[60px]"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      />
    </div>

    <slot name="toolbar" />

    <CommandInputDialog
      v-if="dialogState"
      :open="Boolean(dialogState)"
      :title="dialogState?.title || ''"
      :description="dialogState?.description"
      :confirm-text="dialogState?.confirmText"
      :fields="dialogState?.fields || []"
      @update:open="onDialogOpenChange"
      @submit="mentions.submitDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { watch, ref, computed, onUnmounted } from 'vue'
import { Editor as VueEditor, EditorContent } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Placeholder from '@tiptap/extension-placeholder'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import { TextSelection } from '@tiptap/pm/state'
import { Icon } from '@iconify/vue'
import type { MessageFile } from '@shared/types/agent-interface'
import { useI18n } from 'vue-i18n'
import {
  buildChatInputWorkspaceReferenceText,
  getChatInputWorkspaceItemDragData
} from '@/lib/chatInputWorkspaceReference'
import { useChatInputMentions } from './composables/useChatInputMentions'
import { useChatInputFiles } from './composables/useChatInputFiles'
import { useSkillsData } from '@/components/chat-input/composables/useSkillsData'
import CommandInputDialog from './mentions/CommandInputDialog.vue'
import ChatAttachmentItem from './ChatAttachmentItem.vue'

const SlashMention = Mention.extend({
  name: 'slashMention'
})

const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    sessionId?: string | null
    workspacePath?: string | null
    isAcpSession?: boolean
    submitDisabled?: boolean
    maxWidthClass?: string
    files?: MessageFile[]
  }>(),
  {
    modelValue: '',
    placeholder: '',
    sessionId: null,
    workspacePath: null,
    isAcpSession: false,
    submitDisabled: false,
    maxWidthClass: 'max-w-2xl',
    files: () => []
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  'update:files': [files: MessageFile[]]
  'command-submit': [command: string]
  'pending-skills-change': [skills: string[]]
}>()

const isComposing = ref(false)
const fileInput = ref<HTMLInputElement>()
const { t } = useI18n()
const resolvedPlaceholder = computed(() => props.placeholder?.trim() || t('chat.input.placeholder'))
let editorInstance: Editor | null = null
const getEditor = () => editorInstance
const conversationId = computed(() => props.sessionId)
const skillsData = useSkillsData(conversationId)
const activeSkillNames = computed(() => skillsData.activeSkills.value)

const mentions = useChatInputMentions({
  getEditor,
  workspacePath: computed(() => props.workspacePath),
  sessionId: computed(() => props.sessionId),
  isAcpSession: computed(() => props.isAcpSession),
  onCommandSubmit: (command) => emit('command-submit', command),
  onActivateSkill: async (skillName) => {
    await skillsData.activateSkill(skillName)
  }
})
const dialogState = mentions.dialogState
const files = useChatInputFiles(
  fileInput,
  (_event, nextFiles) => {
    emit('update:files', [...nextFiles])
  },
  t
)

const sameFiles = (a: MessageFile[], b: MessageFile[]) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left.name !== right.name) return false
    if ((left.path || '') !== (right.path || '')) return false
    if ((left.mimeType || '') !== (right.mimeType || '')) return false
  }
  return true
}

const toEditorDoc = (text: string) => {
  const lines = text.replace(/\r/g, '').split('\n')
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : []
    }))
  }
}

const getEditorText = (editor: Editor): string => {
  return editor.getText({ blockSeparator: '\n' })
}

const setCaretToEnd = (editor: Editor) => {
  const end = TextSelection.atEnd(editor.state.doc)
  editor.view.dispatch(editor.state.tr.setSelection(end))
}

const editor = new VueEditor({
  editorProps: {
    attributes: {
      class: 'outline-none min-h-[60px] max-h-[240px] overflow-y-auto overscroll-contain'
    }
  },
  extensions: [
    Document,
    Paragraph,
    Text,
    History,
    Mention.configure({
      suggestion: mentions.atSuggestion as any,
      deleteTriggerWithBackspace: true
    }),
    SlashMention.configure({
      suggestion: mentions.slashSuggestion as any,
      deleteTriggerWithBackspace: true
    }),
    Placeholder.configure({
      placeholder: () => resolvedPlaceholder.value
    }),
    HardBreak.extend({
      addKeyboardShortcuts() {
        return {
          'Shift-Enter': () => this.editor.chain().setHardBreak().scrollIntoView().run()
        }
      }
    })
  ],
  content: toEditorDoc(props.modelValue || ''),
  onUpdate: ({ editor }) => {
    const text = getEditorText(editor)
    if (text !== (props.modelValue || '')) {
      emit('update:modelValue', text)
    }
  }
})

editorInstance = editor

watch(
  () => props.modelValue,
  (value) => {
    const next = value || ''
    const current = getEditorText(editor)
    if (next === current) {
      return
    }

    editor.commands.setContent(toEditorDoc(next), false)
    setCaretToEnd(editor)
  }
)

watch(
  () => props.files ?? [],
  (nextFiles) => {
    if (sameFiles(nextFiles, files.selectedFiles.value)) {
      return
    }
    files.selectedFiles.value = [...nextFiles]
  },
  { deep: true, immediate: true }
)

watch(resolvedPlaceholder, () => {
  editor.view.updateState(editor.state)
})

watch(
  () => [...skillsData.pendingSkills.value],
  (pendingSkills) => {
    if (!props.sessionId) {
      emit('pending-skills-change', pendingSkills)
    }
  },
  { immediate: true }
)

watch(
  () => props.sessionId,
  async (sessionId) => {
    if (sessionId) {
      if (skillsData.pendingSkills.value.length > 0) {
        await skillsData.applyPendingSkillsToConversation(sessionId)
      }
      emit('pending-skills-change', [])
      return
    }
    emit('pending-skills-change', [...skillsData.pendingSkills.value])
  },
  { immediate: true }
)

onUnmounted(() => {
  editor.destroy()
})

function removeSkill(skillName: string) {
  void skillsData.deactivateSkill(skillName)
}

function onCompositionStart() {
  isComposing.value = true
}

function onCompositionEnd() {
  isComposing.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) {
    return
  }

  if (mentions.isSuggestionMenuOpen.value || mentions.shouldSuppressSubmit()) {
    return
  }

  if (props.submitDisabled) {
    e.preventDefault()
    return
  }

  const isImeComposing = isComposing.value || e.isComposing || e.keyCode === 229
  if (isImeComposing) {
    return
  }

  e.preventDefault()
  emit('submit')
}

function onDialogOpenChange(open: boolean) {
  if (!open) {
    mentions.closeDialog()
  }
}

function onPaste(event: ClipboardEvent) {
  void files.handlePaste(event, true)
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function insertWorkspaceReference(targetPath: string) {
  const referenceText = buildChatInputWorkspaceReferenceText(
    targetPath,
    props.workspacePath,
    targetPath.split(/[/\\]/).pop()
  )
  if (!referenceText) {
    return false
  }

  const { from, to } = editor.state.selection
  const docSize = editor.state.doc.content.size
  const before =
    from > 0 ? editor.state.doc.textBetween(Math.max(0, from - 1), from, '\n', '\n') : ''
  const after =
    to < docSize ? editor.state.doc.textBetween(to, Math.min(docSize, to + 1), '\n', '\n') : ''
  const prefix = before && !/\s/.test(before) ? ' ' : ''
  const suffix = after && /\s/.test(after) ? '' : ' '

  editor.chain().focus().insertContent(`${prefix}${referenceText}${suffix}`).run()
  return true
}

function onDrop(event: DragEvent) {
  event.preventDefault()

  const workspaceItem = getChatInputWorkspaceItemDragData(event.dataTransfer)
  if (workspaceItem && insertWorkspaceReference(workspaceItem.path)) {
    return
  }

  if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) {
    return
  }
  void files.handleDrop(event.dataTransfer.files)
}

function triggerAttach() {
  files.openFilePicker()
}

function getPendingSkillsSnapshot(): string[] {
  return Array.from(new Set(skillsData.pendingSkills.value))
}

defineExpose({
  triggerAttach,
  getPendingSkillsSnapshot
})
</script>

<style scoped>
:deep(.chat-input-editor .tiptap p.is-editor-empty:first-child::before) {
  color: var(--muted-foreground);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
