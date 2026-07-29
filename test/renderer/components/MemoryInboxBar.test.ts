import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type {
  MemoryDirectiveCommandResult,
  MemoryDirectiveItem,
  MemoryItem
} from '../../../src/shared/contracts/routes'
import { AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT } from '../../../src/shared/types/agent-memory'

const passthrough = (name: string, tag = 'div') =>
  defineComponent({ name, template: `<${tag}><slot /></${tag}>` })

const stubs = {
  Badge: passthrough('Badge'),
  Button: defineComponent({
    name: 'Button',
    inheritAttrs: false,
    template: '<button v-bind="$attrs"><slot /></button>'
  }),
  Icon: passthrough('Icon')
}

function draftDirective(): MemoryDirectiveItem {
  return {
    id: 'directive-draft',
    agentId: 'deepchat',
    kind: 'suppress_topic',
    status: 'draft',
    source: 'derived_suggestion',
    content: 'Do not proactively mention Project X.',
    topic: 'project x',
    createdAt: 1,
    updatedAt: 1
  }
}

function personaDraft(): MemoryItem {
  return {
    id: 'persona-draft',
    agentId: 'deepchat',
    kind: 'persona',
    category: null,
    content: 'Proposed persona content',
    importance: 1,
    status: 'fts_only',
    sourceSession: null,
    sourceEntryIds: null,
    supersededBy: null,
    createdAt: 1,
    confidence: 1,
    temporalKind: 'atemporal',
    validFrom: null,
    validUntil: null,
    temporalConfidence: null,
    temporalPrecision: null,
    temporalTimeZone: null,
    personaState: 'draft',
    needsReview: false
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

async function setup() {
  vi.resetModules()
  const draft = draftDirective()
  const memoryClient = {
    listConflicts: vi.fn().mockResolvedValue([]),
    listPersonaDrafts: vi.fn().mockResolvedValue([]),
    listPersonaVersions: vi.fn().mockResolvedValue([]),
    listDirectives: vi.fn().mockResolvedValue([draft]),
    resolveConflict: vi.fn(),
    approvePersonaDraft: vi.fn(),
    rejectPersonaDraft: vi.fn(),
    approveDirective: vi.fn().mockResolvedValue({
      action: 'applied',
      directive: { ...draft, status: 'active' }
    }),
    rejectDirective: vi.fn().mockResolvedValue({ ...draft, status: 'rejected' })
  }
  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key
    })
  }))

  const Component = (await import('../../../src/renderer/settings/components/MemoryInboxBar.vue'))
    .default
  const wrapper = mount(Component, {
    props: {
      agentId: 'deepchat',
      conflictCount: 0,
      draftCount: 0,
      directiveDraftCount: 1,
      refreshToken: 0
    },
    global: { stubs }
  })
  await flushPromises()
  return { wrapper, memoryClient }
}

describe('MemoryInboxBar directives', () => {
  it('loads only draft directives and exposes their topic and content', async () => {
    const { wrapper, memoryClient } = await setup()

    expect(memoryClient.listDirectives).toHaveBeenCalledWith('deepchat', {
      statuses: ['draft'],
      limit: AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
    })
    expect(wrapper.text()).toContain('Do not proactively mention Project X.')
    expect(wrapper.text()).toContain('project x')
  })

  it('removes an approved suggestion from the inbox immediately', async () => {
    const { wrapper, memoryClient } = await setup()
    const approval = deferred<MemoryDirectiveCommandResult>()
    const stale = deferred<MemoryDirectiveItem[]>()
    memoryClient.approveDirective.mockReturnValueOnce(approval.promise)
    const approve = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.deepchatAgents.memoryManager.approve'))
    if (!approve) throw new Error('Approve button not found')

    await approve.trigger('click')
    await flushPromises()
    await approve.trigger('click')
    expect(memoryClient.approveDirective).toHaveBeenCalledOnce()
    memoryClient.listDirectives.mockReturnValueOnce(stale.promise)
    const refresh = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.memory.redesign.refresh'))
    if (!refresh) throw new Error('Refresh button not found')
    await refresh.trigger('click')

    approval.resolve({
      action: 'applied',
      directive: { ...draftDirective(), status: 'active' }
    })
    await flushPromises()

    expect(memoryClient.approveDirective).toHaveBeenCalledWith('deepchat', 'directive-draft')
    expect(wrapper.text()).not.toContain('Do not proactively mention Project X.')

    stale.resolve([draftDirective()])
    await flushPromises()
    expect(wrapper.text()).not.toContain('Do not proactively mention Project X.')
  })

  it('keeps a draft visible and explains capacity rejection', async () => {
    const { wrapper, memoryClient } = await setup()
    memoryClient.approveDirective.mockResolvedValueOnce({
      action: 'rejected',
      directive: null,
      reason: 'capacity'
    })
    const approve = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.deepchatAgents.memoryManager.approve'))
    if (!approve) throw new Error('Approve button not found')

    await approve.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Do not proactively mention Project X.')
    const feedback = wrapper.get('[data-testid="memory-inline-feedback"]')
    expect(feedback.attributes('data-tone')).toBe('error')
    expect(feedback.text()).toContain('settings.memory.redesign.directiveCapacityTitle')
    expect(feedback.text()).toContain(String(AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT))
  })

  it('keeps persona results available when directive loading fails', async () => {
    const { wrapper, memoryClient } = await setup()
    memoryClient.listPersonaDrafts.mockResolvedValueOnce([personaDraft()])
    memoryClient.listDirectives.mockRejectedValueOnce(new Error('directive read failed'))

    const refresh = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.memory.redesign.refresh'))
    if (!refresh) throw new Error('Refresh button not found')
    await refresh.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Proposed persona content')
    expect(wrapper.get('[data-testid="memory-inline-feedback"]').attributes('data-tone')).toBe(
      'error'
    )
  })
})
