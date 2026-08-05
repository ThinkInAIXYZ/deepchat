import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { HooksNotificationsSettings } from '../../../src/shared/hooksNotifications'

const notifyRenderer = vi.hoisted(() => vi.fn())

const HOOKS_FIXTURE: HooksNotificationsSettings = {
  hooks: [
    {
      id: 'hook-1',
      name: 'Primary hook',
      enabled: true,
      command: 'echo ready',
      events: ['SessionStart']
    }
  ]
}

const passthrough = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    template: '<div v-bind="$attrs"><slot /></div>'
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

const switchStub = defineComponent({
  name: 'Switch',
  inheritAttrs: false,
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue'],
  template:
    '<button v-bind="$attrs" role="switch" :disabled="disabled" :aria-checked="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />'
})

const checkboxStub = defineComponent({
  name: 'Checkbox',
  inheritAttrs: false,
  props: { checked: Boolean, disabled: Boolean },
  emits: ['update:checked'],
  template:
    '<button v-bind="$attrs" role="checkbox" :disabled="disabled" :aria-checked="String(checked)" @click="$emit(\'update:checked\', !checked)" />'
})

const cloneFixture = (): HooksNotificationsSettings => structuredClone(HOOKS_FIXTURE)
const mountedWrappers: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  vi.restoreAllMocks()
})

async function setup(options?: {
  load?: () => Promise<HooksNotificationsSettings>
  save?: (config: HooksNotificationsSettings) => Promise<HooksNotificationsSettings>
  test?: (hookId: string) => Promise<{
    success: boolean
    durationMs: number
    exitCode?: number | null
  }>
}) {
  vi.resetModules()
  const configClient = {
    getHooksNotificationsConfig: vi.fn(options?.load ?? (async () => cloneFixture())),
    setHooksNotificationsConfig: vi.fn(
      options?.save ?? (async (config: HooksNotificationsSettings) => structuredClone(config))
    ),
    testHookCommand: vi.fn(
      options?.test ?? (async () => ({ success: true, durationMs: 12, exitCode: 0 }))
    )
  }

  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        const messages: Record<string, string> = {
          'settings.notificationsHooks.title': 'Hooks',
          'settings.notificationsHooks.commands.description': 'Run lifecycle hooks',
          'settings.notificationsHooks.commands.hint': 'Payload via stdin',
          'settings.notificationsHooks.commands.newHook': 'New Hook',
          'settings.notificationsHooks.commands.name': 'Name',
          'settings.notificationsHooks.commands.namePlaceholder': 'Hook name',
          'settings.notificationsHooks.commands.commandLabel': 'Command',
          'settings.notificationsHooks.commands.commandPlaceholder': 'Command',
          'settings.notificationsHooks.commands.defaultName': `Hook ${params?.index ?? ''}`,
          'settings.notificationsHooks.events.title': 'Events',
          'settings.notificationsHooks.test.button': 'Test',
          'settings.notificationsHooks.test.testing': 'Testing...',
          'settings.notificationsHooks.test.success': 'Success',
          'settings.notificationsHooks.test.failed': 'Failed',
          'settings.notificationsHooks.test.duration': `${params?.ms ?? 0} ms`,
          'settings.notificationsHooks.test.exitCode': `Exit ${params?.code ?? ''}`,
          'common.enabled': 'Enabled',
          'common.disabled': 'Disabled',
          'common.delete': 'Delete',
          'common.loading': 'Loading...',
          'common.saving': 'Saving',
          'common.saved': 'Saved',
          'common.retry': 'Retry',
          'common.error.operationFailed': 'Operation failed',
          'common.error.requestFailed': 'Request failed'
        }
        return messages[key] ?? key
      }
    })
  }))

  const NotificationsHooksSettings = (
    await import('../../../src/renderer/settings/components/NotificationsHooksSettings.vue')
  ).default
  const wrapper = mount(NotificationsHooksSettings, {
    global: {
      stubs: {
        ScrollArea: passthrough('ScrollArea'),
        DcButton: buttonStub,
        Checkbox: checkboxStub,
        Collapsible: passthrough('Collapsible'),
        CollapsibleContent: passthrough('CollapsibleContent'),
        CollapsibleTrigger: passthrough('CollapsibleTrigger'),
        Input: inputStub,
        Label: passthrough('Label'),
        Switch: switchStub,
        Spinner: true,
        Icon: true
      }
    }
  })
  mountedWrappers.push(wrapper)
  await flushPromises()
  const { settingsLeaveGuard } =
    await import('../../../src/renderer/settings/services/settingsLeaveGuard')

  return { wrapper, configClient, settingsLeaveGuard, notifyRenderer }
}

