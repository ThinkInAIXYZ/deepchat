import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

const createSession = (isPinned = false) => ({
  id: 'session-1',
  title: 'Session Title',
  agentId: 'deepchat',
  status: 'none' as const,
  projectDir: '',
  providerId: 'provider-1',
  modelId: 'model-1',
  isPinned,
  isDraft: false,
  createdAt: 1,
  updatedAt: 1
})

const mountComponent = async (isPinned = false) => {
  vi.resetModules()

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const passthrough = defineComponent({
    template: '<div><slot /></div>'
  })

  const contextMenuItemStub = defineComponent({
    emits: ['select'],
    template: '<button type="button" @click="$emit(\'select\')"><slot /></button>'
  })

  const WindowSideBarSessionItem = (await import('@/components/WindowSideBarSessionItem.vue'))
    .default

  const wrapper = mount(WindowSideBarSessionItem, {
    props: {
      session: createSession(isPinned),
      active: false
    },
    global: {
      stubs: {
        ContextMenu: passthrough,
        ContextMenuTrigger: passthrough,
        ContextMenuContent: passthrough,
        ContextMenuSeparator: passthrough,
        ContextMenuItem: contextMenuItemStub,
        Icon: true
      }
    }
  })

  return wrapper
}

describe('WindowSideBarSessionItem', () => {
  it('emits select when the list item is clicked', async () => {
    const wrapper = await mountComponent()

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([expect.objectContaining({ id: 'session-1' })])
  }, 10000)

  it('renders the correct pin action label for pinned and unpinned sessions', async () => {
    const unpinnedWrapper = await mountComponent(false)
    const pinnedWrapper = await mountComponent(true)

    expect(unpinnedWrapper.text()).toContain('thread.actions.pin')
    expect(pinnedWrapper.text()).toContain('thread.actions.unpin')
  }, 10000)

  it('emits context menu actions with the session payload', async () => {
    const wrapper = await mountComponent()
    const menuButtons = wrapper.findAll('button')
    const renameButton = menuButtons.find((button) =>
      button.text().includes('thread.actions.rename')
    )
    const clearButton = menuButtons.find((button) =>
      button.text().includes('thread.actions.cleanMessages')
    )
    const deleteButton = menuButtons.find((button) =>
      button.text().includes('thread.actions.delete')
    )

    expect(renameButton).toBeTruthy()
    expect(clearButton).toBeTruthy()
    expect(deleteButton).toBeTruthy()

    await renameButton!.trigger('click')
    await clearButton!.trigger('click')
    await deleteButton!.trigger('click')

    expect(wrapper.emitted('rename')?.[0]).toEqual([expect.objectContaining({ id: 'session-1' })])
    expect(wrapper.emitted('clear')?.[0]).toEqual([expect.objectContaining({ id: 'session-1' })])
    expect(wrapper.emitted('delete')?.[0]).toEqual([expect.objectContaining({ id: 'session-1' })])
  }, 10000)
})
