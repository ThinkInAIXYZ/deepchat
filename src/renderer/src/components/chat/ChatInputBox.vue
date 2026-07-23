<template>
  <div
    data-testid="chat-input-box"
    :class="['w-full overflow-hidden rounded-xl border bg-card/30 shadow-sm', props.maxWidthClass]"
    style="
      backdrop-filter: blur(var(--dc-blur-panel));
      -webkit-backdrop-filter: blur(var(--dc-blur-panel));
    "
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <input ref="fileInput" type="file" class="hidden" multiple @change="onFileSelect" />

    <div
      data-testid="chat-input-editor"
      :class="[
        'chat-input-editor px-4 pt-4 pb-2 text-sm',
        editable ? '' : 'pointer-events-none opacity-80'
      ]"
      :aria-disabled="!editable"
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

    <div
      v-if="isAttachmentPreparationPending"
      data-testid="attachment-preparation-pending"
      class="flex items-center gap-2 border-t border-border/50 px-4 py-2 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Spinner class="size-3.5" />
      <span>{{ t('chat.attachments.preparing') }}</span>
    </div>

    <slot name="toolbar" />
  </div>
</template>

<script setup lang="ts">
import { watch, ref, computed, onUnmounted, provide, nextTick } from 'vue'
import { Editor as VueEditor, EditorContent } from '@tiptap/vue-3'
import type { Editor, JSONContent } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Placeholder from '@tiptap/extension-placeholder'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import { TextSelection } from '@tiptap/pm/state'
import type { MessageFile, UserMessageInlineItem } from '@shared/types/agent-interface'
import { useI18n } from 'vue-i18n'
import { Spinner } from '@shadcn/components/ui/spinner'
import {
  buildChatInputWorkspaceReferenceText,
  getChatInputWorkspaceItemDragData
} from '@/lib/chatInputWorkspaceReference'
import { extractPlainUrlFromClipboard } from '@/lib/clipboardUrlPaste'
import { useChatInputMentions } from './composables/useChatInputMentions'
import { useChatInputFiles } from './composables/useChatInputFiles'
import { useSkillsData } from '@/components/chat-input/composables/useSkillsData'
import { SkillChip } from './nodes/skillChip'
import { FileAttachment } from './nodes/fileAttachment'
import { CommandForm } from './nodes/commandForm'
import { INPUT_NODE_ACTIONS, type InputNodeActions } from './nodes/symbols'

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
    isGenerating?: boolean
    editable?: boolean
    submitDisabled?: boolean
    queueSubmitEnabled?: boolean
    queueSubmitDisabled?: boolean
    isAttachmentPreparationPending?: boolean
    maxWidthClass?: string
    files?: MessageFile[]
  }>(),
  {
    modelValue: '',
    placeholder: '',
    sessionId: null,
    workspacePath: null,
    isAcpSession: false,
    isGenerating: false,
    editable: true,
    submitDisabled: false,
    queueSubmitEnabled: false,
    queueSubmitDisabled: false,
    isAttachmentPreparationPending: false,
    maxWidthClass: 'max-w-2xl',
    files: () => []
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  'queue-submit': []
  'update:files': [files: MessageFile[]]
  'command-submit': [command: string]
  'pending-skills-change': [skills: string[]]
  'draft-change': []
  'toggle-voice-input': []
}>()

const isComposing = ref(false)
const fileInput = ref<HTMLInputElement>()
const { t } = useI18n()
const resolvedPlaceholder = computed(() => props.placeholder?.trim() || t('chat.input.placeholder'))
let editorInstance: Editor | null = null
const getEditor = () => editorInstance
const conversationId = computed(() => props.sessionId)
const skillsData = useSkillsData(conversationId)
const activeSkillNames = computed(() => skillsData.composerActiveSkills.value)

const mentions = useChatInputMentions({
  getEditor,
  workspacePath: computed(() => props.workspacePath),
  sessionId: computed(() => props.sessionId),
  isAcpSession: computed(() => props.isAcpSession),
  isGenerating: computed(() => props.isGenerating),
  compactCommandDescription: computed(() => t('chat.compaction.commandDescription')),
  onCommandSubmit: (command) => {
    if (!props.editable) return
    emit('command-submit', command)
  },
  onActivateSkill: async (skillName) => {
    if (!props.editable) return
    await skillsData.activateSkill(skillName)
  }
})

