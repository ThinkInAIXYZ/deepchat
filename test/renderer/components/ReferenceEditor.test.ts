import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import ReferenceEditor from '@/components/chat/ReferenceEditor.vue'

describe('ReferenceEditor', () => {
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
