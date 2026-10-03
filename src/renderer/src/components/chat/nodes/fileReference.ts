import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { getValidInlineItems } from '@shared/messageInlineItems'
import FileReferenceView from './FileReferenceView.vue'

export const FileReference = Node.create({
  name: 'fileReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return Object.fromEntries(
      ['filePath', 'relativePath'].map((name) => [
        name,
        {
          default: '',
          parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`),
          renderHTML: (attrs: Record<string, unknown>) => ({ [`data-${name}`]: attrs[name] })
        }
      ])
    )
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-file-reference]',
        getAttrs: (element) => {
          const filePath = element.getAttribute('data-filePath') || ''
          const relativePath = element.getAttribute('data-relativePath') || ''
          return getValidInlineItems(`@${relativePath}`, [
            { type: 'file-reference', offset: 0, filePath, relativePath }
          ]).length
            ? { filePath, relativePath }
            : false
        }
      }
    ]
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-file-reference': '' }),
      `@${node.attrs.relativePath}`
    ]
  },
  renderText({ node }) {
    return `@${node.attrs.relativePath}`
  },
  addNodeView() {
    return VueNodeViewRenderer(FileReferenceView)
  }
})
