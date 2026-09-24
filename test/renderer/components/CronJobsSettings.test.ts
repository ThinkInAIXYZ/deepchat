import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, inject, onMounted, onUpdated, provide, ref } from 'vue'
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

const passthrough = (name: string, template = '<div v-bind="$attrs"><slot /></div>') =>
  defineComponent({
    name,
    inheritAttrs: false,
    template
  })

const buttonStub = defineComponent({
  name: 'DcButton',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    loading: Boolean,
    variant: String,
    size: String,
    icon: String,
    label: String,
    tooltip: String,
    active: Boolean,
    iconSize: String
  },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled || loading" @click="$emit(\'click\', $event)"><slot /></button>'
})

const inputStub = defineComponent({
  name: 'Input',
  inheritAttrs: false,
  props: {
    modelValue: { type: [String, Number], default: '' },
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

const toggleRowStub = defineComponent({
  name: 'DcToggleRow',
  inheritAttrs: false,
  props: {
    id: String,
    label: String,
    description: String,
    modelValue: Boolean,
    disabled: Boolean
  },
  emits: ['update:modelValue'],
  template:
    '<button v-bind="$attrs" :id="id" role="switch" :disabled="disabled" :aria-checked="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>'
})

const selectStub = defineComponent({
  name: 'Select',
  inheritAttrs: false,
  props: {
    modelValue: { type: [String, Number, Boolean], default: undefined },
    disabled: Boolean
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const selectRef = ref<HTMLSelectElement | null>(null)
    const syncValue = () => {
      if (selectRef.value && props.modelValue !== undefined) {
        selectRef.value.value = String(props.modelValue)
      }
    }
    onMounted(syncValue)
    onUpdated(syncValue)
    return {
      selectRef,
      handleChange: (event: Event) => {
        emit('update:modelValue', (event.target as HTMLSelectElement).value)
      }
    }
  },
  template:
    '<select ref="selectRef" v-bind="$attrs" :disabled="disabled" @change="handleChange"><slot /></select>'
})

const selectItemStub = defineComponent({
  name: 'SelectItem',
  props: { value: { type: [String, Number], required: true } },
  template: '<option :value="value"><slot /></option>'
})

const dropdownActionItemStub = defineComponent({
  name: 'DcDropdownActionItem',
  inheritAttrs: false,
  props: { icon: String, label: String, danger: Boolean, disabled: Boolean },
  emits: ['select'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'select\')">{{ label }}</button>'
})

/**
 * The real menu renders its content only while it is open. A passthrough stub would always render
 * the actions, letting a test click an item whose trigger never worked, so the trigger is what
 * toggles the shared open state and the content only renders once it has.
 */
const DROPDOWN_MENU_OPEN = Symbol('dropdownMenuOpen')

const dropdownMenuStub = defineComponent({
  name: 'DropdownMenu',
  inheritAttrs: false,
  setup() {
    provide(DROPDOWN_MENU_OPEN, ref(false))
  },
  template: '<div v-bind="$attrs"><slot /></div>'
})

const dropdownMenuTriggerStub = defineComponent({
  name: 'DropdownMenuTrigger',
  inheritAttrs: false,
  props: { asChild: Boolean },
  setup() {
    const open = inject(DROPDOWN_MENU_OPEN, ref(false))
    return {
      toggleOpen: () => {
        open.value = !open.value
      }
    }
  },
  template: '<span v-bind="$attrs" @click="toggleOpen"><slot /></span>'
})

const dropdownMenuContentStub = defineComponent({
  name: 'DropdownMenuContent',
  inheritAttrs: false,
  setup() {
    return { open: inject(DROPDOWN_MENU_OPEN, ref(false)) }
  },
  template: '<div v-if="open" v-bind="$attrs"><slot /></div>'
})

const inlineErrorStub = defineComponent({
  name: 'DcInlineError',
  props: { error: String, hint: String },
  template: '<p v-if="error || hint" role="alert">{{ error ?? hint }}</p>'
})

const sectionCardStub = defineComponent({
  name: 'DcSectionCard',
  inheritAttrs: false,
  template: '<section v-bind="$attrs"><slot name="header" /><slot /></section>'
})

const emptyStub = defineComponent({
  name: 'DcEmpty',
  inheritAttrs: false,
  props: { icon: String, title: String, description: String },
  template:
    '<div v-bind="$attrs"><div>{{ title }}</div><div>{{ description }}</div><slot /><slot name="action" /></div>'
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
  vi.useRealTimers()
})

type SetupOptions = Readonly<{
  list?: CronJobsClient['list']
  upsert?: CronJobsClient['upsert']
  remove?: CronJobsClient['remove']
  toggle?: CronJobsClient['toggle']
  runNow?: CronJobsClient['runNow']
  listRuns?: CronJobsClient['listRuns']
  restartScheduler?: CronJobsClient['restartScheduler']
}>

const jobFromInput = (input: CronJobsUpsertInput): CronJob => ({
  ...cloneJob(),
  ...input,
  id: input.id ?? 'job-created',
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
    listRuns: vi.fn(options.listRuns ?? (async (): Promise<CronJobRun[]> => [])),
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
      t: (key: string, params?: Record<string, unknown>) => {
        const messages: Record<string, string> = {
          'settings.cronJobs.title': 'Scheduled',
          'settings.cronJobs.description': 'Manage scheduled tasks',
          'settings.cronJobs.defaults.name': 'New job',
          'settings.cronJobs.empty': 'No tasks',
          'settings.cronJobs.none': 'None',
          'settings.cronJobs.nextRunAt': 'Next run',
          'settings.cronJobs.created': 'Task created',
          'settings.cronJobs.actions.newJob': 'New job',
          'settings.cronJobs.actions.create': 'Create',
          'settings.cronJobs.actions.createFirstTask': 'Create first task',
          'settings.cronJobs.actions.runNow': 'Run now',
          'settings.cronJobs.actions.restart': 'Restart',
          'settings.cronJobs.actions.backToList': 'Back to list',
          'settings.cronJobs.actions.schedulerDetails': 'Scheduler details',
          'settings.cronJobs.list.enabledGroup': 'Enabled tasks',
          'settings.cronJobs.list.disabledGroup': 'Disabled tasks',
          'settings.cronJobs.fields.name': 'Name',
          'settings.cronJobs.fields.agent': 'Agent',
          'settings.cronJobs.fields.noAgent': 'None selected',
          'settings.cronJobs.fields.timezone': 'Timezone',
          'settings.cronJobs.fields.cronExpr': 'Cron expression',
          'settings.cronJobs.fields.preset': 'Preset',
          'settings.cronJobs.fields.taskPrompt': 'Task prompt',
          'settings.cronJobs.fields.runtimePolicy': 'Runtime',
          'settings.cronJobs.fields.followAgent': 'Follow agent',
          'settings.cronJobs.fields.pinCurrent': 'Pin current',
          'settings.cronJobs.fields.delivery': 'Delivery',
          'settings.cronJobs.fields.remoteDelivery': 'Remote delivery',
          'settings.cronJobs.fields.remoteChannel': 'Remote channel',
          'settings.cronJobs.fields.noRemoteChannels': 'No remote channels',
          'settings.cronJobs.fields.schedule': 'Schedule',
          'settings.cronJobs.fields.scheduleTime': 'Time',
          'settings.cronJobs.fields.createEnabled': 'Enable after creation',
          'settings.cronJobs.presets.custom': 'Custom',
          'settings.cronJobs.presets.every5Minutes': 'Every 5 minutes',
          'settings.cronJobs.presets.hourly': 'Hourly',
          'settings.cronJobs.presets.daily': 'Daily',
          'settings.cronJobs.presets.weekdays': 'Weekdays',
          'settings.cronJobs.presets.weekly': 'Weekly',
          'settings.cronJobs.presets.monthly': 'Monthly',
          'settings.cronJobs.weekdays.mon': 'Monday',
          'settings.cronJobs.schedule.daily': 'Daily at {time}',
          'settings.cronJobs.schedule.weekly': 'Every {weekday} at {time}',
          'settings.cronJobs.detail.placeholderTitle': 'Select a task',
          'settings.cronJobs.detail.placeholderDescription': 'Pick a task to review its details',
          'settings.cronJobs.detail.scheduleTitle': 'Schedule',
          'settings.cronJobs.detail.lastRun': 'Last run',
          'settings.cronJobs.detail.neverRun': 'Never run',
          'settings.cronJobs.detail.promptEmpty': 'No task prompt yet',
          'settings.cronJobs.detail.promptPlaceholder': 'Describe the task',
          'settings.cronJobs.detail.deliveryDisabled': 'Delivery is off',
          'settings.cronJobs.detail.historyTitle': 'Run history',
          'settings.cronJobs.detail.noRuns': 'No runs yet',
          'settings.cronJobs.detail.unsaved': 'Unsaved changes',
          'settings.cronJobs.detail.basicsTitle': 'Basics',
          'settings.cronJobs.detail.createTitle': 'New task',
          'settings.cronJobs.detail.editTitle': 'Edit task',
          'settings.cronJobs.detail.deleteConfirm': 'Delete task "{name}"?',
          'settings.cronJobs.emptyState.title': 'No scheduled tasks yet',
          'settings.cronJobs.emptyState.description': 'Scheduled tasks run an agent on schedule',
          'settings.cronJobs.emptyState.templatesTitle': 'Start from a template',
          'settings.cronJobs.emptyState.templatesDescription': 'Nothing is saved until you confirm',
          'settings.cronJobs.templates.dailyDigest.name': 'Daily news digest',
          'settings.cronJobs.templates.dailyDigest.prompt': 'Summarize today important news',
          'settings.cronJobs.templates.repositoryDigest.name': 'Weekly PR report',
          'settings.cronJobs.templates.repositoryDigest.prompt': 'Summarize pull requests',
          'settings.cronJobs.templates.knowledgeTidy.name': 'Tidy knowledge base',
          'settings.cronJobs.templates.knowledgeTidy.prompt': 'Review the notes added this week',
          'settings.cronJobs.runs.reasonManual': 'Manual',
          'settings.cronJobs.runs.reasonScheduled': 'Scheduled',
          'settings.cronJobs.runs.durationSeconds': '{value}s',
          'settings.cronJobs.runs.durationMinutes': '{minutes}m {seconds}s',
          'settings.cronJobs.runs.output': 'Output',
          'settings.cronJobs.scheduler.pid': 'Process PID',
          'settings.cronJobs.scheduler.heartbeat': 'Heartbeat',
          'settings.cronJobs.scheduler.restartAttempts': 'Restarts',
          'settings.cronJobs.scheduler.updatedAt': 'Updated',
          'settings.cronJobs.scheduler.errorDescription': 'The scheduler process is failing',
          'settings.cronJobs.scheduler.staleDescription': 'Scheduler status is unavailable',
          'settings.cronJobs.status.state': 'State',
          'settings.cronJobs.status.enabled': 'Enabled',
          'settings.cronJobs.status.heartbeat': 'Heartbeat',
          'settings.cronJobs.status.ready': 'Ready',
          'settings.cronJobs.status.jobDisabled': 'Disabled',
          'settings.cronJobs.status.invalidAgentShort': 'Agent unavailable',
          'settings.cronJobs.status.invalidAgent': 'Agent is missing or disabled',
          'settings.cronJobs.status.running': 'Running',
          'settings.cronJobs.status.error': 'Error',
          'settings.cronJobs.runNowSuccess': 'Task finished',
          'chat.toolCall.subagents.status.queued': 'queued',
          'chat.toolCall.subagents.status.running': 'running',
          'chat.toolCall.subagents.status.completed': 'completed',
          'chat.toolCall.subagents.status.error': 'error',
          'chat.toolCall.subagents.status.cancelled': 'cancelled',
          'common.loading': 'Loading',
          'common.saving': 'Saving',
          'common.saved': 'Saved',
          'common.retry': 'Retry',
          'common.delete': 'Delete',
          'common.cancel': 'Cancel',
          'common.save': 'Save',
          'common.edit': 'Edit',
          'common.more': 'More',
          'common.enabled': 'Enabled',
          'common.disabled': 'Disabled',
          'common.error.operationFailed': 'Operation failed',
          'common.error.requestFailed': 'Request failed'
        }
        const template = messages[key] ?? key
        if (!params) {
          return template
        }
        return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
      }
    })
  }))

  const CronJobsSettings = (
    await import('../../../src/renderer/settings/components/CronJobsSettings.vue')
  ).default
  const wrapper = mount(CronJobsSettings, {
    global: {
      stubs: {
        DcBadge: passthrough('DcBadge'),
        DcButton: buttonStub,
        DcDropdownActionItem: dropdownActionItemStub,
        DcEmpty: emptyStub,
        DcInlineError: inlineErrorStub,
        DcSectionCard: sectionCardStub,
        DcToggleRow: toggleRowStub,
        Dialog: dialogStub,
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        DropdownMenu: dropdownMenuStub,
        DropdownMenuContent: dropdownMenuContentStub,
        DropdownMenuTrigger: dropdownMenuTriggerStub,
        Input: inputStub,
        Label: passthrough('Label'),
        Select: selectStub,
        SelectContent: passthrough('SelectContent', '<slot />'),
        SelectItem: selectItemStub,
        SelectTrigger: passthrough('SelectTrigger', '<span hidden><slot /></span>'),
        SelectValue: passthrough('SelectValue', '<span hidden><slot /></span>'),
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

const findButtonByTextOrNull = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((entry) => entry.text() === text) ?? null

const findButtonByText = (wrapper: VueWrapper, text: string) => {
  const button = findButtonByTextOrNull(wrapper, text)
  if (!button) {
    throw new Error(`Button "${text}" not found`)
  }
  return button
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

    await findButtonByText(wrapper, 'Retry').trigger('click')
    await flushPromises()

    expect(cronClient.list).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-job-id="job-1"]').text()).toContain('Morning report')
    expect(wrapper.get('[data-testid="cron-job-detail-title"]').text()).toBe('Morning report')
    consoleError.mockRestore()
  })

  it('guides an empty workspace with templates that only prefill the create form', async () => {
    const { wrapper, cronClient } = await setup({
      list: async () => ({ jobs: [], schedulerStatus: cloneStatus() })
    })

    expect(wrapper.text()).toContain('No scheduled tasks yet')
    expect(wrapper.text()).toContain('Start from a template')

    await wrapper.get('[data-testid="cron-job-template-dailyDigest"]').trigger('click')
    await flushPromises()

    expect(
      (wrapper.get('[data-testid="cron-job-name-input"]').element as HTMLInputElement).value
    ).toBe('Daily news digest')
    expect(
      (wrapper.get('[data-testid="cron-job-prompt-input"]').element as HTMLTextAreaElement).value
    ).toBe('Summarize today important news')
    expect(
      (wrapper.get('[data-testid="cron-job-cron-input"]').element as HTMLInputElement).value
    ).toBe('0 9 * * *')
    expect(cronClient.upsert).not.toHaveBeenCalled()
  })

  it('creates a task only on confirmation and honors enable-after-creation', async () => {
    const { wrapper, cronClient } = await setup({
      list: async () => ({ jobs: [], schedulerStatus: cloneStatus() })
    })

    await wrapper.get('[data-testid="cron-jobs-create-first"]').trigger('click')
    await flushPromises()

    const enabledToggle = wrapper.get('#cron-job-create-enabled')
    expect(enabledToggle.attributes('aria-checked')).toBe('false')
    await enabledToggle.trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="cron-job-editor-save"]').trigger('click')
    await flushPromises()

    expect(cronClient.upsert).toHaveBeenCalledTimes(1)
    const payload = cronClient.upsert.mock.calls[0][0]
    expect(payload.id).toBeUndefined()
    expect(payload.enabled).toBe(true)
    expect(payload.name).toBe('New job')
    expect(wrapper.get('[data-testid="cron-job-detail-title"]').text()).toBe('New job')
  })

  it('edits the selected task and persists the draft only on save', async () => {
    const { wrapper, cronClient } = await setup()

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="cron-job-editor-delete"]').exists()).toBe(true)

    await wrapper.get('[data-testid="cron-job-name-input"]').setValue('Renamed report')
    await flushPromises()
    expect(cronClient.upsert).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="cron-job-dirty-hint"]').exists()).toBe(true)

    await wrapper.get('[data-testid="cron-job-editor-save"]').trigger('click')
    await flushPromises()

    expect(cronClient.upsert).toHaveBeenCalledTimes(1)
    expect(cronClient.upsert.mock.calls[0][0]).toMatchObject({
      id: 'job-1',
      name: 'Renamed report'
    })
    expect(wrapper.find('[data-testid="cron-job-dirty-hint"]').exists()).toBe(false)
  })

  it('returns to the detail view when the editor is cancelled', async () => {
    const { wrapper, cronClient } = await setup()

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="cron-job-detail-title"]').text()).toBe('Edit task')

    await wrapper.get('[data-testid="cron-job-editor-cancel"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="cron-job-detail-title"]').text()).toBe('Morning report')
    expect(wrapper.find('[data-testid="cron-job-editor-save"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cron-job-edit"]').exists()).toBe(true)
    expect(cronClient.upsert).not.toHaveBeenCalled()
  })

  it('keeps an unsaved draft while the cancel confirmation is open', async () => {
    const { wrapper, settingsLeaveGuard } = await setup()

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="cron-job-name-input"]').setValue('Draft name')
    await flushPromises()

    await wrapper.get('[data-testid="cron-job-editor-cancel"]').trigger('click')
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().promptOpen).toBe(true)
    expect(wrapper.get('[data-testid="cron-job-detail-title"]').text()).toBe('Edit task')

    settingsLeaveGuard.cancelLeave()
    await flushPromises()

    expect(wrapper.get('[data-testid="cron-job-detail-title"]').text()).toBe('Edit task')
    expect(
      (wrapper.get('[data-testid="cron-job-name-input"]').element as HTMLInputElement).value
    ).toBe('Draft name')
  })

  it('rebuilds the cron expression from a schedule preset', async () => {
    const { wrapper } = await setup()

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()

    const presetSelect = wrapper.get('[data-testid="cron-job-preset-select"]')
    expect((presetSelect.element as HTMLSelectElement).value).toBe('daily')

    await presetSelect.setValue('weekly')
    await flushPromises()

    expect(
      (wrapper.get('[data-testid="cron-job-cron-input"]').element as HTMLInputElement).value
    ).toBe('0 9 * * 1')
  })

  it('keeps the custom preset selected for an expression a preset also describes', async () => {
    const { wrapper } = await setup()

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()

    // The select is controlled, so its `modelValue` is what it displays.
    const presetSelect = () => wrapper.getComponent('[data-testid="cron-job-preset-select"]')
    const cronInput = () => wrapper.get('[data-testid="cron-job-cron-input"]')
    expect(presetSelect().props('modelValue')).toBe('daily')
    expect((cronInput().element as HTMLInputElement).value).toBe('0 9 * * *')

    await presetSelect().setValue('custom')
    await flushPromises()

    expect(presetSelect().props('modelValue')).toBe('custom')
    expect((cronInput().element as HTMLInputElement).value).toBe('0 9 * * *')

    // Editing the expression directly leaves `custom` behind: the select describes the expression.
    await cronInput().setValue('0 9 * * 1')
    await flushPromises()

    expect(presetSelect().props('modelValue')).toBe('weekly')

    // Restoring an expression must not resurrect the selection that was made for it earlier.
    await cronInput().setValue('0 9 * * *')
    await flushPromises()

    expect(presetSelect().props('modelValue')).toBe('daily')
  })

  it('drops the custom preset when the edited task changes', async () => {
    const twinJob: CronJob = {
      ...cloneJob(),
      id: 'job-2',
      name: 'Twin report',
      createdAt: 1_100,
      updatedAt: 1_100
    }
    const { wrapper } = await setup({
      list: async () => ({ jobs: [cloneJob(), twinJob], schedulerStatus: cloneStatus() })
    })

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()

    const presetSelect = () => wrapper.getComponent('[data-testid="cron-job-preset-select"]')
    await presetSelect().setValue('custom')
    await flushPromises()
    expect(presetSelect().props('modelValue')).toBe('custom')

    // The twin shares the expression, but the selection belonged to the first task.
    await wrapper.get('[data-job-id="job-2"] [data-testid="cron-job-select"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="cron-job-name-input"]').attributes('value')).toBe(
      'Twin report'
    )
    expect(presetSelect().props('modelValue')).toBe('daily')
  })

  it('protects an unsaved draft when switching tasks and restores it on discard', async () => {
    const secondJob: CronJob = {
      ...cloneJob(),
      id: 'job-2',
      name: 'Evening report',
      createdAt: 1_100,
      updatedAt: 1_100
    }
    const { wrapper, settingsLeaveGuard, cronClient } = await setup({
      list: async () => ({ jobs: [cloneJob(), secondJob], schedulerStatus: cloneStatus() })
    })

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="cron-job-name-input"]').setValue('Draft name')
    await flushPromises()
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')

    await wrapper.get('[data-job-id="job-2"] [data-testid="cron-job-select"]').trigger('click')
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().promptOpen).toBe(true)
    expect(wrapper.get('[data-testid="cron-job-detail-title"]').text()).toBe('Edit task')

    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await flushPromises()

    expect(wrapper.get('[data-testid="cron-job-detail-title"]').text()).toBe('Evening report')
    expect(wrapper.find('[data-testid="cron-job-dirty-hint"]').exists()).toBe(false)
    expect(cronClient.upsert).not.toHaveBeenCalled()
  })

  it('keeps a failed draft and lets the leave guard restore the persisted job', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, settingsLeaveGuard, notifyRenderer } = await setup({
      upsert: async () => {
        throw new Error('/private/scheduler-token')
      }
    })

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="cron-job-name-input"]').setValue('Unsaved report')
    await flushPromises()
    await wrapper.get('[data-testid="cron-job-editor-save"]').trigger('click')
    await flushPromises()

    expect(
      (wrapper.get('[data-testid="cron-job-name-input"]').element as HTMLInputElement).value
    ).toBe('Unsaved report')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.cronJobs.saveFailed',
        title: 'Operation failed'
      })
    )
    expect(wrapper.text()).not.toContain('/private/scheduler-token')

    const leave = settingsLeaveGuard.requestLeave()
    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await expect(leave).resolves.toBe(true)
    await flushPromises()

    expect(
      (wrapper.get('[data-testid="cron-job-name-input"]').element as HTMLInputElement).value
    ).toBe('Morning report')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    consoleError.mockRestore()
  })

  it('deletes the current task from the editor and keeps the dialog open on failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, notifyRenderer } = await setup({
      remove: async () => {
        throw new Error('database unavailable')
      }
    })

    await wrapper.get('[data-testid="cron-job-edit"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="cron-job-editor-delete"]').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[data-testid="cron-delete-dialog"]')
    expect(dialog.text()).toContain('Delete task "Morning report"?')

    await findButtonByText(dialog as unknown as VueWrapper, 'Delete').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="cron-delete-dialog"]').exists()).toBe(true)
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.cronJobs.deleteFailed',
        title: 'Operation failed'
      })
    )
    consoleError.mockRestore()
  })

  it('deletes a task from the list menu after confirming the name', async () => {
    const { wrapper, cronClient } = await setup()

    expect(findButtonByTextOrNull(wrapper, 'Delete')).toBeNull()

    await wrapper.get('[data-testid="cron-job-more"]').trigger('click')
    await flushPromises()
    await findButtonByText(wrapper, 'Delete').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[data-testid="cron-delete-dialog"]')
    expect(dialog.text()).toContain('Morning report')

    await findButtonByText(dialog as unknown as VueWrapper, 'Delete').trigger('click')
    await flushPromises()

    expect(cronClient.remove).toHaveBeenCalledWith('job-1')
    expect(wrapper.find('[data-job-id="job-1"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No scheduled tasks yet')
  })

  it('shows the enabled state and the latest run result independently in the list', async () => {
    const pausedJob: CronJob = {
      ...cloneJob(),
      id: 'job-2',
      name: 'Paused report',
      enabled: false,
      status: 'disabled',
      createdAt: 1_100,
      updatedAt: 1_100
    }
    const { wrapper } = await setup({
      list: async () => ({ jobs: [cloneJob(), pausedJob], schedulerStatus: cloneStatus() }),
      listRuns: async (jobId: string) =>
        jobId === 'job-2' ? [{ ...structuredClone(RUN_FIXTURE), jobId: 'job-2' }] : []
    })

    const row = wrapper.get('[data-job-id="job-2"]')
    expect(row.get('button[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(row.get('[data-testid="cron-job-last-run"]').text()).toBe('completed')
    expect(wrapper.text()).toContain('Disabled tasks')
    expect(wrapper.text()).toContain('Enabled tasks')
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

    await wrapper.get('[data-testid="cron-job-run-now"]').trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.cronJobs.runFailed',
      title: 'Operation failed'
    })
    expect(wrapper.text()).not.toContain('Task finished')
    expect(wrapper.text()).not.toContain('provider secret')
    expect(wrapper.get('[data-job-id="job-1"] [data-testid="cron-job-last-run"]').text()).toBe(
      'error'
    )
  })

  it('refreshes the latest run result while a manual run is in flight', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { wrapper, notifyRenderer, cronClient } = await setup({
      runNow: async () => ({
        job: cloneJob(),
        run: { ...structuredClone(RUN_FIXTURE), status: 'running', completedAt: null },
        schedulerStatus: cloneStatus()
      })
    })

    await wrapper.get('[data-testid="cron-job-run-now"]').trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'success',
      code: 'settings.cronJobs.runStarted',
      title: 'Run now',
      description: 'Morning report'
    })

    cronClient.listRuns.mockResolvedValue([
      { ...structuredClone(RUN_FIXTURE), outputPreview: 'Readable task output' }
    ])
    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()

    expect(wrapper.get('[data-job-id="job-1"] [data-testid="cron-job-last-run"]').text()).toBe(
      'completed'
    )

    await wrapper.get('[data-testid="cron-job-history-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Readable task output')
    expect(wrapper.text()).toContain('Manual')
  })

  it('reports scheduler restart failures as transient feedback', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, notifyRenderer } = await setup({
      restartScheduler: async () => {
        throw new Error('scheduler socket unavailable')
      }
    })

    await wrapper.get('[data-testid="cron-jobs-scheduler-details"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="cron-jobs-restart"]').trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.cronJobs.restartFailed',
      title: 'Operation failed'
    })
    expect(wrapper.text()).not.toContain('scheduler socket unavailable')
    consoleError.mockRestore()
  })

  it('surfaces scheduler failures prominently', async () => {
    const { wrapper } = await setup({
      list: async () => ({
        jobs: [cloneJob()],
        schedulerStatus: { ...cloneStatus(), state: 'error' }
      })
    })

    expect(wrapper.get('[role="alert"]').text()).toContain('The scheduler process is failing')
  })
})
