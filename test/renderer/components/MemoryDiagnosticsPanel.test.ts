import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import {
  createEmptyMemoryHealth,
  type MemoryAuditEvent,
  type MemoryArchiveCandidateLifecyclePreview,
  type MemoryHealthDto,
  type MemoryStatusDto
} from '../../../src/shared/contracts/routes'
import { auditSentenceKey } from '../../../src/renderer/settings/components/memoryRedesignUtils'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const ButtonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const stubs = {
  Button: ButtonStub,
  Badge: passthrough('Badge'),
  AlertDialog: passthrough('AlertDialog'),
  AlertDialogAction: ButtonStub,
  AlertDialogCancel: ButtonStub,
  AlertDialogContent: passthrough('AlertDialogContent'),
  AlertDialogDescription: passthrough('AlertDialogDescription'),
  AlertDialogFooter: passthrough('AlertDialogFooter'),
  AlertDialogHeader: passthrough('AlertDialogHeader'),
  AlertDialogTitle: passthrough('AlertDialogTitle'),
  AlertDialogTrigger: passthrough('AlertDialogTrigger'),
  Icon: passthrough('Icon')
}

const baseStatus: MemoryStatusDto = {
  total: 0,
  pendingEmbedding: 0,
  hasPersona: false,
  activeMemoryCount: 0,
  archivedMemoryCount: 0,
  conflictCount: 0,
  personaDraftCount: 0,
  personaVersionCount: 0,
  reindexing: false
}

const baseHealth = createEmptyMemoryHealth(200)

const basePreview: MemoryArchiveCandidateLifecyclePreview = {
  lifecycles: [],
  previewLimit: 25,
  scanLimit: 200,
  scanned: 0,
  previewTruncated: false,
  scanTruncated: false
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function auditEvent(overrides: Partial<MemoryAuditEvent> = {}): MemoryAuditEvent {
  return {
    id: 'audit-1',
    agentId: 'deepchat',
    eventType: 'memory/maintenance_llm',
    actorType: 'scheduler',
    sessionId: null,
    inputRefs: {},
    outputRefs: {},
    modelProviderId: null,
    modelId: null,
    status: 'completed',
    reason: null,
    createdAt: Date.now(),
    ...overrides
  }
}

async function setup(
  initialStatus: MemoryStatusDto | null = baseStatus,
  options: {
    auditEvents?: MemoryAuditEvent[]
    messages?: Record<string, string>
  } = {}
) {
  vi.resetModules()
  const memoryClient = {
    getHealth: vi.fn().mockResolvedValue(baseHealth),
    getArchiveCandidateLifecyclePreview: vi.fn().mockResolvedValue(basePreview),
    listAuditEvents: vi.fn().mockResolvedValue(options.auditEvents ?? []),
    reindex: vi.fn().mockResolvedValue({ started: true }),
    clear: vi.fn().mockResolvedValue(0)
  }
  const toast = vi.fn()
  const t = vi.fn((key: string) => options.messages?.[key] ?? key)
  const te = vi.fn((key: string) => Object.hasOwn(options.messages ?? {}, key))

  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({ t, te, locale: { value: 'en-US' } })
  }))
  vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

  const MemoryDiagnosticsPanel = (
    await import('../../../src/renderer/settings/components/MemoryDiagnosticsPanel.vue')
  ).default
  const wrapper = mount(MemoryDiagnosticsPanel, {
    props: { agentId: 'deepchat', status: initialStatus, refreshToken: 0 },
    global: { stubs }
  })
  await flushPromises()
  return { wrapper, memoryClient, toast, t, te }
}

function reindexButton(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  return wrapper
    .findAll('button')
    .find((button) =>
      button.text().includes('settings.deepchatAgents.memoryManager.health.reindex')
    )!
}

function refreshButton(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  return wrapper
    .findAll('button')
    .find((button) => button.text().includes('settings.memory.redesign.refresh'))!
}

function clearAllActionButton(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  return wrapper
    .findAll('button')
    .filter((button) => button.text().includes('settings.deepchatAgents.memoryManager.clearAll'))
    .at(-1)!
}

