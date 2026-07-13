import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { Agent } from '../../../src/shared/types/agent-interface'
import type { MemoryStatusDto } from '../../../src/shared/contracts/routes'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const PropStub = (name: string, props: string[], template = '<div />') =>
  defineComponent({
    name,
    props,
    template
  })

const stubs = {
  SettingsPageShell: passthrough('SettingsPageShell'),
  Tabs: passthrough('Tabs'),
  TabsList: passthrough('TabsList'),
  TabsTrigger: passthrough('TabsTrigger'),
  TabsContent: passthrough('TabsContent'),
  Select: passthrough('Select'),
  SelectContent: passthrough('SelectContent'),
  SelectItem: passthrough('SelectItem'),
  SelectTrigger: passthrough('SelectTrigger'),
  SelectValue: passthrough('SelectValue'),
  Button: passthrough('Button'),
  Badge: passthrough('Badge'),
  Icon: passthrough('Icon'),
  MemoryConfigInlinePanel: PropStub(
    'MemoryConfigInlinePanel',
    ['open', 'agentId'],
    '<div v-if="open" data-testid="settings-memory-config-panel" :data-agent-id="agentId"><button data-testid="settings-memory-config-close" @click="$emit(\'update:open\', false)" /></div>'
  ),
  MemoryDiagnosticsPanel: PropStub('MemoryDiagnosticsPanel', ['agentId', 'status', 'refreshToken']),
  MemoryInboxBar: PropStub('MemoryInboxBar', [
    'agentId',
    'conflictCount',
    'draftCount',
    'refreshToken'
  ]),
  MemoryListView: PropStub('MemoryListView', ['agentId', 'memoryEnabled', 'refreshToken']),
  MemoryPersonaPanel: PropStub('MemoryPersonaPanel', [
    'agentId',
    'personaEvolutionEnabled',
    'refreshToken'
  ])
}

const deepchat: Agent = { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true }
const other: Agent = { id: 'other', name: 'Other', type: 'deepchat', enabled: true }
const baseStatus: MemoryStatusDto = {
  total: 0,
  pendingEmbedding: 0,
  hasPersona: false,
  activeMemoryCount: 0,
  archivedMemoryCount: 0,
  conflictCount: 0,
  personaDraftCount: 0,
  personaVersionCount: 0
}

afterEach(() => {
  vi.useRealTimers()
})

async function setup(
  agents: Agent[],
  options: {
    query?: Record<string, string>
    resolveImpl?: (agentId: string) => Promise<unknown>
    statusImpl?: (agentId: string) => Promise<MemoryStatusDto>
  } = {}
) {
  vi.resetModules()
  let updatedHandler: ((payload: { agentId: string }) => void) | null = null
  const configClient = {
    listAgents: vi.fn().mockResolvedValue(agents),
    resolveDeepChatAgentConfig: options.resolveImpl
      ? vi.fn(options.resolveImpl)
      : vi.fn().mockResolvedValue({})
  }
  const memoryClient = {
    getStatus: options.statusImpl
      ? vi.fn(options.statusImpl)
      : vi.fn().mockResolvedValue(baseStatus),
    onUpdated: vi.fn((handler: (payload: { agentId: string }) => void) => {
      updatedHandler = handler
      return vi.fn()
    })
  }
  const router = { push: vi.fn(), replace: vi.fn() }
  vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configClient }))
  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'settings.memory.redesign.memoryCount') {
          return `${params?.active} active · ${params?.archived} archived`
        }
        if (key === 'settings.memory.redesign.embeddingModel') {
          return `Embedding: ${params?.model}`
        }
        return key
      }
    })
  }))
  vi.doMock('vue-router', () => ({
    useRoute: () => ({ query: options.query ?? {} }),
    useRouter: () => router
  }))

  const MemorySettings = (
    await import('../../../src/renderer/settings/components/MemorySettings.vue')
  ).default
  const wrapper = mount(MemorySettings, { global: { stubs } })
  await flushPromises()
  return {
    wrapper,
    configClient,
    memoryClient,
    router,
    emitUpdated: (payload: { agentId: string }) => updatedHandler?.(payload)
  }
}

function listView(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  return wrapper.findComponent({ name: 'MemoryListView' })
}

function configPanel(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  return wrapper.findComponent({ name: 'MemoryConfigInlinePanel' })
}

function statusSummary(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  return wrapper.find('[data-testid="settings-memory-status-summary"]')
}

function inboxBar(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  return wrapper.findComponent({ name: 'MemoryInboxBar' })
}