const files = useChatInputFiles(
  fileInput,
  (_event, nextFiles) => {
    emit('update:files', [...nextFiles])
  },
  t
)

// ── Inline Node action wiring ──────────────────────────────────
let isSyncingNodes = false
let isSubmittingCommandForm = false

const actions: InputNodeActions = {
  prepareCommandFormSubmit: () => {
    if (!props.editable) return
    isSubmittingCommandForm = true
  },
  removeSkill: (skillName) => {
    if (!props.editable) return
    void skillsData.deactivateSkill(skillName)
  },
  removeFile: (filePath) => {
    if (!props.editable) return
    const idx = files.selectedFiles.value.findIndex((f) => (f.path || f.name) === filePath)
    if (idx >= 0) {
      files.deleteFile(idx)
    }
  },
  setFileRepresentation: (filePath, preference) => {
    if (!props.editable) return
    const idx = files.selectedFiles.value.findIndex((f) => (f.path || f.name) === filePath)
    if (idx >= 0) {
      files.updateFile(idx, { requestedRepresentation: preference })
    }
  },
  submitCommandForm: (values) => {
    if (!props.editable) return
    mentions.submitDialog(values)
  },
  cancelCommandForm: () => {
    mentions.closeDialog()
  }
}

provide(INPUT_NODE_ACTIONS, actions)

// ── Editor helpers ─────────────────────────────────────────────

const sameFiles = (a: MessageFile[], b: MessageFile[]) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left.name !== right.name) return false
    if ((left.path || '') !== (right.path || '')) return false
    if ((left.mimeType || '') !== (right.mimeType || '')) return false
    if ((left.requestedRepresentation || 'auto') !== (right.requestedRepresentation || 'auto')) {
      return false
    }
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

type InlineNodeRange = { pos: number; size: number }
const CHAT_INPUT_SYNC_META = 'chatInputSync'

function syncEditorContent(applyChange: () => void) {
  isSyncingNodes = true
  try {
    applyChange()
  } finally {
    isSyncingNodes = false
  }
}

function deleteInlineNodes(ranges: InlineNodeRange[]) {
  if (ranges.length === 0) return

  let tr = editor.state.tr
  ranges
    .sort((a, b) => b.pos - a.pos)
    .forEach(({ pos, size }) => {
      tr = tr.delete(pos, pos + size)
    })

  editor.view.dispatch(tr.setMeta(CHAT_INPUT_SYNC_META, true).setMeta('addToHistory', false))
}

function getEditorSkillNames(): string[] {
  const names: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'skillChip') {
      names.push(node.attrs.skillName as string)
    }
  })
  return names
}

function getEditorFilePaths(): string[] {
  const paths: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'fileAttachment') {
      paths.push(node.attrs.filePath as string)
    }
  })
  return paths
}

function hasCommandFormNode(): boolean {
  let hasForm = false
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'commandForm') {
      hasForm = true
      return false
    }
    return true
  })
  return hasForm
}

function reconcileEditorNodes() {
  if (isSyncingNodes) return

  const editorSkillNames = new Set(getEditorSkillNames())
  activeSkillNames.value
    .filter((name) => !editorSkillNames.has(name))
    .forEach((name) => {
      void skillsData.deactivateSkill(name)
    })

  const editorFilePaths = new Set(getEditorFilePaths())
  for (let i = files.selectedFiles.value.length - 1; i >= 0; i -= 1) {
    const file = files.selectedFiles.value[i]
    if (!editorFilePaths.has(file.path || file.name)) {
      files.deleteFile(i)
    }
  }

  if (!hasCommandFormNode() && !isSubmittingCommandForm) {
    mentions.closeDialog()
  }
}

/** Ensure editor SkillChip nodes mirror skillsData.activeSkills */
function syncSkillNodes() {
  if (isSyncingNodes) return

  syncEditorContent(() => {
    const active = activeSkillNames.value
    const existing = new Map<string, InlineNodeRange>()

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'skillChip') {
        existing.set(node.attrs.skillName as string, { pos, size: node.nodeSize })
      }
    })

    deleteInlineNodes(
      Array.from(existing.entries())
        .filter(([name]) => !active.includes(name))
        .map(([, range]) => range)
    )

    const newSkillNodes = active
      .filter((name) => !existing.has(name))
      .map((name) => ({
        type: 'skillChip',
        attrs: { skillName: name }
      }))

    if (newSkillNodes.length > 0) {
      editor
        .chain()
        .insertContentAt(editor.state.selection.from, newSkillNodes, { updateSelection: false })
        .run()
    }
  })
}

