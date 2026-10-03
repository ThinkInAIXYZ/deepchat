import type { JSONContent } from '@tiptap/core'
import type { UserMessageInlineItem } from '@shared/types/agent-interface'

export interface SerializedComposerDocument {
  text: string
  inlineItems: UserMessageInlineItem[]
}

export function serializeComposerDocument(document: JSONContent): SerializedComposerDocument {
  let text = ''
  const inlineItems: UserMessageInlineItem[] = []
  const blocks = document.content ?? []

  blocks.forEach((block, blockIndex) => {
    if (blockIndex > 0) text += '\n'
    for (const node of block.content ?? []) {
      if (node.type === 'text') {
        text += node.text ?? ''
      } else if (node.type === 'hardBreak') {
        text += '\n'
      } else if (node.type === 'fileReference') {
        const relativePath = String(node.attrs?.relativePath ?? '')
        inlineItems.push({
          type: 'file-reference',
          offset: text.length,
          filePath: String(node.attrs?.filePath ?? ''),
          relativePath
        })
        text += `@${relativePath}`
      } else if (node.type === 'sessionReference') {
        inlineItems.push({
          type: 'session',
          offset: text.length,
          sessionId: String(node.attrs?.sessionId ?? ''),
          title: String(node.attrs?.title ?? ''),
          projectDir: typeof node.attrs?.projectDir === 'string' ? node.attrs.projectDir : null,
          tapeIncarnationId: String(node.attrs?.tapeIncarnationId ?? '')
        })
      } else if (node.type === 'fileAttachment') {
        inlineItems.push({
          type: 'file',
          offset: text.length,
          fileName: String(node.attrs?.fileName ?? ''),
          filePath: String(node.attrs?.filePath ?? ''),
          ...(node.attrs?.mimeType ? { mimeType: String(node.attrs.mimeType) } : {})
        })
      } else if (node.type === 'skillChip') {
        inlineItems.push({
          type: 'skill',
          offset: text.length,
          skillName: String(node.attrs?.skillName ?? '')
        })
      }
    }
  })

  return { text, inlineItems }
}
