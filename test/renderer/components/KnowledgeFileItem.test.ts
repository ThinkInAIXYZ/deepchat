import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

describe('KnowledgeFileItem', () => {
  async function setup() {
    vi.resetModules()

    vi.doMock('@/lib/utils', () => ({
      getMimeTypeIcon: () => 'lucide:file-text'
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const KnowledgeFileItem = (
      await import('../../../src/renderer/settings/components/KnowledgeFileItem.vue')
    ).default

    const wrapper = mount(KnowledgeFileItem, {
      props: {
        file: {
          id: 'file-1',
          name: 'guide.md',
          path: '/workspace/guide.md',
          mimeType: 'text/markdown',
          status: 'processing',
          uploadedAt: 123,
          metadata: {
            size: 1024,
            totalChunks: 3
          }
        },
        progress: {
          completed: 2,
          error: 1,
          total: 4
        }
      },
      global: {
        stubs: {
          Icon: true,
          Button: buttonStub,
          AlertDialog: passthrough('AlertDialog'),
          AlertDialogAction: buttonStub,
          AlertDialogCancel: buttonStub,
          AlertDialogContent: passthrough('AlertDialogContent'),
          AlertDialogDescription: passthrough('AlertDialogDescription'),
          AlertDialogFooter: passthrough('AlertDialogFooter'),
          AlertDialogHeader: passthrough('AlertDialogHeader'),
          AlertDialogTitle: passthrough('AlertDialogTitle'),
          AlertDialogTrigger: passthrough('AlertDialogTrigger')
        }
      }
    })

    return { wrapper }
  }

  it('renders progress supplied by the page-level event subscription', async () => {
    const { wrapper } = await setup()

    expect((wrapper.vm as any).fileProgress).toEqual({
      completed: 2,
      error: 1,
      total: 4
    })
    expect((wrapper.vm as any).progressPercent).toBe(75)
    wrapper.unmount()
  })
})