/** Ensure editor FileAttachment nodes mirror files.selectedFiles */
function syncFileNodes() {
  if (isSyncingNodes) return

  syncEditorContent(() => {
    const currentFiles = files.selectedFiles.value
    const existing = new Map<string, InlineNodeRange>()

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'fileAttachment') {
        const path = node.attrs.filePath as string
        existing.set(path, { pos, size: node.nodeSize })
      }
    })

    const currentPaths = new Set(currentFiles.map((f) => f.path || f.name))

    deleteInlineNodes(
      Array.from(existing.entries())
        .filter(([path]) => !currentPaths.has(path))
        .map(([, range]) => range)
    )

    const newFileNodes = currentFiles
      .filter((file) => !existing.has(file.path || file.name))
      .map((file) => {
        const path = file.path || file.name
        return {
          type: 'fileAttachment',
          attrs: {
            fileName: file.name || 'file',
            filePath: path,
            mimeType: file.mimeType || '',
            requestedRepresentation: file.requestedRepresentation || 'auto'
          }
        }
      })

    if (newFileNodes.length > 0) {
      editor
        .chain()
        .insertContentAt(findFileInsertPos(), newFileNodes, { updateSelection: false })
        .run()
    }
  })
}

function findFileInsertPos(): number {
  let maxEnd = 1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'fileAttachment') {
      maxEnd = pos + node.nodeSize
    }
  })
  return maxEnd
}

// ── Editor setup ───────────────────────────────────────────────