describe('MemoryDiagnosticsPanel', () => {
  it('normalizes persisted audit event types to stable i18n keys', () => {
    expect(auditSentenceKey('memory/maintenance_llm')).toBe(
      'settings.memory.redesign.audit.memory-maintenance-llm'
    )
    expect(auditSentenceKey('persona/evolve')).toBe('settings.memory.redesign.audit.persona-evolve')
    expect(auditSentenceKey('Memory — Repair')).toBe('settings.memory.redesign.audit.memory-repair')
  })

  it('renders known audit event labels without falling back through missing i18n keys', async () => {
    const messages = {
      'settings.memory.redesign.audit.memory-maintenance-llm': 'Maintained memory',
      'settings.memory.redesign.audit.memory-forget': 'Permanently deleted memory'
    }
    const { wrapper, t, te } = await setup(baseStatus, {
      auditEvents: [
        auditEvent({ id: 'maintenance', eventType: 'memory/maintenance_llm' }),
        auditEvent({ id: 'forget', eventType: 'memory/forget' })
      ],
      messages
    })

    expect(wrapper.text()).toContain('Maintained memory')
    expect(wrapper.text()).toContain('Permanently deleted memory')
    expect(te).toHaveBeenCalledWith('settings.memory.redesign.audit.memory-maintenance-llm')
    expect(te).toHaveBeenCalledWith('settings.memory.redesign.audit.memory-forget')
    expect(t).toHaveBeenCalledWith('settings.memory.redesign.audit.memory-maintenance-llm')
    expect(t).toHaveBeenCalledWith('settings.memory.redesign.audit.memory-forget')

    wrapper.unmount()
  })

  it('renders unknown audit events raw without calling the missing i18n key', async () => {
    const { wrapper, t, te } = await setup(baseStatus, {
      auditEvents: [auditEvent({ eventType: 'memory/future_event' })],
      messages: {}
    })

    expect(wrapper.text()).toContain('memory/future_event')
    expect(te).toHaveBeenCalledWith('settings.memory.redesign.audit.memory-future-event')
    expect(t).not.toHaveBeenCalledWith('settings.memory.redesign.audit.memory-future-event')

    wrapper.unmount()
  })

  it('does not settle reindex pending from a follow-up load against the stale pre-start status', async () => {
    const { wrapper, memoryClient } = await setup()

    await reindexButton(wrapper).trigger('click')
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeDefined()

    // props.status is still the stale pre-reindex snapshot (reindexing: false) here: a load
    // triggered while it hasn't changed must never be treated as reindex-complete confirmation.
    await refreshButton(wrapper).trigger('click')
    await flushPromises()
    expect(memoryClient.getHealth).toHaveBeenCalledTimes(3)
    expect(reindexButton(wrapper).attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })

  it('settles reindex pending once a post-start status reports reindexing is done', async () => {
    const { wrapper } = await setup()

    await reindexButton(wrapper).trigger('click')
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.setProps({ status: { ...baseStatus, reindexing: false } })
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })

  it('settles reindex pending on a null status observed after the reindex started', async () => {
    const { wrapper } = await setup()

    await reindexButton(wrapper).trigger('click')
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.setProps({ status: null })
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })

  it('resets reindex pending bookkeeping when the agent changes', async () => {
    const { wrapper } = await setup()

    await reindexButton(wrapper).trigger('click')
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.setProps({ agentId: 'other-agent' })
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })

  it('drops a stale reindex response after the agent changes', async () => {
    const { wrapper, memoryClient } = await setup()
    const pending = deferred<{ started: boolean }>()
    memoryClient.reindex.mockReturnValueOnce(pending.promise)

    await reindexButton(wrapper).trigger('click')
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.setProps({ agentId: 'other-agent' })
    await flushPromises()
    expect(reindexButton(wrapper).attributes('disabled')).toBeUndefined()
    const healthCallsAfterAgentSwitch = memoryClient.getHealth.mock.calls.length

    pending.resolve({ started: true })
    await flushPromises()
    await flushPromises()

    expect(memoryClient.getHealth).toHaveBeenCalledTimes(healthCallsAfterAgentSwitch)
    expect(reindexButton(wrapper).attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('reloads diagnostics after clearing all memories for the current agent', async () => {
    const { wrapper, memoryClient } = await setup()

    await clearAllActionButton(wrapper).trigger('click')
    await flushPromises()

    expect(memoryClient.clear).toHaveBeenCalledWith('deepchat')
    expect(memoryClient.getHealth).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('shows a failure toast when clearing all memories fails', async () => {
    const { wrapper, memoryClient, toast } = await setup()
    memoryClient.clear.mockRejectedValueOnce(new Error('clear failed'))

    await clearAllActionButton(wrapper).trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('drops a stale clear-all response after the agent changes', async () => {
    const { wrapper, memoryClient, toast } = await setup()
    const pending = deferred<number>()
    memoryClient.clear.mockReturnValueOnce(pending.promise)

    await clearAllActionButton(wrapper).trigger('click')
    await flushPromises()
    expect(memoryClient.clear).toHaveBeenCalledWith('deepchat')

    await wrapper.setProps({ agentId: 'other-agent' })
    await flushPromises()
    const healthCallsAfterAgentSwitch = memoryClient.getHealth.mock.calls.length

    pending.resolve(0)
    await flushPromises()
    await flushPromises()

    expect(memoryClient.getHealth).toHaveBeenCalledTimes(healthCallsAfterAgentSwitch)
    expect(toast).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
