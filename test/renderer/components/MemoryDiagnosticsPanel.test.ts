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
import enSettings from '../../../src/renderer/src/i18n/en-US/settings.json'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const ButtonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const AlertDialogStub = defineComponent({
  name: 'AlertDialog',
  props: { open: { type: Boolean, default: false } },
  template: '<div v-if="open"><slot /></div>'
})

const stubs = {
  DcButton: ButtonStub,
  Badge: passthrough('Badge'),
  AlertDialog: AlertDialogStub,
  AlertDialogAction: ButtonStub,
  AlertDialogAsyncAction: ButtonStub,
  AlertDialogCancel: ButtonStub,
  AlertDialogContent: passthrough('AlertDialogContent'),
  AlertDialogDescription: passthrough('AlertDialogDescription'),
  AlertDialogFooter: passthrough('AlertDialogFooter'),
  AlertDialogHeader: passthrough('AlertDialogHeader'),
  AlertDialogTitle: passthrough('AlertDialogTitle'),
  AlertDialogTrigger: passthrough('AlertDialogTrigger'),
  Icon: passthrough('Icon'),
  Spinner: passthrough('Spinner')
}

const baseStatus: MemoryStatusDto = {
  total: 0,
  pendingEmbedding: 0,
  hasPersona: false,
  activeMemoryCount: 0,
  archivedMemoryCount: 0,
  conflictCount: 0,
  personaDraftCount: 0,
  directiveDraftCount: 0,
  activeDirectiveCount: 0,
  personaVersionCount: 0,
  reindexing: false
}

const failedReindexStatus: MemoryStatusDto = {
  ...baseStatus,
  pendingEmbedding: 2,
  lastReindex: {
    outcome: 'blocked',
    finishedAt: 1,
    lastError: {
      message: 'embedding service unavailable',
      retryable: true
    }
  }
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
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
    health?: MemoryHealthDto
  } = {}
) {
  vi.resetModules()
  const memoryClient = {
    getHealth: vi.fn().mockResolvedValue(options.health ?? baseHealth),
    getArchiveCandidateLifecyclePreview: vi.fn().mockResolvedValue(basePreview),
    listAuditEvents: vi.fn().mockResolvedValue(options.auditEvents ?? []),
    reindex: vi.fn().mockResolvedValue({ started: true }),
    clear: vi.fn().mockResolvedValue({ removed: 0, cleanupPendingRestart: false })
  }
  const t = vi.fn((key: string, params?: Record<string, string | number>) => {
    const message = options.messages?.[key] ?? key
    if (!params) return message
    return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder
    )
  })
  const te = vi.fn((key: string) => Object.hasOwn(options.messages ?? {}, key))

  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
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
  return { wrapper, memoryClient, t, te }
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

async function confirmClearAll(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  await wrapper.get('[data-testid="memory-clear-all-trigger"]').trigger('click')
  await wrapper.get('[data-testid="memory-clear-all-confirm"]').trigger('click')
}