const editor = new VueEditor({
  editable: props.editable,
  editorProps: {
    attributes: {
      'data-testid': 'chat-input-contenteditable',
      class: 'outline-none min-h-[60px] max-h-[240px] overflow-y-auto overscroll-contain'
    }
  },
  extensions: [
    Document,
    Paragraph,
    Text,
    History,
    SkillChip,
    FileAttachment,
    CommandForm,
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
  onUpdate: ({ editor, transaction }) => {
    const isInternalSync = Boolean(transaction.getMeta(CHAT_INPUT_SYNC_META) || isSyncingNodes)
    if (!isInternalSync) {
      reconcileEditorNodes()
    }
    isSubmittingCommandForm = false

    // File/skill chip reconciliation changes the TipTap document without changing the user's
    // typed text. During submit, the parent clears modelValue and files in the same tick; if the
    // file-node removal emits the old text here, it can restore the just-sent draft.
    if (isInternalSync) {
      return
    }

    const text = getEditorText(editor)
    if (text !== (props.modelValue || '')) {
      emit('update:modelValue', text)
    }
    emit('draft-change')
  }
})

editorInstance = editor

// ── Watchers ───────────────────────────────────────────────────

watch(
  () => props.editable,
  (editable) => {
    editor.setEditable(editable)
  }
)

watch(
  () => props.modelValue,
  (value) => {
    const next = value || ''
    const current = getEditorText(editor)
    if (next === current) return

    syncEditorContent(() => {
      editor.commands.setContent(toEditorDoc(next), false)
      setCaretToEnd(editor)
    })

    // Re-sync chips after content replacement
    void nextTick(() => {
      syncSkillNodes()
      syncFileNodes()
    })
  }
)

watch(
  () => props.files ?? [],
  (nextFiles) => {
    if (sameFiles(nextFiles, files.selectedFiles.value)) return
    files.selectedFiles.value = [...nextFiles]
  },
  { deep: true, immediate: true }
)

// Sync files → editor nodes
watch(
  () => [...files.selectedFiles.value],
  () => {
    syncFileNodes()
  },
  { deep: true, immediate: true }
)

// Sync skills → editor nodes
watch(
  () => [...activeSkillNames.value],
  () => {
    syncSkillNodes()
  },
  { deep: true, immediate: true }
)

watch(resolvedPlaceholder, () => {
  editor.view.updateState(editor.state)
})

watch(
  () => [...skillsData.pendingSkills.value],
  (pendingSkills) => {
    emit('pending-skills-change', pendingSkills)
  },
  { immediate: true }
)

watch(
  () => props.sessionId,
  () => {
    emit('pending-skills-change', [...skillsData.pendingSkills.value])
  },
  { immediate: true }
)

onUnmounted(() => {
  editor.destroy()
})

// ── Event handlers ─────────────────────────────────────────────

function onCompositionStart() {
  isComposing.value = true
}

function onCompositionEnd() {
  isComposing.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (!props.editable) {
    const isCopyOrSelectAll = (e.metaKey || e.ctrlKey) && ['a', 'c'].includes(e.key.toLowerCase())
    const isNavigationKey = [
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'End',
      'Escape',
      'Home',
      'PageDown',
      'PageUp',
      'Tab'
    ].includes(e.key)
    if (!isCopyOrSelectAll && !isNavigationKey) {
      e.preventDefault()
    }
    return
  }

  const isVoiceShortcut = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm'
  if (isVoiceShortcut) {
    e.preventDefault()
    emit('toggle-voice-input')
    return
  }

  const isPlainTab = e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
  if (isPlainTab && props.queueSubmitEnabled && !props.queueSubmitDisabled) {
    if (mentions.isSuggestionMenuOpen.value || mentions.shouldSuppressSubmit()) {
      return
    }
    e.preventDefault()
    emit('queue-submit')
    return
  }

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

function onPaste(event: ClipboardEvent) {
  if (!props.editable) {
    event.preventDefault()
    return
  }

  void files.handlePaste(event, true)

  if (event.clipboardData?.files && event.clipboardData.files.length > 0) {
    return
  }

  const pastedUrl = extractPlainUrlFromClipboard(event.clipboardData)
  if (!pastedUrl) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  editor.chain().focus().insertContent(pastedUrl).run()
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = props.editable ? 'copy' : 'none'
  }
}

function insertWorkspaceReference(targetPath: string) {
  if (!props.editable) return false

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
  if (!props.editable) return

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
  if (!props.editable) return
  files.openFilePicker()
}

function insertRecognizedText(text: string) {
  if (!props.editable) return
  const normalizedText = text.trim()
  if (!normalizedText) {
    return
  }

  editor.chain().focus().insertContent(normalizedText).run()
}

function onFileSelect(event: Event) {
  if (!props.editable) {
    ;(event.target as HTMLInputElement).value = ''
    return
  }
  void files.handleFileSelect(event)
}

function getInlineItemsSnapshot(): UserMessageInlineItem[] {
  const inlineItems: UserMessageInlineItem[] = []
  let offset = 0

  editor.state.doc.forEach((block, _blockOffset, blockIndex) => {
    if (blockIndex > 0) {
      offset += 1
    }

    block.forEach((node) => {
      if (node.type.name === 'text') {
        offset += node.text?.length ?? 0
        return
      }

      if (node.type.name === 'hardBreak') {
        offset += 1
        return
      }

      if (node.type.name === 'skillChip') {
        inlineItems.push({
          type: 'skill',
          offset,
          skillName: node.attrs.skillName as string
        })
        return
      }

      if (node.type.name === 'fileAttachment') {
        inlineItems.push({
          type: 'file',
          offset,
          fileName: node.attrs.fileName as string,
          filePath: node.attrs.filePath as string,
          mimeType: node.attrs.mimeType as string
        })
      }
    })
  })

  return inlineItems
}

function getPendingSkillsSnapshot(): string[] {
  return Array.from(new Set(skillsData.pendingSkills.value))
}

function consumePendingSkills(): string[] {
  return Array.from(new Set(skillsData.consumePendingSkills()))
}

function clearPendingSkills() {
  skillsData.clearPendingSkills()
}

function setPendingSkills(skillNames: string[]) {
  skillsData.pendingSkills.value = Array.from(
    new Set(skillNames.map((skillName) => skillName.trim()).filter(Boolean))
  )
}

function getDocumentSnapshot(): JSONContent {
  return editor.getJSON()
}

function restoreDocumentSnapshot(document: JSONContent) {
  syncEditorContent(() => {
    editor.commands.setContent(document, false)
    setCaretToEnd(editor)
  })
  void nextTick(() => {
    syncSkillNodes()
    syncFileNodes()
  })
}

function focusInput() {
  editor.chain().focus().scrollIntoView().run()
  setCaretToEnd(editor)
}

defineExpose({
  triggerAttach,
  insertRecognizedText,
  insertWorkspaceReference,
  getInlineItemsSnapshot,
  getPendingSkillsSnapshot,
  consumePendingSkills,
  clearPendingSkills,
  setPendingSkills,
  getDocumentSnapshot,
  restoreDocumentSnapshot,
  focusInput
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
