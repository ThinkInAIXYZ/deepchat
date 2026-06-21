import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
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

const memory: MemoryItem = {
  id: 'm1',
  agentId: 'a',
  kind: 'semantic',
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
