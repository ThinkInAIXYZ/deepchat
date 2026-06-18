import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { MemoryItem, MemoryStatusDto } from '@shared/contracts/routes'

const clickStub = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    emits: ['click'],
    template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`
  })

const passStub = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    template: `<div v-bind="$attrs"><slot /></div>`
  })

const ButtonStub = clickStub('Button')
const AlertDialogActionStub = clickStub('AlertDialogAction')

const memory: MemoryItem = {
  id: 'm1',
  agentId: 'a',
  kind: 'semantic',
  content: 'redis fact',
  importance: 0.5,
  status: 'embedded',
  sourceSession: null,
  supersededBy: null,
  createdAt: 1000
}

const status: MemoryStatusDto = { total: 1, pendingEmbedding: 0, hasPersona: false }

async function setup(overrides: { remove?: boolean; clear?: number; rollback?: boolean } = {}) {
  vi.resetModules()

  const dispose = vi.fn()
  const memoryClient = {
    list: vi.fn().mockResolvedValue([{ ...memory }]),
    getStatus: vi.fn().mockResolvedValue(status),
    listPersonaVersions: vi.fn().mockResolvedValue([
      { ...memory, id: 'p-old', kind: 'persona', content: 'old persona', supersededBy: 'p-new' },
      { ...memory, id: 'p-new', kind: 'persona', content: 'new persona', supersededBy: null }
    ]),
    remove: vi.fn().mockResolvedValue(overrides.remove ?? true),
    clear: vi.fn().mockResolvedValue(overrides.clear ?? 1),
    rollbackPersona: vi.fn().mockResolvedValue(overrides.rollback ?? true),
    onUpdated: vi.fn().mockReturnValue(dispose)
  }
  const toast = vi.fn()

  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('@iconify/vue', () => ({ Icon: passStub('Icon') }))
  vi.doMock('@shadcn/components/ui/button', () => ({ Button: ButtonStub }))
  vi.doMock('@shadcn/components/ui/badge', () => ({ Badge: passStub('Badge') }))
  vi.doMock('@shadcn/components/ui/dialog', () => ({
    Dialog: passStub('Dialog'),
    DialogContent: passStub('DialogContent'),
    DialogDescription: passStub('DialogDescription'),
    DialogHeader: passStub('DialogHeader'),
    DialogTitle: passStub('DialogTitle')
  }))
  vi.doMock('@shadcn/components/ui/tabs', () => ({
    Tabs: passStub('Tabs'),
    TabsContent: passStub('TabsContent'),
    TabsList: passStub('TabsList'),
    TabsTrigger: passStub('TabsTrigger')
  }))
  vi.doMock('@shadcn/components/ui/scroll-area', () => ({ ScrollArea: passStub('ScrollArea') }))
  vi.doMock('@shadcn/components/ui/alert-dialog', () => ({
    AlertDialog: passStub('AlertDialog'),
    AlertDialogAction: AlertDialogActionStub,
    AlertDialogCancel: clickStub('AlertDialogCancel'),
    AlertDialogContent: passStub('AlertDialogContent'),
    AlertDialogDescription: passStub('AlertDialogDescription'),
    AlertDialogFooter: passStub('AlertDialogFooter'),
    AlertDialogHeader: passStub('AlertDialogHeader'),
    AlertDialogTitle: passStub('AlertDialogTitle'),
    AlertDialogTrigger: passStub('AlertDialogTrigger')
  }))

  const MemoryManagerDialog = (
    await import('../../../src/renderer/settings/components/MemoryManagerDialog.vue')
  ).default
  const wrapper = mount(MemoryManagerDialog, {
    props: { open: false, agentId: 'a' },
    global: { mocks: { $t: (key: string) => key } }
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return { wrapper, memoryClient, toast, dispose }
}

const deleteButton = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
  wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'common.delete')

const failedToast = {
  variant: 'destructive',
  title: 'settings.deepchatAgents.memoryManager.actionFailed'
}

describe('MemoryManagerDialog action consistency (C6, AC-6.1~6.3)', () => {
  it('delete failure toasts and does not optimistically remove (AC-6.1)', async () => {
    const { wrapper, memoryClient, toast } = await setup({ remove: false })
    await deleteButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(memoryClient.remove).toHaveBeenCalledWith('a', 'm1')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining(failedToast))
    expect(wrapper.text()).toContain('redis fact')
  })

  it('delete success removes the item from the list (AC-6.2)', async () => {
    const { wrapper, toast } = await setup({ remove: true })
    await deleteButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(toast).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('redis fact')
  })

  it('clear succeeds even when it removed zero (no toast, list cleared)', async () => {
    const { wrapper, memoryClient, toast } = await setup({ clear: 0 })
    await wrapper.findComponent(AlertDialogActionStub).trigger('click')
    await flushPromises()

    expect(memoryClient.clear).toHaveBeenCalledWith('a')
    expect(toast).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('redis fact')
  })

  it('clear failure (thrown) toasts and keeps the list', async () => {
    const { wrapper, memoryClient, toast } = await setup()
    memoryClient.clear.mockRejectedValueOnce(new Error('boom'))
    await wrapper.findComponent(AlertDialogActionStub).trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith(expect.objectContaining(failedToast))
    expect(wrapper.text()).toContain('redis fact')
  })

  it('rollback failure toasts (AC-6.1)', async () => {
    const { wrapper, toast } = await setup({ rollback: false })
    const rollbackBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('settings.deepchatAgents.memoryManager.rollback'))
    await rollbackBtn!.trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith(expect.objectContaining(failedToast))
  })

  it('disposes the update subscription on unmount while open (AC-6.3)', async () => {
    const { wrapper, dispose } = await setup()
    expect(dispose).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