describe('MemoryDiagnosticsPanel', () => {
  it('states that clear preserves standing directives', () => {
    const clearCopy = enSettings.deepchatAgents.memoryManager

    expect(clearCopy.clearAll).toBe('Clear memories')
    expect(clearCopy.clearConfirmTitle).toContain('factual memories and persona')
    expect(clearCopy.clearConfirmBody).toContain('Standing directives are kept')
  })

  it('renders Agent recall and process-wide pipeline pressure', async () => {
    const health: MemoryHealthDto = structuredClone(baseHealth)
    health.runtime.agent.retrieval.recall.latencyMs.total = {
      samples: 4,
      p50: 12,
      p95: 48,
      max: 50
    }
    health.runtime.agent.retrieval.recall.degradationCounts.vectorCold = 3
    health.runtime.process.extractionQueue.depth = 2
    health.runtime.process.extractionQueue.oldestQueuedAgeMs = 1250
    health.runtime.process.embeddingBacklog.pending = 7
    health.runtime.process.vector.openStores = 4
    health.runtime.process.vector.openStoresHighWater = 6
    health.runtime.process.vector.activeLeasesHighWater = 5
    health.runtime.process.providerAdmission.raceEvents.deadline = 1
    health.runtime.process.providerAdmission.admissionDecisions.rateLimited = 2
    const providerPressureSummary =
      'Rate limit {rateLimited} · Capacity {capacityRejected} · Deadline {deadline} · Aborted {aborted} · Late settle {lateSettled}'
    const { wrapper, t } = await setup(baseStatus, {
      health,
      messages: { 'settings.memory.redesign.providerPressureSummary': providerPressureSummary }
    })

    const pipeline = wrapper.get('[data-testid="runtime-pipeline"]')
    expect(pipeline.text()).toContain('12')
    expect(pipeline.text()).toContain('48')
    expect(pipeline.text()).toContain('1250')
    expect(pipeline.text()).toContain('7')
    expect(pipeline.text()).toContain('Rate limit 2')
    expect(pipeline.text()).toContain('Deadline 1')
    expect(t).toHaveBeenCalledWith('settings.memory.redesign.providerPressureSummary', {
      rateLimited: 2,
      capacityRejected: 0,
      deadline: 1,
      aborted: 0,
      lateSettled: 0
    })
    expect(pipeline.text()).toContain('settings.memory.redesign.processWideDescription')
    wrapper.unmount()
  })

  it('renders missing latency and queue-age samples as unavailable', async () => {
    const { wrapper } = await setup(baseStatus, { health: structuredClone(baseHealth) })

    const pipeline = wrapper.get('[data-testid="runtime-pipeline"]')
    expect(pipeline.text().match(/—/g)?.length).toBeGreaterThanOrEqual(3)
    expect(pipeline.text()).not.toContain('0ms')
    wrapper.unmount()
  })

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

  it('shows a persistent failed-reindex banner with the sanitized reason and retry action', async () => {
    const message =
      'Vector index rebuild did not finish: {reason}. Memory content was not lost; keyword recall is currently active.'
    const { wrapper, memoryClient } = await setup(failedReindexStatus, {
      messages: {
        'settings.memory.redesign.reindexIncomplete': message,
        'settings.memory.redesign.reindexInternalReason':
          'The local embedding pipeline could not complete the rebuild.'
      }
    })

    const banner = wrapper.get('[data-testid="reindex-failure-banner"]')
    expect(banner.text()).not.toContain('embedding service unavailable')
    expect(banner.text()).toContain('The local embedding pipeline could not complete the rebuild.')
    expect(banner.text()).toContain('Memory content was not lost')
    expect(banner.text()).toContain('keyword recall is currently active')

    await banner.get('button').trigger('click')
    await flushPromises()
    expect(memoryClient.reindex).toHaveBeenCalledWith('deepchat')
    expect(wrapper.find('[data-testid="reindex-failure-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows restart guidance without a retry action for non-retryable failures', async () => {
    const status: MemoryStatusDto = {
      ...failedReindexStatus,
      lastReindex: {
        outcome: 'blocked',
        finishedAt: 1,
        lastError: {
          message: '[Memory] vector store cleanup pending restart',
          retryable: false,
          code: 'pending-restart'
        }
      }
    }
    const { wrapper, memoryClient } = await setup(status, {
      messages: {
        'settings.memory.redesign.reindexIncomplete': 'Rebuild failed: {reason}',
        'settings.deepchatAgents.memoryManager.cleanupPendingRestart':
          'Locked vector files will be deleted after restart'
      }
    })

    const banner = wrapper.get('[data-testid="reindex-failure-banner"]')
    expect(banner.text()).toContain('Locked vector files will be deleted after restart')
    expect(banner.find('button').exists()).toBe(false)
    expect(memoryClient.reindex).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('localizes internal reindex failures instead of rendering backend control-flow text', async () => {
    const status: MemoryStatusDto = {
      ...failedReindexStatus,
      lastReindex: {
        outcome: 'blocked',
        finishedAt: 1,
        lastError: {
          message: '[Memory] embedding provider returned invalid vectors',
          retryable: true,
          code: 'embedding-invalid'
        }
      }
    }
    const { wrapper } = await setup(status, {
      messages: {
        'settings.memory.redesign.reindexIncomplete': 'Rebuild failed: {reason}',
        'settings.memory.redesign.reindexInternalReason': 'Localized internal reason'
      }
    })

    const banner = wrapper.get('[data-testid="reindex-failure-banner"]')
    expect(banner.text()).toContain('Localized internal reason')
    expect(banner.text()).not.toContain('embedding provider returned invalid vectors')
    wrapper.unmount()
  })

  it('hides old reindex results while running and after a successful rebuild', async () => {
    const { wrapper } = await setup({ ...failedReindexStatus, reindexing: true })

    expect(wrapper.find('[data-testid="reindex-failure-banner"]').exists()).toBe(false)

    await wrapper.setProps({
      status: {
        ...baseStatus,
        lastReindex: {
          outcome: 'completed',
          finishedAt: 2,
          lastError: null
        }
      }
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="reindex-failure-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not carry a reindex failure banner across an agent switch', async () => {
    const { wrapper } = await setup(failedReindexStatus)
    expect(wrapper.find('[data-testid="reindex-failure-banner"]').exists()).toBe(true)

    await wrapper.setProps({ agentId: 'other-agent', status: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="reindex-failure-banner"]').exists()).toBe(false)
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

    await confirmClearAll(wrapper)
    await flushPromises()

    expect(memoryClient.clear).toHaveBeenCalledWith('deepchat')
    expect(memoryClient.getHealth).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="memory-clear-all-confirm"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the confirmation mounted while the post-clear reload is pending', async () => {
    const { wrapper, memoryClient } = await setup()
    const pendingHealth = deferred<MemoryHealthDto>()
    memoryClient.getHealth.mockReturnValueOnce(pendingHealth.promise)

    await confirmClearAll(wrapper)
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-clear-all-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="memory-clear-all-spinner"]').exists()).toBe(true)

    pendingHealth.resolve(baseHealth)
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-clear-all-confirm"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('disables clear confirmation while a background diagnostics reload is pending', async () => {
    const { wrapper, memoryClient } = await setup()
    const pendingHealth = deferred<MemoryHealthDto>()

    await wrapper.get('[data-testid="memory-clear-all-trigger"]').trigger('click')
    memoryClient.getHealth.mockReturnValueOnce(pendingHealth.promise)
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()

    const confirm = wrapper.get('[data-testid="memory-clear-all-confirm"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    await confirm.trigger('click')
    expect(memoryClient.clear).not.toHaveBeenCalled()

    pendingHealth.resolve(baseHealth)
    await flushPromises()

    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    await flushPromises()

    expect(memoryClient.clear).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="memory-clear-all-confirm"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps clear-all progress and failure feedback inside the confirmation', async () => {
    const { wrapper, memoryClient } = await setup()
    const pending = deferred<{ removed: number; cleanupPendingRestart: boolean }>()
    memoryClient.clear.mockReturnValueOnce(pending.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await confirmClearAll(wrapper)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="memory-clear-all-confirm"]').attributes('disabled')
    ).toBeDefined()
    expect(
      wrapper.get('[data-testid="memory-clear-all-cancel"]').attributes('disabled')
    ).toBeDefined()
    expect(wrapper.find('[data-testid="memory-clear-all-spinner"]').exists()).toBe(true)

    pending.reject(new Error('clear failed'))
    await flushPromises()

    const feedback = wrapper.get('[data-testid="memory-inline-feedback"]')
    expect(feedback.attributes('data-tone')).toBe('error')
    expect(feedback.text()).toContain('settings.deepchatAgents.memoryManager.actionFailed')
    expect(wrapper.find('[data-testid="memory-clear-all-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="memory-clear-all-confirm"]').trigger('click')
    await flushPromises()

    expect(memoryClient.clear).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="memory-clear-all-confirm"]').exists()).toBe(false)
    consoleError.mockRestore()
    wrapper.unmount()
  })

  it('shows a restart cleanup notice for quarantined vector files', async () => {
    const { wrapper, memoryClient } = await setup()
    memoryClient.clear.mockResolvedValueOnce({ removed: 3, cleanupPendingRestart: true })

    await confirmClearAll(wrapper)
    await flushPromises()

    const feedback = wrapper.get('[data-testid="memory-inline-feedback"]')
    expect(feedback.attributes('data-tone')).toBe('warning')
    expect(feedback.text()).toContain('settings.deepchatAgents.memoryManager.cleanupPendingRestart')
    wrapper.unmount()
  })

  it('drops a stale clear-all response after the agent changes', async () => {
    const { wrapper, memoryClient } = await setup()
    const pending = deferred<{ removed: number; cleanupPendingRestart: boolean }>()
    memoryClient.clear.mockReturnValueOnce(pending.promise)

    await confirmClearAll(wrapper)
    await flushPromises()
    expect(memoryClient.clear).toHaveBeenCalledWith('deepchat')

    await wrapper.setProps({ agentId: 'other-agent' })
    await flushPromises()
    const healthCallsAfterAgentSwitch = memoryClient.getHealth.mock.calls.length

    pending.resolve({ removed: 0, cleanupPendingRestart: false })
    await flushPromises()
    await flushPromises()

    expect(memoryClient.getHealth).toHaveBeenCalledTimes(healthCallsAfterAgentSwitch)
    expect(wrapper.find('[data-testid="memory-inline-feedback"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
