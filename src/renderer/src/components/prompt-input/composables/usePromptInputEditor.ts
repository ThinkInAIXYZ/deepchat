// === Vue Core ===
import { ref, nextTick, type Ref } from 'vue'

// === Types ===
import type { Editor, JSONContent } from '@tiptap/vue-3'
import type {
  MessageFile,
  UserMessageCodeBlock,
  UserMessageMentionBlock,
  UserMessageTextBlock
} from '@shared/chat'
import type { ResourceListEntry, PromptListEntry } from '@shared/presenter'
import type { CategorizedData } from '../../editor/mention/suggestion'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

// === Stores ===
import { useMcpStore } from '@/stores/mcp'

// === Utils ===
import { sanitizeText } from '@/lib/sanitizeText'
import { mentionSelected, getPromptFilesHandler } from '../../editor/mention/suggestion'

/**
 * Composable for managing TipTap editor operations
 * Handles editor lifecycle, content transformation, mention insertion, and paste handling
 */
export function usePromptInputEditor(
  editor: Editor,
  selectedFiles: Ref<MessageFile[]>,
  clearHistoryPlaceholder: () => void
) {
  // === Presenters ===
  const filePresenter = usePresenter('filePresenter')

  // === Stores ===
  const mcpStore = useMcpStore()

  // === Local State ===
  const inputText = ref('')
  const fetchingMcpEntry = ref(false)
  let editorPasteHandler: ((e: ClipboardEvent) => void) | null = null

  // === Internal Helper Functions ===
  /**
   * Convert TipTap JSON to MessageBlocks for sending
   */
  const tiptapJSONtoMessageBlock = async (docJSON: JSONContent) => {
    const blocks: (UserMessageMentionBlock | UserMessageTextBlock | UserMessageCodeBlock)[] = []

    if (docJSON.type === 'doc') {
      for (const [idx, block] of (docJSON.content ?? []).entries()) {
        if (block.type === 'paragraph') {
          for (const [index, subBlock] of (block.content ?? []).entries()) {
            if (subBlock.type === 'text') {
              blocks.push({
                type: 'text',
                content: subBlock.text ?? ''
              })
            } else if (subBlock.type === 'hardBreak') {
              if (index > 0 && block.content?.[index - 1]?.type === 'text') {
                blocks[blocks.length - 1].content += '\n'
              } else {
                blocks.push({
                  type: 'text',
                  content: '\n'
                })
              }
            } else if (subBlock.type === 'mention') {
              let content = subBlock.attrs?.label ?? ''

              try {
                if (subBlock.attrs?.category === 'resources' && subBlock.attrs?.content) {
                  fetchingMcpEntry.value = true
                  const mcpEntry = JSON.parse(subBlock.attrs?.content) as ResourceListEntry
                  const mcpEntryResult = await mcpStore.readResource(mcpEntry)

                  if (mcpEntryResult.blob) {
                    const arrayBuffer = await new Blob([mcpEntryResult.blob], {
                      type: mcpEntryResult.mimeType
                    }).arrayBuffer()

                    const tempFilePath = await filePresenter.writeTemp({
                      name: mcpEntry.name ?? 'temp_resource',
                      content: arrayBuffer
                    })

                    const mimeType = await filePresenter.getMimeType(tempFilePath)
                    const fileInfo: MessageFile = await filePresenter.prepareFile(
                      tempFilePath,
                      mimeType
                    )

                    if (fileInfo) {
                      selectedFiles.value.push(fileInfo)
                    }

                    content = mcpEntry.name ?? 'temp_resource'
                  } else {
                    content = mcpEntryResult.text ?? ''
                  }
                }
              } catch (error) {
                console.error('Failed to read resource:', error)
              } finally {
                fetchingMcpEntry.value = false
              }

              if (subBlock.attrs?.category === 'prompts') {
                fetchingMcpEntry.value = true
                try {
                  const promptAttrContent = subBlock.attrs?.content as string
                  if (promptAttrContent) {
                    const promptObject = JSON.parse(promptAttrContent)
                    const promptResult = await mcpStore.getPrompt(
                      promptObject,
                      promptObject.argumentsValue
                    )
                    content = JSON.stringify(promptResult)
                  } else {
                    console.warn('Prompt mention is missing "content" attribute.')
                    content = subBlock.attrs?.label || subBlock.attrs?.id || 'prompt'
                  }
                } catch (error) {
                  console.error('Error processing prompt mention:', error)
                  content = subBlock.attrs?.label || subBlock.attrs?.id || 'prompt'
                } finally {
                  fetchingMcpEntry.value = false
                }
              }

              const newBlock: UserMessageMentionBlock = {
                type: 'mention',
                id: subBlock.attrs?.id ?? '',
                content: content,
                category: subBlock.attrs?.category ?? ''
              }
              blocks.push(newBlock)
            }
          }

          if (idx < (docJSON.content?.length ?? 0) - 1 && idx > 0) {
            blocks.push({ type: 'text', content: '\n' })
          }
        } else if (block.type === 'codeBlock') {
          blocks.push({
            type: 'code',
            content: block.content?.[0]?.text ?? '',
            language: block.content?.[0]?.attrs?.language ?? 'text'
          })
        }
      }
    }

    return blocks
  }

  /**
   * Setup capture-phase paste listener for text sanitization
   */
  const setupEditorPasteHandler = (
    handlePasteCallback: (e: ClipboardEvent, fromCapture: boolean) => void
  ) => {
    try {
      if (editor && editor.view && editor.view.dom) {
        editorPasteHandler = (e: ClipboardEvent) => {
          try {
            ;(e as any)._deepchatHandled = true

            const files = e.clipboardData?.files
            if (files && files.length > 0) {
              e.preventDefault()
              e.stopPropagation()
              void handlePasteCallback(e, true)
              return
            }

            const text = e.clipboardData?.getData('text/plain') || ''

            if (text) {
              e.preventDefault()
              e.stopPropagation()

              const clean = sanitizeText(text)
              const sel = editor.state.selection
              const from = sel.from
              const to = sel.to

              const convertTextToNodes = (txt: string): JSONContent[] => {
                const lines = txt.replace(/\r/g, '').split('\n')
                const content: JSONContent[] = []
                for (let i = 0; i < lines.length; i++) {
                  if (i > 0) content.push({ type: 'hardBreak' })
                  const line = lines[i]
                  if (line.length > 0) content.push({ type: 'text', text: line })
                }
                return content
              }

              editor
                .chain()
                .insertContentAt({ from, to }, convertTextToNodes(clean), { updateSelection: true })
                .scrollIntoView()
                .run()

              inputText.value = editor.getText()
            }
          } catch (err) {
            console.error('editor paste handler error', err)
          }
        }

        editor.view.dom.addEventListener('paste', editorPasteHandler as EventListener, true)
      }
    } catch (err) {
      console.warn('Failed to attach editor paste handler', err)
    }
  }

  /**
   * Cleanup paste handler
   */
  const cleanupEditorPasteHandler = () => {
    try {
      if (editorPasteHandler && editor && editor.view && editor.view.dom) {
        editor.view.dom.removeEventListener('paste', editorPasteHandler as EventListener, true)
        editorPasteHandler = null
      }
    } catch (err) {
      console.warn('Failed to remove editor paste handler', err)
    }
  }

  // === Public Methods ===
  /**
   * Handle Enter key press
   */
  const handleEditorEnter = (
    e: KeyboardEvent,
    disabledSend: boolean,
    emitSend: () => void
  ): void => {
    if (mentionSelected.value) {
      return
    }

    const hasMentionSuggestion = editor.isActive('mention') || document.querySelector('.tippy-box')
    if (hasMentionSuggestion) {
      return
    }

    e.preventDefault()

    if (disabledSend) {
      return
    }

    if (!e.isComposing) {
      emitSend()
    }
  }

  /**
   * Insert mention to editor
   */
  const insertMentionToEditor = (mentionData: CategorizedData, position: number): boolean => {
    try {
      const mentionAttrs = {
        id: mentionData.id,
        label: mentionData.label,
        category: mentionData.category,
        content: mentionData.mcpEntry ? JSON.stringify(mentionData.mcpEntry) : ''
      }

      const success = editor
        .chain()
        .focus()
        .setTextSelection(position)
        .insertContent({
          type: 'mention',
          attrs: mentionAttrs
        })
        .insertContent(' ')
        .run()

      if (success) {
        inputText.value = editor.getText()
      }

      return success
    } catch (error) {
      console.error('Failed to insert mention to editor:', error)
      return false
    }
  }

  /**
   * Handle post-insert actions for mentions (e.g., prompt files)
   */
  const handlePostInsertActions = async (mentionData: CategorizedData): Promise<void> => {
    if (mentionData.category === 'prompts' && mentionData.mcpEntry) {
      const promptEntry = mentionData.mcpEntry as PromptListEntry

      if (promptEntry.files && Array.isArray(promptEntry.files) && promptEntry.files.length > 0) {
        const handler = getPromptFilesHandler()
        if (handler) {
          await handler(promptEntry.files).catch((error) => {
            console.error('Failed to handle prompt files:', error)
          })
        }
      }
    }
  }

  /**
   * Find mention by name
   */
  const findMentionByName = (
    name: string,
    mentionData: Ref<CategorizedData[]>
  ): CategorizedData | null => {
    const foundMention = mentionData.value.find(
      (item) => item.type === 'item' && (item.label === name || item.id === name)
    )
    return foundMention || null
  }

  /**
   * Clear editor content
   */
  const clearContent = () => {
    inputText.value = ''
    editor.chain().clearContent().run()
    editor.view.updateState(editor.state)
  }

  /**
   * Append text to editor
   */
  const appendText = (text: string) => {
    inputText.value += text
    nextTick(() => {
      editor.chain().insertContent(text).run()
      editor.view.updateState(editor.state)
      setTimeout(() => {
        const docSize = editor.state.doc.content.size
        editor.chain().focus().setTextSelection(docSize).run()
      }, 10)
    })
  }

  /**
   * Append mention to editor
   */
  const appendMention = async (
    name: string,
    mentionData: Ref<CategorizedData[]>
  ): Promise<boolean> => {
    try {
      const mention = findMentionByName(name, mentionData)

      if (!mention) {
        console.warn(`Mention not found: ${name}`)
        return false
      }

      const insertPosition = editor.state.selection.anchor
      const insertSuccess = insertMentionToEditor(mention, insertPosition)

      if (insertSuccess) {
        await handlePostInsertActions(mention)
      }

      return insertSuccess
    } catch (error) {
      console.error('Failed to append mention:', error)
      return false
    }
  }

  /**
   * Restore focus to editor
   */
  const restoreFocus = () => {
    nextTick(() => {
      if (editor && !editor.isDestroyed) {
        try {
          const editorElement = editor.view.dom
          if (editorElement && editorElement.offsetParent !== null) {
            editor.commands.focus()
          }
        } catch (error) {
          console.warn('Failed to restore focus:', error)
        }
      }
    })
  }

  /**
   * Update input text when editor changes
   */
  const onEditorUpdate = () => {
    inputText.value = editor.getText()

    if (inputText.value.trim() && clearHistoryPlaceholder) {
      clearHistoryPlaceholder()
    }
  }

  // === Return Public API ===
  return {
    // State
    inputText,
    fetchingMcpEntry,

    // Methods
    tiptapJSONtoMessageBlock,
    handleEditorEnter,
    insertMentionToEditor,
    handlePostInsertActions,
    findMentionByName,
    clearContent,
    appendText,
    appendMention,
    restoreFocus,
    onEditorUpdate,
    setupEditorPasteHandler,
    cleanupEditorPasteHandler
  }
}
