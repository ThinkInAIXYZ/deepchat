import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { CronJob, CronJobRun, CronJobsSchedulerStatus } from '../../../src/shared/cronJobs'
import type { CronJobsClient, CronJobsUpsertInput } from '../../../src/renderer/api/CronJobsClient'

const JOB_FIXTURE: CronJob = {
  id: 'job-1',
  name: 'Morning report',
  description: null,
  enabled: true,
  status: 'ready',
  cronExpr: '0 9 * * *',
  timezone: 'UTC',
  agentId: null,
  nextRunAt: 2_000,
  misfirePolicy: 'skip',
  maxCatchUpRuns: null,
  scheduleError: null,
  taskPrompt: 'Summarize the day',
  taskSystemInstruction: null,
  taskOutputMode: 'final_message',
  modelPolicy: 'follow_agent',
  toolPolicy: 'follow_agent',
  permissionPolicy: 'follow_agent',
  runtime: {
    maxDurationMs: 60_000,
    maxTurns: 20,
    concurrencyPolicy: 'skip'
  },
  agentSnapshot: null,
  delivery: {
    targets: [],
    suppressSuccessNotification: false,
    notifyOnFailure: true
  },
  createdAt: 1_000,
  updatedAt: 1_000
}

const STATUS_FIXTURE: CronJobsSchedulerStatus = {
  state: 'running',
  pid: 42,
  enabledJobCount: 1,
  nextRunAt: 2_000,
  lastHeartbeatAt: 1_500,
  lastError: null,
  restartAttempts: 0,
  updatedAt: 1_500
}

const RUN_FIXTURE: CronJobRun = {
  id: 'run-1',
  jobId: JOB_FIXTURE.id,
  sessionId: null,
  scheduledAt: 2_000,
  queuedAt: 2_000,
  startedAt: 2_010,
  completedAt: 2_100,
  status: 'completed',
  reason: 'manual',
  outputMessageId: null,
  outputPreview: null,
  error: null,
  claimedAt: 2_005,
  claimOwner: 'scheduler',
  createdAt: 2_000,
  updatedAt: 2_100
}

const cloneJob = (job: CronJob = JOB_FIXTURE): CronJob => structuredClone(job)
const cloneStatus = (): CronJobsSchedulerStatus => structuredClone(STATUS_FIXTURE)

const passthrough = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    template: '<div v-bind="$attrs"><slot /></div>'
  })

const settingsPageShellStub = defineComponent({
  name: 'SettingsPageShell',
  inheritAttrs: false,
  template:
    '<main v-bind="$attrs"><div data-testid="shell-actions"><slot name="actions" /></div><slot /></main>'
})

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  props: { disabled: Boolean },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const inputStub = defineComponent({
  name: 'Input',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    disabled: Boolean
  },
  emits: ['update:modelValue', 'blur'],
  setup(_, { emit }) {
    return {
      handleInput: (event: Event) => {
        emit('update:modelValue', (event.target as HTMLInputElement).value)
      }
    }
  },
  template:
    '<input v-bind="$attrs" :value="modelValue" :disabled="disabled" @input="handleInput" @blur="$emit(\'blur\')" />'
})

const textareaStub = defineComponent({
  name: 'Textarea',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    disabled: Boolean
  },
  emits: ['update:modelValue', 'blur'],
  setup(_, { emit }) {
    return {
      handleInput: (event: Event) => {
        emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
      }
    }
  },
  template:
    '<textarea v-bind="$attrs" :value="modelValue" :disabled="disabled" @input="handleInput" @blur="$emit(\'blur\')" />'
})

const switchStub = defineComponent({
  name: 'Switch',
  inheritAttrs: false,
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue'],
  template:
    '<button v-bind="$attrs" role="switch" :disabled="disabled" :aria-checked="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />'
})

const dialogStub = defineComponent({
  name: 'Dialog',
  props: { open: Boolean },
  emits: ['update:open'],
  template: '<div v-if="open" data-testid="cron-delete-dialog"><slot /></div>'
})

const mountedWrappers: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  vi.restoreAllMocks()
})

type SetupOptions = Readonly<{
  list?: CronJobsClient['list']
  upsert?: CronJobsClient['upsert']
  remove?: CronJobsClient['remove']
  toggle?: CronJobsClient['toggle']
  runNow?: CronJobsClient['runNow']
  restartScheduler?: CronJobsClient['restartScheduler']
}>

const jobFromInput = (input: CronJobsUpsertInput): CronJob => ({
  ...cloneJob(),
  ...input,
  id: input.id ?? JOB_FIXTURE.id,
  description: JOB_FIXTURE.description,
  status: JOB_FIXTURE.status,
  nextRunAt: JOB_FIXTURE.nextRunAt,
  scheduleError: JOB_FIXTURE.scheduleError,
  agentSnapshot: JOB_FIXTURE.agentSnapshot,
  runtime: input.runtime ?? JOB_FIXTURE.runtime,
  createdAt: JOB_FIXTURE.createdAt,
  updatedAt: JOB_FIXTURE.updatedAt + 1
})

