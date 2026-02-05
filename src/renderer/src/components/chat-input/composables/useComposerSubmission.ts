import type { Ref } from 'vue'
import type { Editor, JSONContent } from '@tiptap/vue-3'
import type {
  MessageFile,
  UserMessageCodeBlock,
  UserMessageContent,
  UserMessageMentionBlock,
  UserMessageTextBlock
} from '@shared/chat'

type ComposerSubmissionOptions = {
  editor: Editor
  inputText: Ref<string>
  selectedFiles: Ref<MessageFile[]>
  deepThinking: Ref<boolean>
  buildBlocks: (
    doc: JSONContent
  ) => Promise<(UserMessageTextBlock | UserMessageMentionBlock | UserMessageCodeBlock)[]>
}

export function useComposerSubmission(options: ComposerSubmissionOptions) {
  const buildMessageContent = async (): Promise<UserMessageContent | null> => {
    const text = options.inputText.value.trim()
    if (!text) return null

    const blocks = await options.buildBlocks(options.editor.getJSON())

    return {
      text,
      files: options.selectedFiles.value,
      links: [],
      search: false,
      think: options.deepThinking.value,
      content: blocks
    }
  }

  return {
    buildMessageContent
  }
}