describe('MemorySettings redesign shell', () => {
  it('defaults to the built-in deepchat agent', async () => {
    const { wrapper } = await setup([other, deepchat])
    expect(listView(wrapper).props('agentId')).toBe('deepchat')
  })

  it('preselects the agent passed via the route query', async () => {
    const { wrapper } = await setup([deepchat, other], { query: { agentId: 'other' } })
    expect(listView(wrapper).props('agentId')).toBe('other')
  })

  it('shows an empty state instead of rendering the memory workspace when no agents exist', async () => {
    const { wrapper } = await setup([])
    expect(wrapper.text()).toContain('settings.memory.empty')
    expect(listView(wrapper).exists()).toBe(false)
  })

  it('renders status counts from the extended status dto', async () => {
    const { wrapper } = await setup([deepchat], {
      resolveImpl: async () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'p', modelId: 'text-embedding-v4' }
      }),
      statusImpl: async () => ({
        ...baseStatus,
        activeMemoryCount: 3,
        archivedMemoryCount: 2,
        conflictCount: 1,
        personaDraftCount: 1,
        personaVersionCount: 1
      })
    })

    expect(statusSummary(wrapper).text()).toContain('settings.memory.redesign.statusEnabled')
    expect(statusSummary(wrapper).text()).toContain('3 active · 2 archived')
    expect(statusSummary(wrapper).text()).toContain('Embedding: text-embedding-v4')
    expect(wrapper.findComponent({ name: 'MemoryStatusCard' }).exists()).toBe(false)
    expect(wrapper.text()).toContain('settings.memory.redesign.tabPersona')
  })

  it('keeps a single configure entry that toggles the inline config panel', async () => {
    const { wrapper } = await setup([deepchat], {
      resolveImpl: async () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'p', modelId: 'text-embedding-v4' }
      })
    })

    expect(wrapper.findAll('[data-testid="settings-memory-configure"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="settings-memory-configure"]').text()).toContain(
      'settings.memory.redesign.configure'
    )
    expect(configPanel(wrapper).props('open')).toBe(false)
    expect(wrapper.find('[data-testid="settings-memory-config-panel"]').exists()).toBe(false)
    expect(
      wrapper.find('[data-testid="settings-memory-configure"]').attributes('aria-expanded')
    ).toBe('false')

    await wrapper.find('[data-testid="settings-memory-configure"]').trigger('click')
    await flushPromises()

    expect(configPanel(wrapper).props('open')).toBe(true)
    expect(wrapper.find('[data-testid="settings-memory-config-panel"]').exists()).toBe(true)
    expect(
      wrapper.find('[data-testid="settings-memory-configure"]').attributes('aria-expanded')
    ).toBe('true')

    await wrapper.find('[data-testid="settings-memory-config-close"]').trigger('click')
    await flushPromises()

    expect(configPanel(wrapper).props('open')).toBe(false)
    expect(wrapper.find('[data-testid="settings-memory-config-panel"]').exists()).toBe(false)
  })

  it('uses the single top action to enable memory when memory is disabled', async () => {
    const { wrapper } = await setup([deepchat])

    expect(wrapper.findAll('[data-testid="settings-memory-configure"]')).toHaveLength(1)
    expect(statusSummary(wrapper).text()).toContain('settings.memory.redesign.statusDisabled')
    expect(wrapper.find('[data-testid="settings-memory-configure"]').text()).toContain(
      'settings.memory.redesign.enableMemory'
    )

    await wrapper.find('[data-testid="settings-memory-configure"]').trigger('click')
    await flushPromises()

    expect(configPanel(wrapper).props('open')).toBe(true)
    expect(wrapper.find('[data-testid="settings-memory-config-panel"]').exists()).toBe(true)
  })

  it('keeps the inline config panel bound to the selected agent', async () => {
    const { wrapper } = await setup([deepchat, other])

    await wrapper.find('[data-testid="settings-memory-configure"]').trigger('click')
    await flushPromises()

    expect(configPanel(wrapper).props('agentId')).toBe('deepchat')
    expect(
      wrapper.find('[data-testid="settings-memory-config-panel"]').attributes('data-agent-id')
    ).toBe('deepchat')

    wrapper.findComponent({ name: 'Select' }).vm.$emit('update:model-value', 'other')
    await flushPromises()

    expect(configPanel(wrapper).props('agentId')).toBe('other')
    expect(
      wrapper.find('[data-testid="settings-memory-config-panel"]').attributes('data-agent-id')
    ).toBe('other')
  })

  it('does not inherit the previous agent memoryEnabled while the next resolve is pending', async () => {
    let resolveOther!: (value: unknown) => void
    const otherPending = new Promise<unknown>((resolve) => {
      resolveOther = resolve
    })
    const { wrapper } = await setup([deepchat, other], {
      resolveImpl: (id) =>
        id === 'deepchat'
          ? Promise.resolve({
              memoryEnabled: true,
              memoryEmbedding: { providerId: 'p', modelId: 'm' }
            })
          : otherPending
    })

    expect(listView(wrapper).props('memoryEnabled')).toBe(true)

    wrapper.findComponent({ name: 'Select' }).vm.$emit('update:model-value', 'other')
    await flushPromises()
    expect(listView(wrapper).props('agentId')).toBe('other')
    expect(listView(wrapper).props('memoryEnabled')).toBe(false)

    resolveOther({ memoryEnabled: false })
    await flushPromises()
    expect(listView(wrapper).props('memoryEnabled')).toBe(false)
  })

  it('clears status counts while the next agent status is pending', async () => {
    let resolveOtherStatus!: (value: MemoryStatusDto) => void
    const otherStatusPending = new Promise<MemoryStatusDto>((resolve) => {
      resolveOtherStatus = resolve
    })
    const { wrapper } = await setup([deepchat, other], {
      resolveImpl: async () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'p', modelId: 'm' }
      }),
      statusImpl: (id) =>
        id === 'deepchat'
          ? Promise.resolve({
              ...baseStatus,
              activeMemoryCount: 7,
              archivedMemoryCount: 3,
              conflictCount: 5,
              personaDraftCount: 4
            })
          : otherStatusPending
    })

    expect(statusSummary(wrapper).text()).toContain('7 active · 3 archived')
    expect(inboxBar(wrapper).props('conflictCount')).toBe(5)
    expect(inboxBar(wrapper).props('draftCount')).toBe(4)

    wrapper.findComponent({ name: 'Select' }).vm.$emit('update:model-value', 'other')
    await flushPromises()

    expect(statusSummary(wrapper).text()).not.toContain('7 active · 3 archived')
    expect(statusSummary(wrapper).text()).toContain('0 active · 0 archived')
    expect(inboxBar(wrapper).props('conflictCount')).toBe(0)
    expect(inboxBar(wrapper).props('draftCount')).toBe(0)

    resolveOtherStatus(baseStatus)
    await flushPromises()
  })

  it('fetches status and resolved config exactly once per mount and per agent switch', async () => {
    const { wrapper, configClient, memoryClient } = await setup([deepchat, other])

    expect(configClient.resolveDeepChatAgentConfig).toHaveBeenCalledTimes(1)
    expect(memoryClient.getStatus).toHaveBeenCalledTimes(1)
    const tokenBeforeSwitch = Number(listView(wrapper).props('refreshToken'))

    wrapper.findComponent({ name: 'Select' }).vm.$emit('update:model-value', 'other')
    await flushPromises()

    expect(configClient.resolveDeepChatAgentConfig).toHaveBeenCalledTimes(2)
    expect(memoryClient.getStatus).toHaveBeenCalledTimes(2)
    // Switching agents must not bump refreshToken - children already reload
    // from the agentId prop change; a token bump would double their loads.
    expect(Number(listView(wrapper).props('refreshToken'))).toBe(tokenBeforeSwitch)
  })

  it('uses memory.updated as the single refresh path instead of child changed events', async () => {
    vi.useFakeTimers()
    const { wrapper, emitUpdated, memoryClient } = await setup([deepchat])
    const before = Number(listView(wrapper).props('refreshToken'))
    const statusCallsBefore = memoryClient.getStatus.mock.calls.length

    listView(wrapper).vm.$emit('changed')
    await flushPromises()
    expect(listView(wrapper).props('refreshToken')).toBe(before)

    emitUpdated({ agentId: 'deepchat' })
    emitUpdated({ agentId: 'deepchat' })
    emitUpdated({ agentId: 'deepchat' })
    await vi.advanceTimersByTimeAsync(99)
    await flushPromises()
    expect(Number(listView(wrapper).props('refreshToken'))).toBe(before)

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(Number(listView(wrapper).props('refreshToken'))).toBeGreaterThan(before)
    expect(memoryClient.getStatus).toHaveBeenCalledTimes(statusCallsBefore + 1)
  })
})