async function setup(options: SetupOptions = {}) {
  vi.resetModules()
  const cronClient = {
    list: vi.fn(
      options.list ??
        (async () => ({
          jobs: [cloneJob()],
          schedulerStatus: cloneStatus()
        }))
    ),
    upsert: vi.fn(
      options.upsert ??
        (async (input: CronJobsUpsertInput) => ({
          job: jobFromInput(input),
          schedulerStatus: cloneStatus()
        }))
    ),
    remove: vi.fn(options.remove ?? (async () => cloneStatus())),
    toggle: vi.fn(
      options.toggle ??
        (async (_id: string, enabled: boolean) => ({
          job: { ...cloneJob(), enabled },
          schedulerStatus: cloneStatus()
        }))
    ),
    runNow: vi.fn(
      options.runNow ??
        (async () => ({
          job: cloneJob(),
          run: structuredClone(RUN_FIXTURE),
          schedulerStatus: cloneStatus()
        }))
    ),
    listRuns: vi.fn(async () => []),
    listDeliveries: vi.fn(async () => []),
    getSchedulerStatus: vi.fn(async () => cloneStatus()),
    restartScheduler: vi.fn(options.restartScheduler ?? (async () => cloneStatus())),
    previewSchedule: vi.fn(async () => ({ runs: [2_000, 3_000], error: null }))
  }
  const configClient = {
    listAgents: vi.fn(async () => [])
  }
  const remoteControlClient = {
    listRemoteChannels: vi.fn(async () => []),
    getChannelStatus: vi.fn(),
    getChannelBindings: vi.fn()
  }
  const notifyRenderer = vi.fn(() => true)

  vi.doMock('@api/CronJobsClient', () => ({
    createCronJobsClient: () => cronClient
  }))
  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@api/RemoteControlClient', () => ({
    createRemoteControlClient: () => remoteControlClient
  }))
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => {
        const messages: Record<string, string> = {
          'settings.cronJobs.title': 'Scheduled',
          'settings.cronJobs.description': 'Manage scheduled tasks',
          'settings.cronJobs.defaults.name': 'New job',
          'settings.cronJobs.actions.newJob': 'New job',
          'settings.cronJobs.actions.restart': 'Restart',
          'settings.cronJobs.actions.runNow': 'Run now',
          'settings.cronJobs.runNowSuccess': 'Task finished',
          'settings.cronJobs.empty': 'No tasks',
          'settings.cronJobs.none': 'None',
          'settings.cronJobs.fields.name': 'Name',
          'settings.cronJobs.fields.agent': 'Agent',
          'settings.cronJobs.fields.noAgent': 'None selected',
          'settings.cronJobs.fields.timezone': 'Timezone',
          'settings.cronJobs.fields.cronExpr': 'Cron expression',
          'settings.cronJobs.fields.taskPrompt': 'Task prompt',
          'settings.cronJobs.fields.runtimePolicy': 'Runtime',
          'settings.cronJobs.fields.followAgent': 'Follow agent',
          'settings.cronJobs.fields.pinCurrent': 'Pin current',
          'settings.cronJobs.fields.delivery': 'Delivery',
          'settings.cronJobs.fields.remoteDelivery': 'Remote delivery',
          'settings.cronJobs.fields.noRemoteChannels': 'No remote channels',
          'settings.cronJobs.status.state': 'State',
          'settings.cronJobs.status.enabled': 'Enabled',
          'settings.cronJobs.status.heartbeat': 'Heartbeat',
          'settings.cronJobs.status.running': 'Running',
          'common.loading': 'Loading',
          'common.saving': 'Saving',
          'common.saved': 'Saved',
          'common.retry': 'Retry',
          'common.delete': 'Delete',
          'common.cancel': 'Cancel',
          'common.history': 'History',
          'common.enabled': 'Enabled',
          'common.disabled': 'Disabled',
          'common.error.operationFailed': 'Operation failed',
          'common.error.requestFailed': 'Request failed'
        }
        return messages[key] ?? key
      }
    })
  }))

  const CronJobsSettings = (
    await import('../../../src/renderer/settings/components/CronJobsSettings.vue')
  ).default
  const wrapper = mount(CronJobsSettings, {
    global: {
      stubs: {
        SettingsPageShell: settingsPageShellStub,
        Badge: passthrough('Badge'),
        DcButton: buttonStub,
        Dialog: dialogStub,
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        Input: inputStub,
        Label: passthrough('Label'),
        Select: passthrough('Select'),
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue'),
        Switch: switchStub,
        Textarea: textareaStub,
        Spinner: true,
        Icon: true
      }
    }
  })
  mountedWrappers.push(wrapper)
  await flushPromises()
  const { settingsLeaveGuard } =
    await import('../../../src/renderer/settings/services/settingsLeaveGuard')

  return { wrapper, cronClient, notifyRenderer, settingsLeaveGuard }
}

