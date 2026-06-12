import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import WorkspaceFileNode from '@/components/workspace/WorkspaceFileNode.vue'
import { CHAT_INPUT_WORKSPACE_ITEM_MIME } from '@/lib/chatInputWorkspaceReference'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<i class="icon-stub" />'
  })
}))

vi.mock('@api/WorkspaceClient', () => ({
  createWorkspaceClient: () => ({
    openFile: vi.fn(),
    revealFileInFolder: vi.fn()
  })
}))

describe('WorkspaceFileNode drag support', () => {
  const mountNode = (node = { name: 'App.vue', path: '/repo/src/App.vue', isDirectory: false }) =>
    mount(WorkspaceFileNode, {
      props: {
        node,
        depth: 0
      },
      global: {
        stubs: {
          ContextMenu: defineComponent({
            template: '<div><slot /></div>'
          }),
          ContextMenuTrigger: defineComponent({
            template: '<div><slot /></div>'
          }),
          ContextMenuContent: defineComponent({
            template: '<div><slot /></div>'
          }),
          ContextMenuItem: defineComponent({
            emits: ['select'],
            template: '<button type="button" @click="$emit(\'select\')"><slot /></button>'
          }),
          ContextMenuSeparator: defineComponent({
            template: '<div />'
          })
        }
      }
    })

  it('writes workspace drag payload on dragstart', async () => {
    const wrapper = mountNode()

    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: 'all'
    } as unknown as DataTransfer

    await wrapper.get('button[draggable="true"]').trigger('dragstart', { dataTransfer })

    expect((dataTransfer as any).setData).toHaveBeenCalledWith(
      CHAT_INPUT_WORKSPACE_ITEM_MIME,
      JSON.stringify({
        path: '/repo/src/App.vue',
        isDirectory: false
      })
    )
    expect((dataTransfer as any).effectAllowed).toBe('copy')
  })

  it('emits insert-path from the context-menu insert action', async () => {
    const wrapper = mountNode()
    const insertAction = wrapper
      .findAll('button[type="button"]')
      .find((button) => button.text().includes('chat.workspace.files.contextMenu.insertPath'))

    expect(insertAction).toBeTruthy()
    await insertAction!.trigger('click')

    expect(wrapper.emitted('insert-path')).toEqual([['/repo/src/App.vue']])
    expect(wrapper.emitted('append-path')).toBeUndefined()
  })
})
