import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
import { describe, expect, it, vi } from 'vitest'
import ReferenceEditor from '@/components/chat/ReferenceEditor.vue'

describe('ReferenceEditor', () => {
  it('locks embedded controls and shortcuts without losing references while saving', async () => {
    const wrapper = mount(ReferenceEditor, {
      props: {
        text: '@src/App.vue',
        inlineItems: [
          {
            type: 'file-reference',
            offset: 0,
            filePath: '/repo/src/App.vue',
            relativePath: 'src/App.vue'
          }
        ],
        ariaLabel: 'Edit message'
      },
      attachTo: document.body
    })
    await nextTick()
    const remove = wrapper.get('[data-file-reference] button[aria-label^="common.delete"]')
    await wrapper.setProps({ editable: false })
    expect(remove.element.matches(':disabled')).toBe(true)
    ;(remove.element as HTMLButtonElement).click()
    await wrapper.get('[role="textbox"]').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await wrapper.get('[role="textbox"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.get('[role="textbox"]').attributes('contenteditable')).toBe('false')
    expect(wrapper.findAll('[data-file-reference]')).toHaveLength(1)
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.emitted('cancel')).toBeUndefined()
    await wrapper.setProps({ editable: true })
    expect(remove.element.matches(':disabled')).toBe(false)
    ;(remove.element as HTMLButtonElement).click()
    await nextTick()
    expect(wrapper.findAll('[data-file-reference]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('updates both file labels when inserting and undoing a colliding reference', async () => {
    const wrapper = mount(ReferenceEditor, {
      props: {
        text: '@a/x/index.ts',
        inlineItems: [
          {
            type: 'file-reference',
            offset: 0,
            filePath: '/repo/a/x/index.ts',
            relativePath: 'a/x/index.ts'
          }
        ],
        ariaLabel: 'Edit message'
      },
      attachTo: document.body
    })
    await nextTick()
    const editor = wrapper.getComponent(EditorContent).props('editor')!
    const labels = () => wrapper.findAll('[data-file-reference]').map((node) => node.text())
    expect(labels()).toEqual(['x/index.ts'])
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, {
      type: 'fileReference',
      attrs: { filePath: '/repo/b/x/index.ts', relativePath: 'b/x/index.ts' }
    })
    await vi.waitFor(() => expect(labels()).toEqual(['a/x/index.ts', 'b/x/index.ts']))
    editor.commands.undo()
    await vi.waitFor(() => expect(labels()).toEqual(['x/index.ts']))
    wrapper.unmount()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'saves with Ctrl/Meta+Enter and preserves canonical reference identity',
    async (modifier) => {
      const wrapper = mount(ReferenceEditor, {
        props: {
          text: '前@src/App.vue后',
          inlineItems: [
            {
              type: 'file-reference',
              offset: 1,
              filePath: '/repo/src/App.vue',
              relativePath: 'src/App.vue'
            }
          ],
          ariaLabel: 'Edit message'
        },
        attachTo: document.body
      })

      await nextTick()
      await wrapper
        .get('[contenteditable="true"]')
        .trigger('keydown', { key: 'Enter', ...modifier })

      expect(wrapper.emitted('save')).toEqual([[]])
      expect((wrapper.vm as unknown as { getValue: () => unknown }).getValue()).toEqual({
        text: '前@src/App.vue后',
        inlineItems: [
          {
            type: 'file-reference',
            offset: 1,
            filePath: '/repo/src/App.vue',
            relativePath: 'src/App.vue'
          }
        ]
      })
      wrapper.unmount()
    }
  )

  it('cancels with Escape without saving', async () => {
    const wrapper = mount(ReferenceEditor, {
      props: { text: 'draft', ariaLabel: 'Edit message' }
    })

    await nextTick()
    await wrapper.get('[contenteditable="true"]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('cancel')).toEqual([[]])
    expect(wrapper.emitted('save')).toBeUndefined()
  })
})
