import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type {
  MemoryAuditEvent,
  MemoryItem,
  MemorySourceSpan,
  MemoryStatusDto,
  MemoryViewManifest
} from '@shared/contracts/routes'

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

const InputStub = defineComponent({
  name: 'Input',
  inheritAttrs: false,
  props: { modelValue: { type: [String, Number], default: '' } },
  emits: ['update:modelValue'],
  template: `<input v-bind="$attrs" :value="modelValue ?? ''" @input="$emit('update:modelValue', $event.target.value)" />`
})

const SelectStub = defineComponent({
  name: 'Select',
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  template: `<div v-bind="$attrs"><slot /></div>`
})

const memory: MemoryItem = {
  id: 'm1',
  agentId: 'a',
  kind: 'semantic',
  category: null,
  content: 'redis fact',
  importance: 0.5,
  status: 'embedded',
  sourceSession: null,
  sourceEntryIds: null,
  supersededBy: null,
  createdAt: 1000
}

const status: MemoryStatusDto = { total: 1, pendingEmbedding: 0, hasPersona: false }

async function setup(
  overrides: {
    remove?: boolean
    clear?: number
    rollback?: boolean
    restore?: boolean
    approve?: boolean
    reject?: boolean
    anchor?: boolean
    items?: MemoryItem[]
    searchResults?: MemoryItem[]
    memoryEnabled?: boolean
    addResult?: { action: string; memoryId?: string; reason?: string; conflictWith?: string }
    conflicts?: Array<{ challenger: MemoryItem; target: MemoryItem }>
    personaVersions?: MemoryItem[]
    drafts?: MemoryItem[]
    sourceSpan?: MemorySourceSpan
    auditEvents?: MemoryAuditEvent[]
    viewManifests?: MemoryViewManifest[]
    auditPromise?: Promise<MemoryAuditEvent[]>
    manifestPromise?: Promise<MemoryViewManifest[]>
    auditReject?: boolean
    manifestReject?: boolean
  } = {}
) {
  vi.resetModules()

  const dispose = vi.fn()
  const memoryClient = {
    list: vi.fn().mockResolvedValue(overrides.items ?? [{ ...memory }]),
    getStatus: vi.fn().mockResolvedValue(status),
    search: vi.fn().mockResolvedValue(overrides.searchResults ?? []),
    listConflicts: vi.fn().mockResolvedValue(overrides.conflicts ?? []),
    getSourceSpan: vi.fn().mockResolvedValue(overrides.sourceSpan ?? null),
    listPersonaVersions: vi.fn().mockResolvedValue(
      overrides.personaVersions ?? [
        {
          ...memory,
          id: 'p-old',
          kind: 'persona',
          content: 'old persona',
          personaState: 'superseded',
          supersededBy: 'p-new'
        },
        {
          ...memory,
          id: 'p-new',
          kind: 'persona',
          content: 'new persona',
          personaState: 'active',
          supersededBy: null
        }
      ]
    ),
    listPersonaDrafts: vi.fn().mockResolvedValue(overrides.drafts ?? []),
    listAuditEvents: overrides.auditPromise
      ? vi.fn().mockReturnValue(overrides.auditPromise)
      : overrides.auditReject
        ? vi.fn().mockRejectedValue(new Error('audit unavailable'))
        : vi.fn().mockResolvedValue(overrides.auditEvents ?? []),
    listViewManifests: overrides.manifestPromise
      ? vi.fn().mockReturnValue(overrides.manifestPromise)
      : overrides.manifestReject
        ? vi.fn().mockRejectedValue(new Error('manifest unavailable'))
        : vi.fn().mockResolvedValue(overrides.viewManifests ?? []),
    add: vi.fn().mockResolvedValue(overrides.addResult ?? { action: 'created', memoryId: 'new-1' }),
    remove: vi.fn().mockResolvedValue(overrides.remove ?? true),
    clear: vi.fn().mockResolvedValue(overrides.clear ?? 1),
    restore: vi.fn().mockResolvedValue(overrides.restore ?? true),
    rollbackPersona: vi.fn().mockResolvedValue(overrides.rollback ?? true),
    approvePersonaDraft: vi.fn().mockResolvedValue(overrides.approve ?? true),
    rejectPersonaDraft: vi.fn().mockResolvedValue(overrides.reject ?? true),
    setPersonaAnchor: vi.fn().mockResolvedValue(overrides.anchor ?? true),
    resolveConflict: vi.fn().mockResolvedValue(true),
    onUpdated: vi.fn().mockReturnValue(dispose)
  }
  const toast = vi.fn()

  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key} ${JSON.stringify(params)}` : key
    })
  }))
  vi.doMock('@iconify/vue', () => ({ Icon: passStub('Icon') }))
  vi.doMock('@shadcn/components/ui/button', () => ({ Button: ButtonStub }))
  vi.doMock('@shadcn/components/ui/input', () => ({ Input: InputStub }))
  vi.doMock('@shadcn/components/ui/textarea', () => ({
    Textarea: defineComponent({
      name: 'Textarea',
      inheritAttrs: false,
      props: { modelValue: { type: String, default: '' } },
      emits: ['update:modelValue'],
      template: `<textarea v-bind="$attrs" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`
    })
  }))
  vi.doMock('@shadcn/components/ui/select', () => ({
    Select: SelectStub,
    SelectContent: passStub('SelectContent'),
    SelectItem: passStub('SelectItem'),
    SelectTrigger: passStub('SelectTrigger'),
    SelectValue: passStub('SelectValue')
  }))
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
    props: { open: false, agentId: 'a', memoryEnabled: overrides.memoryEnabled },
    global: { mocks: { $t: (key: string) => key } }
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return { wrapper, memoryClient, toast, dispose }
}

const deleteButton = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
  wrapper
    .findAllComponents(AlertDialogActionStub)
    .find((b) => b.text().includes('settings.deepchatAgents.memoryManager.deletePermanent'))

const failedToast = {
  variant: 'destructive',
  title: 'settings.deepchatAgents.memoryManager.actionFailed'
}

function findSelectByText(wrapper: Awaited<ReturnType<typeof setup>>['wrapper'], text: string) {
  const select = wrapper
    .findAllComponents({ name: 'Select' })
    .find((item) => item.text().includes(text))
  if (!select) throw new Error(`Missing select containing text: ${text}`)
  return select
}

async function setCategoryFilter(
  wrapper: Awaited<ReturnType<typeof setup>>['wrapper'],
  value: string
): Promise<void> {
  findSelectByText(wrapper, 'settings.deepchatAgents.memoryManager.categoryFilterAll').vm.$emit(
    'update:modelValue',
    value
  )
  await nextTick()
}

async function openAddForm(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']): Promise<void> {
  const addButton = wrapper
    .findAllComponents(ButtonStub)
    .find((button) => button.text().includes('settings.deepchatAgents.memoryManager.addMemory'))
  await addButton!.trigger('click')
  await nextTick()
}

async function setAddCategory(
  wrapper: Awaited<ReturnType<typeof setup>>['wrapper'],
  value: string
): Promise<void> {
  findSelectByText(wrapper, 'settings.deepchatAgents.memoryManager.addCategoryNone').vm.$emit(
    'update:modelValue',
    value
  )
  await nextTick()
}

async function submitAddForm(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']): Promise<void> {
  const addButtons = wrapper
    .findAllComponents(ButtonStub)
    .filter((button) => button.text().includes('settings.deepchatAgents.memoryManager.addMemory'))
  await addButtons[addButtons.length - 1].trigger('click')
  await flushPromises()
}

async function cancelAddForm(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']): Promise<void> {
  const cancelButton = wrapper
    .findAllComponents(ButtonStub)
    .find((button) => button.text().includes('common.cancel'))
  await cancelButton!.trigger('click')
  await nextTick()
}

describe('MemoryManagerDialog category UI (PR-3)', () => {
  it('renders category badges for categorized and uncategorized memories', async () => {
    const projectFact: MemoryItem = {
      ...memory,
      id: 'm-project',
      content: 'repo uses pnpm',
      category: 'project_fact'
    }
    const legacy: MemoryItem = { ...memory, id: 'm-legacy', content: 'legacy row', category: null }
    const { wrapper } = await setup({ items: [projectFact, legacy] })

    const projectRow = wrapper.findAll('li').find((li) => li.text().includes('repo uses pnpm'))
    const legacyRow = wrapper.findAll('li').find((li) => li.text().includes('legacy row'))

    expect(projectRow?.text()).toContain(
      'settings.deepchatAgents.memoryManager.category.project_fact'
    )
    expect(legacyRow?.text()).toContain(
      'settings.deepchatAgents.memoryManager.categoryUncategorized'
    )
  })

  it('filters the loaded list by category, uncategorized, and all', async () => {
    const items: MemoryItem[] = [
      { ...memory, id: 'm-project', content: 'repo uses pnpm', category: 'project_fact' },
      {
        ...memory,
        id: 'm-pref',
        content: 'user prefers terse answers',
        category: 'user_preference'
      },
      { ...memory, id: 'm-legacy', content: 'legacy row', category: null }
    ]
    const { wrapper } = await setup({ items })

    await setCategoryFilter(wrapper, 'project_fact')
    expect(wrapper.text()).toContain('repo uses pnpm')
    expect(wrapper.text()).not.toContain('user prefers terse answers')
    expect(wrapper.text()).not.toContain('legacy row')

    await setCategoryFilter(wrapper, 'uncategorized')
    expect(wrapper.text()).not.toContain('repo uses pnpm')
    expect(wrapper.text()).not.toContain('user prefers terse answers')
    expect(wrapper.text()).toContain('legacy row')

    await setCategoryFilter(wrapper, 'all')
    expect(wrapper.text()).toContain('repo uses pnpm')
    expect(wrapper.text()).toContain('user prefers terse answers')
    expect(wrapper.text()).toContain('legacy row')
  })

  it('filters search results locally without sending category to search', async () => {
    const { wrapper, memoryClient } = await setup({
      items: [{ ...memory, id: 'm-base', content: 'base row', category: null }],
      searchResults: [
        { ...memory, id: 'm-project', content: 'repo search hit', category: 'project_fact' },
        { ...memory, id: 'm-pref', content: 'preference search hit', category: 'user_preference' }
      ]
    })

    await wrapper.find('input[type="search"]').setValue('repo')
    await new Promise((resolve) => setTimeout(resolve, 250))
    await flushPromises()
    expect(memoryClient.search).toHaveBeenCalledWith('a', 'repo')
    expect(wrapper.text()).toContain('repo search hit')
    expect(wrapper.text()).toContain('preference search hit')

    await setCategoryFilter(wrapper, 'project_fact')
    expect(wrapper.text()).toContain('repo search hit')
    expect(wrapper.text()).not.toContain('preference search hit')
    expect(memoryClient.search).toHaveBeenCalledWith('a', 'repo')
  })

  it('shows the category empty state when a loaded list has no category matches', async () => {
    const { wrapper } = await setup({
      items: [
        {
          ...memory,
          id: 'm-pref',
          content: 'user prefers terse answers',
          category: 'user_preference'
        }
      ]
    })

    await setCategoryFilter(wrapper, 'project_fact')

    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.noCategoryResults')
    expect(wrapper.text()).not.toContain('user prefers terse answers')
  })

  it('keeps search-empty copy ahead of category-empty copy', async () => {
    const { wrapper, memoryClient } = await setup({
      items: [{ ...memory, id: 'm-base', content: 'base row', category: null }],
      searchResults: []
    })

    await setCategoryFilter(wrapper, 'project_fact')
    await wrapper.find('input[type="search"]').setValue('missing')
    await new Promise((resolve) => setTimeout(resolve, 250))
    await flushPromises()

    expect(memoryClient.search).toHaveBeenCalledWith('a', 'missing')
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.noSearchResults')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.memoryManager.noCategoryResults')
  })
})

describe('MemoryManagerDialog manual add category passthrough (#15)', () => {
  it('keeps kind and omits category when adding with the default category', async () => {
    const { wrapper, memoryClient } = await setup()

    await openAddForm(wrapper)
    await wrapper.find('textarea').setValue('plain note')
    await submitAddForm(wrapper)

    expect(memoryClient.add).toHaveBeenCalledWith('a', {
      content: 'plain note',
      kind: 'semantic',
      importance: 0.5
    })
    expect(memoryClient.add.mock.calls[0][1]).not.toHaveProperty('category')
  })

  it('passes the selected category when adding a memory', async () => {
    const { wrapper, memoryClient } = await setup()

    await openAddForm(wrapper)
    await wrapper.find('textarea').setValue('repo uses pnpm')
    await setAddCategory(wrapper, 'project_fact')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.memoryManager.kindSemantic')
    await submitAddForm(wrapper)

    expect(memoryClient.add).toHaveBeenCalledWith('a', {
      content: 'repo uses pnpm',
      category: 'project_fact',
      importance: 0.5
    })
    expect(memoryClient.add.mock.calls[0][1]).not.toHaveProperty('kind')
  })

  it('lets the main process derive episodic kind for task outcome memories', async () => {
    const { wrapper, memoryClient } = await setup()

    await openAddForm(wrapper)
    await wrapper.find('textarea').setValue('task finished')
    await setAddCategory(wrapper, 'task_outcome')
    await submitAddForm(wrapper)

    expect(memoryClient.add).toHaveBeenCalledWith('a', {
      content: 'task finished',
      category: 'task_outcome',
      importance: 0.5
    })
    expect(memoryClient.add.mock.calls[0][1]).not.toHaveProperty('kind')
  })

  it('omits category by default after the add form is reset', async () => {
    const { wrapper, memoryClient } = await setup()

    await openAddForm(wrapper)
    await setAddCategory(wrapper, 'project_fact')
    await cancelAddForm(wrapper)
    await openAddForm(wrapper)
    await wrapper.find('textarea').setValue('plain note')
    await submitAddForm(wrapper)

    expect(memoryClient.add).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({
        content: 'plain note',
        kind: 'semantic',
        importance: 0.5
      })
    )
    expect(memoryClient.add.mock.calls[0][1]).not.toHaveProperty('category')
  })
})

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
    const { wrapper, memoryClient, toast } = await setup({ remove: true })
    memoryClient.list.mockResolvedValueOnce([])
    await deleteButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(toast).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('redis fact')
  })

  it('deleting a search result drops it from the visible list without ghosting', async () => {
    const other: MemoryItem = { ...memory, id: 'm2', content: 'vue fact' }
    const { wrapper, memoryClient } = await setup({
      items: [{ ...memory }, other],
      searchResults: [{ ...memory }]
    })

    // A query swaps the list over to server search results (only m1 matches).
    await wrapper.find('input[type="search"]').setValue('redis')
    await new Promise((resolve) => setTimeout(resolve, 250))
    await flushPromises()
    expect(memoryClient.search).toHaveBeenCalledWith('a', 'redis')
    expect(wrapper.text()).toContain('redis fact')
    expect(wrapper.text()).not.toContain('vue fact')

    // Deleting the only visible result must remove it, not leave a stale search row behind.
    memoryClient.list.mockResolvedValueOnce([other])
    memoryClient.search.mockResolvedValueOnce([])
    await deleteButton(wrapper)!.trigger('click')
    await flushPromises()
    expect(memoryClient.remove).toHaveBeenCalledWith('a', 'm1')
    expect(wrapper.text()).not.toContain('redis fact')
  })

  it('a late-rejecting earlier search does not clobber the latest results', async () => {
    const { wrapper, memoryClient } = await setup()

    let rejectFirst: (reason?: unknown) => void = () => {}
    let resolveSecond: (value: MemoryItem[]) => void = () => {}
    memoryClient.search
      .mockReturnValueOnce(
        new Promise<MemoryItem[]>((_resolve, reject) => {
          rejectFirst = reject
        })
      )
      .mockReturnValueOnce(
        new Promise<MemoryItem[]>((resolve) => {
          resolveSecond = resolve
        })
      )

    // Query A dispatches and stays in flight; query B dispatches while A is still pending.
    await wrapper.find('input[type="search"]').setValue('alpha')
    await new Promise((resolve) => setTimeout(resolve, 250))
    await wrapper.find('input[type="search"]').setValue('bravo')
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(memoryClient.search).toHaveBeenCalledTimes(2)

    // B resolves first and writes its results.
    resolveSecond([{ ...memory, id: 'mb', content: 'bravo hit' }])
    await flushPromises()
    expect(wrapper.text()).toContain('bravo hit')

    // A rejects late — its catch must not clear the newer results.
    rejectFirst(new Error('stale search failed'))
    await flushPromises()
    expect(wrapper.text()).toContain('bravo hit')
  })

  it('discards an earlier search that resolves after the query already changed', async () => {
    const { wrapper, memoryClient } = await setup()

    let resolveAlpha: (value: MemoryItem[]) => void = () => {}
    let resolveBravo: (value: MemoryItem[]) => void = () => {}
    memoryClient.search
      .mockReturnValueOnce(
        new Promise<MemoryItem[]>((resolve) => {
          resolveAlpha = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise<MemoryItem[]>((resolve) => {
          resolveBravo = resolve
        })
      )

    // alpha dispatches and stays in flight.
    await wrapper.find('input[type="search"]').setValue('alpha')
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(memoryClient.search).toHaveBeenCalledTimes(1)

    // The query changes to bravo (its debounce has not fired yet); then alpha resolves late.
    await wrapper.find('input[type="search"]').setValue('bravo')
    resolveAlpha([{ ...memory, id: 'ma', content: 'alpha hit' }])
    await flushPromises()
    // The box already shows bravo, so the stale alpha result must not land.
    expect(wrapper.text()).not.toContain('alpha hit')

    // Once bravo's debounce fires and resolves, only its results show.
    await new Promise((resolve) => setTimeout(resolve, 250))
    resolveBravo([{ ...memory, id: 'mb', content: 'bravo hit' }])
    await flushPromises()
    expect(wrapper.text()).toContain('bravo hit')
    expect(wrapper.text()).not.toContain('alpha hit')
  })

  it('clear removed zero toasts and keeps the list', async () => {
    const { wrapper, memoryClient, toast } = await setup({ clear: 0 })
    await wrapper.findComponent(AlertDialogActionStub).trigger('click')
    await flushPromises()

    expect(memoryClient.clear).toHaveBeenCalledWith('a')
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'settings.deepchatAgents.memoryManager.clearNoop' })
    )
    expect(wrapper.text()).toContain('redis fact')
  })

  it('clear failure (thrown) toasts and keeps the list', async () => {
    const { wrapper, memoryClient, toast } = await setup()
    memoryClient.clear.mockRejectedValueOnce(new Error('boom'))
    await wrapper.findComponent(AlertDialogActionStub).trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith(expect.objectContaining(failedToast))
    expect(wrapper.text()).toContain('redis fact')
  })

  it('refreshes activity after clear instead of hiding persisted history', async () => {
    const { wrapper, memoryClient } = await setup({
      auditEvents: [
        {
          id: 'audit-1',
          agentId: 'a',
          eventType: 'memory/reflect',
          actorType: 'scheduler',
          sessionId: 's1',
          inputRefs: { memoryIds: ['m1'] },
          outputRefs: { reflectionIds: ['r1'] },
          modelProviderId: null,
          modelId: null,
          status: 'completed',
          reason: null,
          createdAt: 1000
        }
      ],
      viewManifests: [
        {
          sessionId: 's1',
          messageId: 'msg-1',
          entryId: 10,
          policyVersion: 1,
          tokenBudget: 1200,
          estimatedTokens: 42,
          selectedCount: 3,
          droppedCount: 1,
          queryHash: 'abcdefpersisted',
          createdAt: 1000
        }
      ]
    })
    expect(memoryClient.listAuditEvents).toHaveBeenCalledTimes(1)
    expect(memoryClient.listViewManifests).toHaveBeenCalledTimes(1)

    await wrapper.findComponent(AlertDialogActionStub).trigger('click')
    await flushPromises()

    expect(memoryClient.clear).toHaveBeenCalledWith('a')
    expect(memoryClient.listAuditEvents).toHaveBeenCalledTimes(2)
    expect(memoryClient.listViewManifests).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('redis fact')
    expect(wrapper.text()).toContain('memory/reflect')
    expect(wrapper.text()).toContain('abcdef')
  })

  it('rollback failure toasts (AC-6.1)', async () => {
    const { wrapper, memoryClient, toast } = await setup({ rollback: false })
    // Rollback is now confirm-wrapped: the action lives on the AlertDialog confirm button.
    const rollbackAction = wrapper
      .findAllComponents(AlertDialogActionStub)
      .find((c) => c.text().includes('settings.deepchatAgents.memoryManager.rollback'))
    await rollbackAction!.trigger('click')
    await flushPromises()

    expect(memoryClient.rollbackPersona).toHaveBeenCalledWith('a', 'p-old')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining(failedToast))
  })

  it('disposes the update subscription on unmount while open (AC-6.3)', async () => {
    const { wrapper, dispose } = await setup()
    expect(dispose).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe('MemoryManagerDialog activity visibility', () => {
  it('keeps the core memory list available when activity routes fail', async () => {
    const { wrapper } = await setup({
      auditReject: true,
      manifestReject: true
    })

    expect(wrapper.text()).toContain('redis fact')
    expect(wrapper.text()).not.toContain('audit unavailable')
    expect(wrapper.text()).not.toContain('manifest unavailable')
  })

  it('releases the core loading state while activity routes are still pending', async () => {
    let resolveAudit!: (events: MemoryAuditEvent[]) => void
    let resolveManifest!: (manifests: MemoryViewManifest[]) => void
    const auditPromise = new Promise<MemoryAuditEvent[]>((resolve) => {
      resolveAudit = resolve
    })
    const manifestPromise = new Promise<MemoryViewManifest[]>((resolve) => {
      resolveManifest = resolve
    })

    const { wrapper, memoryClient } = await setup({
      auditPromise,
      manifestPromise
    })

    expect(memoryClient.listAuditEvents).toHaveBeenCalled()
    expect(memoryClient.listViewManifests).toHaveBeenCalled()
    expect(wrapper.text()).toContain('redis fact')
    expect(wrapper.text()).toContain('common.loading')

    resolveAudit([])
    resolveManifest([])
    await flushPromises()

    expect(wrapper.text()).toContain('redis fact')
    expect(wrapper.text()).not.toContain('common.loading')
  })

  it('renders audit and manifest metadata without raw memory content', async () => {
    const { wrapper } = await setup({
      items: [],
      personaVersions: [],
      auditEvents: [
        {
          id: 'audit-1',
          agentId: 'a',
          eventType: 'memory/reflect',
          actorType: 'scheduler',
          sessionId: 's1',
          inputRefs: { memoryIds: ['m1'], content: 'secret raw memory' },
          outputRefs: { reflectionIds: ['r1'] },
          modelProviderId: 'openai',
          modelId: 'gpt-4o-mini',
          status: 'completed',
          reason: null,
          createdAt: 1000
        }
      ],
      viewManifests: [
        {
          sessionId: 's1',
          messageId: 'msg-1',
          entryId: 10,
          policyVersion: 1,
          tokenBudget: 1200,
          estimatedTokens: 42,
          selectedCount: 3,
          droppedCount: 1,
          queryHash: 'abcdef1234567890',
          createdAt: 1000
        }
      ]
    })

    expect(wrapper.text()).toContain('memory/reflect')
    expect(wrapper.text()).toContain('abcdef')
    expect(wrapper.text()).toContain('1200')
    expect(wrapper.text()).not.toContain('secret raw memory')
  })
})

describe('MemoryManagerDialog SDD-4 surfacing (conflict / archived)', () => {
  it('renders the conflict badge for a challenged memory', async () => {
    const { wrapper } = await setup({
      items: [{ ...memory, conflictState: 'challenged' }]
    })
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.conflict')
  })

  it('does not render the conflict badge when there is no conflict', async () => {
    const { wrapper } = await setup({ items: [{ ...memory, conflictState: null }] })
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.memoryManager.conflict')
  })

  it('dims an archived memory row and labels its status', async () => {
    const { wrapper } = await setup({
      items: [{ ...memory, status: 'archived', conflictState: null }]
    })
    const row = wrapper.findAll('li').find((li) => li.text().includes('redis fact'))
    expect(row?.classes()).toContain('opacity-60')
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.status.archived')
  })

  it('shows a restore action on archived rows that calls client.restore (AC-4.2)', async () => {
    const { wrapper, memoryClient } = await setup({
      items: [{ ...memory, status: 'archived', conflictState: null }]
    })
    const restoreBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'settings.deepchatAgents.memoryManager.restore')
    expect(restoreBtn).toBeTruthy()
    await restoreBtn!.trigger('click')
    await flushPromises()
    expect(memoryClient.restore).toHaveBeenCalledWith('a', 'm1')
  })

  it('does not show a restore action on a non-archived row', async () => {
    const { wrapper } = await setup({ items: [{ ...memory, status: 'embedded' }] })
    const restoreBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'settings.deepchatAgents.memoryManager.restore')
    expect(restoreBtn).toBeUndefined()
  })
})

describe('MemoryManagerDialog source lineage (SDD-7)', () => {
  const sourceLineKey = 'settings.deepchatAgents.memoryManager.sourceLine'

  it('renders the source line with the truncated session and entry count, and exposes raw ids via title', async () => {
    const { wrapper } = await setup({
      items: [{ ...memory, sourceSession: 'session-ABCD123456', sourceEntryIds: [12, 34] }]
    })
    const text = wrapper.text()
    expect(text).toContain(sourceLineKey)
    expect(text).toContain('"count":2')
    expect(text).toContain('"session":"…CD123456"')
    expect(wrapper.find('[title="12, 34"]').exists()).toBe(true)
  })

  it('opens the source span dialog with readable text', async () => {
    const { wrapper, memoryClient } = await setup({
      items: [{ ...memory, sourceSession: 'session-ABCD123456', sourceEntryIds: [12] }],
      sourceSpan: {
        sessionId: 'session-ABCD123456',
        entries: [{ entryId: 12, role: 'user', content: 'readable source text', orderSeq: 7 }]
      }
    })
    const sourceButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes(sourceLineKey))
    await sourceButton!.trigger('click')
    await flushPromises()
    expect(memoryClient.getSourceSpan).toHaveBeenCalledWith('a', 'm1')
    expect(wrapper.text()).toContain('readable source text')
    expect(wrapper.text()).not.toContain('{"text"')
  })

  it('does not render the source line when there is no source session', async () => {
    const { wrapper } = await setup({ items: [{ ...memory, sourceSession: null }] })
    expect(wrapper.text()).not.toContain(sourceLineKey)
  })

  it('leaves a session-only memory (e.g. reflection) blank instead of showing zero entries', async () => {
    const { wrapper } = await setup({
      items: [{ ...memory, kind: 'reflection', sourceSession: 'session-x', sourceEntryIds: null }]
    })
    expect(wrapper.text()).not.toContain(sourceLineKey)
  })

  it('does not render a source line for persona timeline versions', async () => {
    const { wrapper } = await setup({
      items: [{ ...memory, sourceSession: null }],
      personaVersions: [
        {
          ...memory,
          id: 'p1',
          kind: 'persona',
          content: 'self model',
          personaState: 'active',
          supersededBy: null,
          sourceSession: 'sess-persona',
          sourceEntryIds: [9]
        }
      ]
    })
    expect(wrapper.text()).not.toContain(sourceLineKey)
  })
})

const draft: MemoryItem = {
  ...memory,
  id: 'd1',
  kind: 'persona',
  content: 'proposed self-model',
  personaState: 'draft',
  supersededBy: null,
  needsReview: false
}

describe('MemoryManagerDialog persona draft approval (SDD-6)', () => {
  it('keeps drafts out of the timeline but surfaces them in the pending section', async () => {
    const { wrapper } = await setup({ drafts: [{ ...draft }] })
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.pendingTitle')
    expect(wrapper.text()).toContain('proposed self-model')
    // The active persona is shown for comparison; the draft never joins the version timeline.
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.personaProposed')
  })

  it('flags a large-change draft and approves it through the client (AC-3.x)', async () => {
    const { wrapper, memoryClient } = await setup({
      drafts: [{ ...draft, needsReview: true }]
    })
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.largeChange')

    const approveBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('settings.deepchatAgents.memoryManager.approve'))
    await approveBtn!.trigger('click')
    await flushPromises()
    expect(memoryClient.approvePersonaDraft).toHaveBeenCalledWith('a', 'd1')
  })

  it('rejects a draft through the client', async () => {
    const { wrapper, memoryClient } = await setup({ drafts: [{ ...draft }] })
    const rejectBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('settings.deepchatAgents.memoryManager.reject'))
    await rejectBtn!.trigger('click')
    await flushPromises()
    expect(memoryClient.rejectPersonaDraft).toHaveBeenCalledWith('a', 'd1')
  })

  it('approve failure toasts and does not crash (AC-6.1)', async () => {
    const { wrapper, toast } = await setup({ drafts: [{ ...draft }], approve: false })
    const approveBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('settings.deepchatAgents.memoryManager.approve'))
    await approveBtn!.trigger('click')
    await flushPromises()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining(failedToast))
  })

  it('toggles the anchor on a persona version through the client', async () => {
    const { wrapper, memoryClient } = await setup()
    const anchorBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'settings.deepchatAgents.memoryManager.anchor')
    expect(anchorBtn).toBeTruthy()
    await anchorBtn!.trigger('click')
    await flushPromises()
    // The non-active 'p-old' version is the one offering an anchor toggle.
    expect(memoryClient.setPersonaAnchor).toHaveBeenCalledWith('a', 'p-old', true)
  })
})

describe('MemoryManagerDialog manual add (PR-5)', () => {
  const addToggle = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
    wrapper.findAll('button').find((b) => b.attributes('aria-expanded') !== undefined)
  const addSubmit = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
    wrapper
      .findAll('button')
      .find(
        (b) =>
          b.attributes('aria-expanded') === undefined &&
          b.text().includes('settings.deepchatAgents.memoryManager.addMemory')
      )

  it('submits the form content with default kind/importance and reloads', async () => {
    const { wrapper, memoryClient } = await setup()
    await addToggle(wrapper)!.trigger('click')

    await wrapper.find('textarea').setValue('remember the deploy runbook')
    await addSubmit(wrapper)!.trigger('click')
    await flushPromises()

    expect(memoryClient.add).toHaveBeenCalledWith('a', {
      content: 'remember the deploy runbook',
      kind: 'semantic',
      importance: 0.5
    })
    // A successful add reloads the authoritative list.
    expect(memoryClient.list).toHaveBeenCalledTimes(2)
  })

  it('does not submit when the content is blank', async () => {
    const { wrapper, memoryClient } = await setup()
    await addToggle(wrapper)!.trigger('click')

    await wrapper.find('textarea').setValue('   ')
    const submit = addSubmit(wrapper)
    await submit!.trigger('click')
    await flushPromises()

    expect(memoryClient.add).not.toHaveBeenCalled()
  })

  it('toasts the duplicate outcome only on an exact-content no-op', async () => {
    const { wrapper, toast } = await setup({ addResult: { action: 'noop', reason: 'duplicate' } })
    await addToggle(wrapper)!.trigger('click')

    await wrapper.find('textarea').setValue('redis fact')
    await addSubmit(wrapper)!.trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith({
      title: 'settings.deepchatAgents.memoryManager.addDuplicate'
    })
  })

  it('toasts "not added" (not duplicate) for a non-duplicate no-op', async () => {
    const { wrapper, toast } = await setup({ addResult: { action: 'noop', reason: 'disposed' } })
    await addToggle(wrapper)!.trigger('click')

    await wrapper.find('textarea').setValue('redis fact')
    await addSubmit(wrapper)!.trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith({
      title: 'settings.deepchatAgents.memoryManager.addSkipped'
    })
    expect(toast).not.toHaveBeenCalledWith({
      title: 'settings.deepchatAgents.memoryManager.addDuplicate'
    })
  })

  it('disables the add button and never calls the client when memory is disabled', async () => {
    const { wrapper, memoryClient } = await setup({ memoryEnabled: false })

    const toggle = addToggle(wrapper)
    expect(toggle!.attributes('disabled')).toBeDefined()
    // The enable-first hint explains why adding is blocked.
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.addDisabledHint')

    // Even a forced click cannot open the form or reach the backend.
    await toggle!.trigger('click')
    await flushPromises()
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(memoryClient.add).not.toHaveBeenCalled()
  })
})