describe('NotificationsHooksSettings', () => {
  it('reports a load failure via toast without exposing the exception', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let loadAttempt = 0
    const { wrapper, notifyRenderer } = await setup({
      load: async () => {
        loadAttempt += 1
        if (loadAttempt === 1) throw new Error('/private/hooks.json')
        return cloneFixture()
      }
    })

    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.notificationsHooks.loadFailed',
        title: 'Operation failed'
      })
    )
    expect(wrapper.text()).not.toContain('/private/hooks.json')
    consoleError.mockRestore()
  })

  it('serializes saves and never lets an older response replace a newer draft', async () => {
    let resolveFirst!: (config: HooksNotificationsSettings) => void
    let resolveSecond!: (config: HooksNotificationsSettings) => void
    let saveAttempt = 0
    const { wrapper, configClient, notifyRenderer } = await setup({
      save: async () => {
        saveAttempt += 1
        return await new Promise<HooksNotificationsSettings>((resolve) => {
          if (saveAttempt === 1) resolveFirst = resolve
          else resolveSecond = resolve
        })
      }
    })
    const nameInput = wrapper.findAll('input')[0]

    await nameInput.setValue('First draft')
    await nameInput.trigger('blur')
    await flushPromises()
    expect(configClient.setHooksNotificationsConfig).toHaveBeenCalledTimes(1)

    await nameInput.setValue('Latest draft')
    await nameInput.trigger('blur')
    resolveFirst(configClient.setHooksNotificationsConfig.mock.calls[0][0])
    await flushPromises()

    expect((nameInput.element as HTMLInputElement).value).toBe('Latest draft')
    expect(configClient.setHooksNotificationsConfig).toHaveBeenCalledTimes(2)
    expect(configClient.setHooksNotificationsConfig.mock.calls[1][0].hooks[0].name).toBe(
      'Latest draft'
    )

    resolveSecond(configClient.setHooksNotificationsConfig.mock.calls[1][0])
    await flushPromises()
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        code: 'settings.notificationsHooks.saved',
        title: 'Saved'
      })
    )
  })

  it('keeps a failed draft editable and lets the leave guard discard it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, settingsLeaveGuard, notifyRenderer } = await setup({
      save: async () => {
        throw new Error('/private/hooks-secret.json')
      }
    })
    const nameInput = wrapper.findAll('input')[0]

    await nameInput.setValue('Unsaved hook')
    await nameInput.trigger('blur')
    await flushPromises()

    expect((nameInput.element as HTMLInputElement).value).toBe('Unsaved hook')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.notificationsHooks.saveFailed',
        title: 'Operation failed'
      })
    )
    expect(wrapper.text()).not.toContain('/private/hooks-secret.json')

    const leave = settingsLeaveGuard.requestLeave()
    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await expect(leave).resolves.toBe(true)
    await flushPromises()
    expect((nameInput.element as HTMLInputElement).value).toBe('Primary hook')
    consoleError.mockRestore()
  })

  it('retries the latest failed draft from a subsequent save attempt', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let saveAttempt = 0
    const { wrapper, configClient, settingsLeaveGuard, notifyRenderer } = await setup({
      save: async (config) => {
        saveAttempt += 1
        if (saveAttempt === 1) throw new Error('transient failure')
        return structuredClone(config)
      }
    })
    const nameInput = wrapper.findAll('input')[0]

    await nameInput.setValue('Retry draft')
    await nameInput.trigger('blur')
    await flushPromises()
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.notificationsHooks.saveFailed',
        title: 'Operation failed'
      })
    )

    await nameInput.trigger('blur')
    await flushPromises()

    expect(configClient.setHooksNotificationsConfig).toHaveBeenCalledTimes(2)
    expect(configClient.setHooksNotificationsConfig.mock.calls[1][0].hooks[0].name).toBe(
      'Retry draft'
    )
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        code: 'settings.notificationsHooks.saved',
        title: 'Saved'
      })
    )
    consoleError.mockRestore()
  })

  it('waits for the current draft to persist before testing its command', async () => {
    let resolveSave!: (config: HooksNotificationsSettings) => void
    const { wrapper, configClient } = await setup({
      save: async () =>
        await new Promise<HooksNotificationsSettings>((resolve) => {
          resolveSave = resolve
        })
    })
    const commandInput = wrapper.findAll('input')[1]

    await commandInput.setValue('echo changed')
    const testButton = wrapper.findAll('button').find((button) => button.text() === 'Test')!
    await testButton.trigger('click')
    await flushPromises()

    expect(configClient.setHooksNotificationsConfig).toHaveBeenCalledTimes(1)
    expect(configClient.testHookCommand).not.toHaveBeenCalled()
    expect(commandInput.attributes('disabled')).toBeDefined()

    resolveSave(configClient.setHooksNotificationsConfig.mock.calls[0][0])
    await flushPromises()

    expect(configClient.testHookCommand).toHaveBeenCalledWith('hook-1')
    expect(wrapper.text()).toContain('Success')
  })
})
