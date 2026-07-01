import { describe, expect, it, vi } from 'vitest'
import { defineComponent, inject, nextTick, provide } from 'vue'
import type { InjectionKey } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type {
  MemoryArchiveCandidateLifecyclePreview,
  MemoryAuditEvent,
  MemoryHealthDto,
  MemoryItem,
  MemoryLifecycle,
  MemorySourceSpan,
  MemoryStatusDto,
  MemoryViewManifest
} from '@shared/contracts/routes'
import { createEmptyMemoryHealth } from '@shared/contracts/routes'
import type { MemoryUpdatedPayload } from '@api/MemoryClient'

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

interface TabsStubContext {
  select: (value: string) => void
}
const tabsStubKey: InjectionKey<TabsStubContext> = Symbol('TabsStub')

const TabsStub = defineComponent({
  name: 'Tabs',
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(_props, { emit }) {
    provide<TabsStubContext>(tabsStubKey, {
      select: (value) => emit('update:modelValue', value)
    })
  },
  template: `<div v-bind="$attrs"><slot /></div>`
})

const TabsTriggerStub = defineComponent({
  name: 'TabsTrigger',
  inheritAttrs: false,
  props: { value: { type: String, required: true } },
  setup(props) {
    const tabs = inject<TabsStubContext>(tabsStubKey)
    return {
      selectTab: () => tabs?.select(props.value)
    }
  },
  template: `<button v-bind="$attrs" type="button" :data-tab-value="value" @click="selectTab"><slot /></button>`
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
const health: MemoryHealthDto = {
  ...createEmptyMemoryHealth(),
  totalRows: 2,
  byKind: { episodic: 0, semantic: 2, reflection: 0, persona: 0, working: 0 },
  byCategory: {
    user_preference: 0,
    project_fact: 1,
    task_outcome: 0,
    heuristic: 0,
    anti_pattern: 0,
    uncategorized: 1
  },
  byStatus: {
    pending_embedding: 0,
    embedded: 2,
    error: 0,
    fts_only: 0,
    archived: 0,
    conflicted: 0
  },
  embeddings: { pending: 0, error: 0, ftsOnly: 0, stale: 1 },
  lifecycle: { archiveCandidates: 1, archived: 0 },
  conflicts: { conflicted: 0, challenged: 0 },
  access: {
    topAccessed: [
      {
        id: 'm1',
        kind: 'semantic',
        category: 'project_fact',
        content: 'repo uses pnpm',
        importance: 0.6,
        accessCount: 3,
        lastAccessed: 2000
      }
    ],
    neverAccessed: 1
  },
  quality: { importanceAvg: 0.55, importanceMedian: null, confidenceAvg: null },
  maintenance: {
    completed: 1,
    skipped: 1,
    failed: 1,
    scanLimit: 200,
    recentFailures: [
      {
        eventType: 'memory/maintenance_llm',
        status: 'failed',
        reason: 'model unavailable',
        createdAt: 3000
      }
    ]
  }
}

const lifecycle: MemoryLifecycle = {
  memoryId: 'm1',
  kind: 'semantic',
  status: 'embedded',
  recallable: true,
  decayTier: 'aging',
  recall: {
    weights: { similarity: 0.6, recency: 0.25, importance: 0.15 },
    similarity: 0.3,
    similaritySource: 'baseline',
    recency: 0.8,
    importance: 0.5,
    confidenceFactor: 1,
    importanceFloor: 0.075,
    final: 0.455,
    flooredByImportance: false,
    halfLifeMs: 14 * 24 * 60 * 60 * 1000
  },
  forget: {
    anchorAt: 1000,
    ageDays: 10,
    halfLifeDays: 45,
    decayScore: 0.8,
    materializedDecay: null,
    materializedStale: true
  },
  archiveEligibility: {
    eligible: false,
    oldEnough: false,
    decayedEnough: false,
    neverAccessed: true,
    active: true,
    exempt: false,
    exemptReasons: [],
    gaps: { daysUntilOldEnough: 80, decayAboveThresholdBy: 0.75 }
  }
}

const archiveCandidateLifecyclePreview: MemoryArchiveCandidateLifecyclePreview = {
  lifecycles: [lifecycle],
  previewLimit: 25,
  scanLimit: 200,
  scanned: 1,
  previewTruncated: false,
  scanTruncated: false
}

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
    health?: MemoryHealthDto
    healthPromise?: Promise<MemoryHealthDto>
    healthReject?: boolean
    archiveCandidateLifecyclePreview?: MemoryArchiveCandidateLifecyclePreview
    archiveCandidateLifecyclePreviewPromise?: Promise<MemoryArchiveCandidateLifecyclePreview>
    archiveCandidateLifecyclePreviewReject?: boolean
    lifecycle?: MemoryLifecycle
    lifecyclePromise?: Promise<MemoryLifecycle[]>
    lifecycleReject?: boolean
    auditPromise?: Promise<MemoryAuditEvent[]>
    manifestPromise?: Promise<MemoryViewManifest[]>
    auditReject?: boolean
    manifestReject?: boolean
  } = {}
) {
  vi.resetModules()

  const dispose = vi.fn()
  let updateListener: ((payload: MemoryUpdatedPayload) => void) | null = null
  const memoryClient = {
    list: vi.fn().mockResolvedValue(overrides.items ?? [{ ...memory }]),
    getStatus: vi.fn().mockResolvedValue(status),
    getHealth: overrides.healthPromise
      ? vi.fn().mockReturnValue(overrides.healthPromise)
      : overrides.healthReject
        ? vi.fn().mockRejectedValue(new Error('health unavailable'))
        : vi.fn().mockResolvedValue(overrides.health ?? health),
    getLifecycle: overrides.lifecyclePromise
      ? vi.fn().mockReturnValue(overrides.lifecyclePromise)
      : overrides.lifecycleReject
        ? vi.fn().mockRejectedValue(new Error('lifecycle unavailable'))
        : vi.fn().mockResolvedValue([overrides.lifecycle ?? lifecycle]),
    getArchiveCandidateLifecyclePreview: overrides.archiveCandidateLifecyclePreviewPromise
      ? vi.fn().mockReturnValue(overrides.archiveCandidateLifecyclePreviewPromise)
      : overrides.archiveCandidateLifecyclePreviewReject
        ? vi.fn().mockRejectedValue(new Error('candidate unavailable'))
        : vi
            .fn()
            .mockResolvedValue(
              overrides.archiveCandidateLifecyclePreview ?? archiveCandidateLifecyclePreview
            ),
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
    onUpdated: vi.fn().mockImplementation((listener) => {
      updateListener = listener
      return dispose
    })
  }
  const toast = vi.fn()

  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      locale: { value: 'en-US' },
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
    Tabs: TabsStub,
    TabsContent: passStub('TabsContent'),
    TabsList: passStub('TabsList'),
    TabsTrigger: TabsTriggerStub
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
  return {
    wrapper,
    memoryClient,
    toast,
    dispose,
    emitMemoryUpdated: (reason: MemoryUpdatedPayload['reason'] = 'extract') =>
      updateListener?.({ agentId: 'a', reason, version: 1 })
  }
}