describe('CronJobsSettings', () => {
  it('retries an inline load failure without exposing exception details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let attempt = 0
    const { wrapper, cronClient } = await setup({
      list: async () => {
        attempt += 1
        if (attempt === 1) {
          throw new Error('/private/cron-jobs.db')
        }
        return {
          jobs: [cloneJob()],
          schedulerStatus: cloneStatus()
        }
      }
    })

    expect(wrapper.text()).toContain('Operation failed')
    expect(wrapper.text()).not.toContain('/private/cron-jobs.db')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Retry')!
      .trigger('click')
    await flushPromises()

    expect(cronClient.list).toHaveBeenCalledTimes(2)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Morning report')
    consoleError.mockRestore()
  })

  it('keeps a failed draft and lets the leave guard restore the persisted job', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, settingsLeaveGuard, notifyRenderer } = await setup({
      upsert: async () => {
        throw new Error('/private/scheduler-token')
      }
    })
    const nameInput = wrapper.get('input')

    await nameInput.setValue('Unsaved report')
    await nameInput.trigger('blur')
    await flushPromises()

    expect((nameInput.element as HTMLInputElement).value).toBe('Unsaved report')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.cronJobs.saveFailed',
        title: 'Operation failed'
      })
    )
    expect(wrapper.text()).not.toContain('/private/scheduler-token')
    expect(wrapper.get('[data-testid="cron-jobs-add"]').attributes('disabled')).toBeDefined()

    const leave = settingsLeaveGuard.requestLeave()
    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await expect(leave).resolves.toBe(true)
    await flushPromises()

    expect((nameInput.element as HTMLInputElement).value).toBe('Morning report')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    consoleError.mockRestore()
  })

  it('blocks conflicting mutations while a job save is pending', async () => {
    let resolveSave!: (value: Awaited<ReturnType<CronJobsClient['upsert']>>) => void
    const { wrapper, cronClient } = await setup({
      upsert: async () =>
        await new Promise<Awaited<ReturnType<CronJobsClient['upsert']>>>((resolve) => {
          resolveSave = resolve
        })
    })
    const nameInput = wrapper.get('input')

    await nameInput.setValue('Serialized report')
    await nameInput.trigger('blur')
    await flushPromises()

    const enabledSwitch = wrapper.get('button[role="switch"]')
    expect(enabledSwitch.attributes('disabled')).toBeDefined()
    await enabledSwitch.trigger('click')
    expect(cronClient.toggle).not.toHaveBeenCalled()

    const request = cronClient.upsert.mock.calls[0][0]
    resolveSave({
      job: jobFromInput(request),
      schedulerStatus: cloneStatus()
    })
    await flushPromises()

    expect((nameInput.element as HTMLInputElement).value).toBe('Serialized report')
    expect(enabledSwitch.attributes('disabled')).toBeUndefined()
  })

  it('keeps delete confirmation open when deletion fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, notifyRenderer } = await setup({
      remove: async () => {
        throw new Error('database unavailable')
      }
    })

    await wrapper.get('button[aria-label="Delete"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('[data-testid="cron-delete-dialog"]')
    expect(dialog.text()).toContain('Morning report')

    await dialog
      .findAll('button')
      .find((button) => button.text() === 'Delete')!
      .trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="cron-delete-dialog"]').exists()).toBe(true)
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.cronJobs.deleteFailed',
        title: 'Operation failed'
      })
    )
    expect(wrapper.get('button[aria-label="Delete"]').exists()).toBe(true)
    consoleError.mockRestore()
  })

  it('reports a resolved failed run as an error instead of success', async () => {
    const { wrapper, notifyRenderer } = await setup({
      runNow: async () => ({
        job: cloneJob(),
        run: {
          ...structuredClone(RUN_FIXTURE),
          status: 'failed',
          error: 'provider secret'
        },
        schedulerStatus: cloneStatus()
      })
    })

    await wrapper.get('button[title="Run now"]').trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.cronJobs.runFailed',
      title: 'Operation failed'
    })
    expect(wrapper.text()).not.toContain('Task finished')
    expect(wrapper.text()).not.toContain('provider secret')
  })

  it('reports a started manual run without treating it as a failure', async () => {
    const { wrapper, notifyRenderer } = await setup({
      runNow: async () => ({
        job: cloneJob(),
        run: { ...structuredClone(RUN_FIXTURE), status: 'running', completedAt: null },
        schedulerStatus: cloneStatus()
      })
    })

    await wrapper.get('button[title="Run now"]').trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'success',
      code: 'settings.cronJobs.runStarted',
      title: 'Run now',
      description: 'Morning report'
    })
  })

  it('reports a completed manual run without adding inline feedback', async () => {
    const { wrapper, notifyRenderer } = await setup()

    await wrapper.get('button[title="Run now"]').trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'success',
      code: 'settings.cronJobs.runCompleted',
      title: 'Task finished',
      description: 'Morning report'
    })
  })

  it('reports scheduler restart failures as transient feedback', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, notifyRenderer } = await setup({
      restartScheduler: async () => {
        throw new Error('scheduler socket unavailable')
      }
    })
    const restartButton = wrapper.findAll('button').find((button) => button.text() === 'Restart')
    if (!restartButton) throw new Error('Restart button not found')

    await restartButton.trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.cronJobs.restartFailed',
      title: 'Operation failed'
    })
    expect(wrapper.text()).not.toContain('scheduler socket unavailable')
    consoleError.mockRestore()
  })
})