const deleteButton = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
  wrapper
    .findAllComponents(AlertDialogActionStub)
    .find((b) => b.text().includes('settings.deepchatAgents.memoryManager.deletePermanent'))

const failedToast = {
  variant: 'destructive',
  title: 'settings.deepchatAgents.memoryManager.actionFailed'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function findTabTrigger(
  wrapper: Awaited<ReturnType<typeof setup>>['wrapper'],
  tab: 'memories' | 'health' | 'persona' | 'activity'
) {
  const trigger = wrapper.find(`[data-tab-value="${tab}"]`)
  if (!trigger.exists()) throw new Error(`Missing tab trigger: ${tab}`)
  return trigger
}

async function clickTab(
  wrapper: Awaited<ReturnType<typeof setup>>['wrapper'],
  tab: 'memories' | 'health' | 'persona' | 'activity'
): Promise<void> {
  await findTabTrigger(wrapper, tab).trigger('click')
  await nextTick()
  await flushPromises()
}

async function activateHealthTab(
  wrapper: Awaited<ReturnType<typeof setup>>['wrapper']
): Promise<void> {
  await clickTab(wrapper, 'health')
}

async function deactivateHealthTab(
  wrapper: Awaited<ReturnType<typeof setup>>['wrapper']
): Promise<void> {
  await clickTab(wrapper, 'memories')
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

describe('MemoryManagerDialog memory health', () => {
  async function mountHealthSection(healthValue: MemoryHealthDto = health) {
    vi.resetModules()
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        locale: { value: 'en-US' },
        t: (key: string, params?: Record<string, unknown>) =>
          params ? `${key} ${JSON.stringify(params)}` : key
      })
    }))
    vi.doMock('@shadcn/components/ui/badge', () => ({ Badge: passStub('Badge') }))
    const MemoryHealthSection = (
      await import('../../../src/renderer/settings/components/MemoryHealthSection.vue')
    ).default
    return mount(MemoryHealthSection, {
      props: { health: healthValue, loading: false, error: null }
    })
  }

  it('renders health metrics, top accessed preview, recent failures, and null quality placeholders', async () => {
    const wrapper = await mountHealthSection()

    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.health.totalRows')
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.health.byKind')
    expect(wrapper.text()).toContain('repo uses pnpm')
    expect(wrapper.text()).toContain('memory/maintenance_llm')
    expect(wrapper.text()).toContain('model unavailable')
    expect(wrapper.text()).toContain('—')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('renders zero as a valid last accessed timestamp', async () => {
    const wrapper = await mountHealthSection({
      ...health,
      access: {
        ...health.access,
        topAccessed: [
          {
            ...health.access.topAccessed[0],
            lastAccessed: 0
          }
        ]
      }
    })

    expect(wrapper.text()).toContain('repo uses pnpm')
    expect(wrapper.text()).toContain('Jan')
  })

  it('lazy-loads health only when the Health tab becomes active', async () => {
    const { wrapper, memoryClient } = await setup()

    expect(memoryClient.getHealth).not.toHaveBeenCalled()
    expect(memoryClient.getArchiveCandidateLifecyclePreview).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('redis fact')

    await activateHealthTab(wrapper)

    expect(memoryClient.getHealth).toHaveBeenCalledTimes(1)
    expect(memoryClient.getHealth).toHaveBeenCalledWith('a')
    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(1)
    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledWith('a')
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.health.totalRows')
    expect(wrapper.text()).toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.title'
    )

    await deactivateHealthTab(wrapper)
    await activateHealthTab(wrapper)

    expect(memoryClient.getHealth).toHaveBeenCalledTimes(1)
    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(1)
  })

  it('clears the Health badge after an inactive memory update until health is refreshed', async () => {
    const loadedHealth = { ...health, totalRows: 987 }
    const refreshedHealth = { ...health, totalRows: 654 }
    const { wrapper, memoryClient, emitMemoryUpdated } = await setup({ health: loadedHealth })

    await activateHealthTab(wrapper)
    expect(findTabTrigger(wrapper, 'health').text()).toContain('987')
    await deactivateHealthTab(wrapper)

    emitMemoryUpdated()
    await flushPromises()

    expect(memoryClient.getHealth).toHaveBeenCalledTimes(1)
    expect(findTabTrigger(wrapper, 'health').text()).not.toContain('987')

    memoryClient.getHealth.mockResolvedValueOnce(refreshedHealth)
    await activateHealthTab(wrapper)

    expect(memoryClient.getHealth).toHaveBeenCalledTimes(2)
    expect(findTabTrigger(wrapper, 'health').text()).toContain('654')
  })

  it('keeps the memory list available when lazy health loading fails', async () => {
    const { wrapper, memoryClient } = await setup({ healthReject: true })

    expect(memoryClient.getHealth).not.toHaveBeenCalled()
    await activateHealthTab(wrapper)

    expect(memoryClient.getHealth).toHaveBeenCalledWith('a')
    expect(wrapper.text()).toContain('health unavailable')
    expect(wrapper.text()).toContain('redis fact')
  })

  it('retries archive candidate lifecycle loading after Health is reopened', async () => {
    const { wrapper, memoryClient } = await setup()
    memoryClient.getArchiveCandidateLifecyclePreview.mockReset()
    memoryClient.getArchiveCandidateLifecyclePreview
      .mockRejectedValueOnce(new Error('candidate unavailable'))
      .mockResolvedValueOnce({
        ...archiveCandidateLifecyclePreview,
        lifecycles: [],
        scanned: 0
      })

    await activateHealthTab(wrapper)
    await flushPromises()

    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('candidate unavailable')

    await deactivateHealthTab(wrapper)
    await activateHealthTab(wrapper)
    await flushPromises()

    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.empty'
    )
    expect(wrapper.text()).not.toContain('candidate unavailable')
  })

  it('marks health dirty on memory updates while inactive and reloads when opened', async () => {
    const { wrapper, memoryClient, emitMemoryUpdated } = await setup()
    expect(memoryClient.getHealth).not.toHaveBeenCalled()
    expect(memoryClient.getArchiveCandidateLifecyclePreview).not.toHaveBeenCalled()

    emitMemoryUpdated()
    await flushPromises()

    expect(memoryClient.getHealth).not.toHaveBeenCalled()
    expect(memoryClient.getArchiveCandidateLifecyclePreview).not.toHaveBeenCalled()
    await activateHealthTab(wrapper)
    expect(memoryClient.getHealth).toHaveBeenCalledTimes(1)
    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(1)
  })

  it('refreshes health immediately on memory updates while the Health tab is active', async () => {
    const { wrapper, memoryClient, emitMemoryUpdated } = await setup()
    await activateHealthTab(wrapper)
    expect(memoryClient.getHealth).toHaveBeenCalledTimes(1)
    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(1)

    emitMemoryUpdated()
    await flushPromises()

    expect(memoryClient.getHealth).toHaveBeenCalledTimes(2)
    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(2)
  })

  it('does not let an older health response overwrite the latest response', async () => {
    const stale = deferred<MemoryHealthDto>()
    const fresh = deferred<MemoryHealthDto>()
    const { wrapper, memoryClient, emitMemoryUpdated } = await setup()
    memoryClient.getHealth.mockReset()
    memoryClient.getHealth.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)

    await activateHealthTab(wrapper)
    expect(memoryClient.getHealth).toHaveBeenCalledTimes(1)

    emitMemoryUpdated()
    await flushPromises()
    expect(memoryClient.getHealth).toHaveBeenCalledTimes(2)

    fresh.resolve({
      ...health,
      access: {
        ...health.access,
        topAccessed: [{ ...health.access.topAccessed[0], id: 'fresh', content: 'fresh health' }]
      }
    })
    await flushPromises()
    expect(wrapper.text()).toContain('fresh health')

    stale.resolve({
      ...health,
      access: {
        ...health.access,
        topAccessed: [{ ...health.access.topAccessed[0], id: 'stale', content: 'stale health' }]
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('fresh health')
    expect(wrapper.text()).not.toContain('stale health')
  })

  it('does not let an older archive candidate response overwrite the latest response', async () => {
    const stale = deferred<MemoryArchiveCandidateLifecyclePreview>()
    const fresh = deferred<MemoryArchiveCandidateLifecyclePreview>()
    const { wrapper, memoryClient, emitMemoryUpdated } = await setup()
    memoryClient.getArchiveCandidateLifecyclePreview.mockReset()
    memoryClient.getArchiveCandidateLifecyclePreview
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)

    await activateHealthTab(wrapper)
    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(1)

    emitMemoryUpdated()
    await flushPromises()
    expect(memoryClient.getArchiveCandidateLifecyclePreview).toHaveBeenCalledTimes(2)

    fresh.resolve({
      ...archiveCandidateLifecyclePreview,
      lifecycles: [{ ...lifecycle, memoryId: 'fresh-candidate' }]
    })
    await flushPromises()
    expect(wrapper.text()).toContain('fresh-candidate')

    stale.resolve({
      ...archiveCandidateLifecyclePreview,
      lifecycles: [{ ...lifecycle, memoryId: 'stale-candidate' }]
    })
    await flushPromises()

    expect(wrapper.text()).toContain('fresh-candidate')
    expect(wrapper.text()).not.toContain('stale-candidate')
  })

  it('waits for memory.updated before refreshing dirty health after an active mutation', async () => {
    const inactive = await setup()
    await inactive.wrapper.findComponent(AlertDialogActionStub).trigger('click')
    await flushPromises()
    expect(inactive.memoryClient.clear).toHaveBeenCalledWith('a')
    expect(inactive.memoryClient.getHealth).not.toHaveBeenCalled()

    const active = await setup()
    await activateHealthTab(active.wrapper)
    expect(active.memoryClient.getHealth).toHaveBeenCalledTimes(1)
    active.memoryClient.getHealth.mockClear()

    await active.wrapper.findComponent(AlertDialogActionStub).trigger('click')
    await flushPromises()

    expect(active.memoryClient.clear).toHaveBeenCalledWith('a')
    expect(active.memoryClient.getHealth).not.toHaveBeenCalled()

    active.emitMemoryUpdated()
    await flushPromises()

    expect(active.memoryClient.getHealth).toHaveBeenCalledTimes(1)
  })

  it('does not clear or refresh Health for persona anchor updates', async () => {
    const { wrapper, memoryClient, emitMemoryUpdated } = await setup()
    await activateHealthTab(wrapper)
    expect(findTabTrigger(wrapper, 'health').text()).toContain('2')
    memoryClient.getHealth.mockClear()

    await clickTab(wrapper, 'persona')
    const anchorButton = wrapper
      .findAll('button')
      .find(
        (button) =>
          button.attributes('aria-label') === 'settings.deepchatAgents.memoryManager.anchor'
      )
    expect(anchorButton).toBeTruthy()
    await anchorButton!.trigger('click')
    await flushPromises()
    emitMemoryUpdated('persona-anchor')
    await flushPromises()

    expect(memoryClient.setPersonaAnchor).toHaveBeenCalledWith('a', expect.any(String), true)
    expect(memoryClient.getHealth).not.toHaveBeenCalled()
    expect(findTabTrigger(wrapper, 'health').text()).toContain('2')
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

describe('MemoryManagerDialog lifecycle inspector', () => {
  const lifecycleToggle = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
    wrapper
      .findAll('button')
      .find(
        (button) =>
          button.attributes('aria-label') ===
          'settings.deepchatAgents.memoryManager.lifecycle.toggle'
      )

  it('loads a memory lifecycle only when the row is expanded and reuses the cached result', async () => {
    const { wrapper, memoryClient } = await setup()
    expect(memoryClient.getLifecycle).not.toHaveBeenCalled()

    await lifecycleToggle(wrapper)!.trigger('click')
    await flushPromises()

    expect(memoryClient.getLifecycle).toHaveBeenCalledTimes(1)
    expect(memoryClient.getLifecycle).toHaveBeenCalledWith('a', 'm1')
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.lifecycle.modelNote')
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.lifecycle.recall.final')

    await lifecycleToggle(wrapper)!.trigger('click')
    await nextTick()
    await lifecycleToggle(wrapper)!.trigger('click')
    await flushPromises()

    expect(memoryClient.getLifecycle).toHaveBeenCalledTimes(1)
  })

  it('retries lifecycle loading after a transient error when the row is expanded again', async () => {
    const { wrapper, memoryClient } = await setup()
    vi.mocked(memoryClient.getLifecycle)
      .mockRejectedValueOnce(new Error('lifecycle unavailable'))
      .mockResolvedValueOnce([lifecycle])

    await lifecycleToggle(wrapper)!.trigger('click')
    await flushPromises()

    expect(memoryClient.getLifecycle).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('lifecycle unavailable')

    await lifecycleToggle(wrapper)!.trigger('click')
    await nextTick()
    await lifecycleToggle(wrapper)!.trigger('click')
    await flushPromises()

    expect(memoryClient.getLifecycle).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.lifecycle.modelNote')
    expect(wrapper.text()).not.toContain('lifecycle unavailable')
  })

  it('caches a successful empty lifecycle result as an empty state', async () => {
    const { wrapper, memoryClient } = await setup()
    vi.mocked(memoryClient.getLifecycle).mockResolvedValueOnce([])

    await lifecycleToggle(wrapper)!.trigger('click')
    await flushPromises()

    expect(memoryClient.getLifecycle).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.lifecycle.empty')

    await lifecycleToggle(wrapper)!.trigger('click')
    await nextTick()
    await lifecycleToggle(wrapper)!.trigger('click')
    await flushPromises()

    expect(memoryClient.getLifecycle).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.lifecycle.empty')
  })
})

describe('MemoryManagerDialog manual add (PR-5)', () => {
  const addToggle = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
    wrapper
      .findAll('button')
      .find(
        (b) =>
          b.attributes('aria-expanded') !== undefined &&
          b.text().includes('settings.deepchatAgents.memoryManager.addMemory')
      )
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
