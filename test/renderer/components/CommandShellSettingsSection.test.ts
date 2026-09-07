import { defineComponent, inject, provide } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { AgentCommandShellConfig, GitBashAvailability } from '@shared/commandShell'

const SELECT_UPDATE_KEY = Symbol('command-shell-select-update')

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function setup(options: {
  platform?: NodeJS.Platform
  config?: AgentCommandShellConfig
  availability?: GitBashAvailability
  availabilityPromise?: Promise<GitBashAvailability>
  updatePromise?: Promise<AgentCommandShellConfig>
  selectedFile?: string
  updateError?: Error
  checkError?: Error
}) {
  vi.resetModules()
  const savedConfig = options.config ?? { preference: 'auto' }
  let commandShellChangedListener:
    | ((payload: { config: AgentCommandShellConfig; version: number }) => void)
    | undefined
  const stopCommandShellChanged = vi.fn()
  const settingsClient = {
    getCommandShell: vi.fn().mockResolvedValue(savedConfig),
    updateCommandShell: options.updateError
      ? vi.fn().mockRejectedValue(options.updateError)
      : options.updatePromise
        ? vi.fn().mockReturnValue(options.updatePromise)
        : vi.fn(async (config: AgentCommandShellConfig) => config),
    checkCommandShell: options.checkError
      ? vi.fn().mockRejectedValue(options.checkError)
      : options.availabilityPromise
        ? vi.fn().mockReturnValue(options.availabilityPromise)
        : vi.fn().mockResolvedValue(
            options.availability ?? {
              supported: true,
              available: false,
              error: 'not-found'
            }
          ),
    onCommandShellChanged: vi.fn(
      (listener: (payload: { config: AgentCommandShellConfig; version: number }) => void) => {
        commandShellChangedListener = listener
        return stopCommandShellChanged
      }
    )
  }
  const deviceClient = {
    getDeviceInfo: vi.fn().mockResolvedValue({
      platform: options.platform ?? 'win32',
      osVersion: '',
      osVersionMetadata: []
    }),
    selectFiles: vi
      .fn()
      .mockResolvedValue(
        options.selectedFile
          ? { canceled: false, filePaths: [options.selectedFile] }
          : { canceled: true, filePaths: [] }
      )
  }

  vi.doMock('@api/SettingsClient', () => ({ createSettingsClient: () => settingsClient }))
  vi.doMock('@api/DeviceClient', () => ({ createDeviceClient: () => deviceClient }))
  vi.doMock('@/stores/language', () => ({ useLanguageStore: () => ({ dir: 'ltr' }) }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key
    })
  }))

  const CommandShellSettingsSection = (
    await import('../../../src/renderer/settings/components/common/CommandShellSettingsSection.vue')
  ).default
  const wrapper = mount(CommandShellSettingsSection, {
    global: {
      stubs: {
        Icon: true,
        Select: defineComponent({
          name: 'Select',
          props: ['modelValue', 'disabled'],
          emits: ['update:modelValue'],
          setup(_props, { emit }) {
            provide(SELECT_UPDATE_KEY, (value: string) => emit('update:modelValue', value))
          },
          template: '<div><slot /></div>'
        }),
        SelectContent: defineComponent({
          name: 'SelectContent',
          template: '<div data-slot="select-content"><slot /></div>'
        }),
        SelectItem: defineComponent({
          name: 'SelectItem',
          props: ['value'],
          setup() {
            return { selectValue: inject<(value: string) => void>(SELECT_UPDATE_KEY) }
          },
          template:
            '<button type="button" :data-value="value" @click="selectValue?.(value)" @keydown.enter="selectValue?.(value)"><slot /></button>'
        }),
        SelectTrigger: defineComponent({
          name: 'SelectTrigger',
          template: '<button type="button" data-slot="select-trigger"><slot /></button>'
        }),
        SelectValue: passthrough('SelectValue'),
        Input: defineComponent({
          name: 'Input',
          inheritAttrs: false,
          props: ['modelValue', 'disabled'],
          emits: ['update:modelValue'],
          template:
            '<input v-bind="$attrs" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />'
        }),
        DcButton: defineComponent({
          name: 'DcButton',
          inheritAttrs: false,
          props: ['disabled'],
          template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>'
        })
      }
    }
  })
  await flushPromises()

  return {
    wrapper,
    settingsClient,
    deviceClient,
    stopCommandShellChanged,
    emitCommandShellChanged(config: AgentCommandShellConfig) {
      commandShellChangedListener?.({ config, version: Date.now() })
    }
  }
}

describe('CommandShellSettingsSection', () => {
  it('offers native POSIX shell choices without Windows-only profiles', async () => {
    const { wrapper, settingsClient } = await setup({ platform: 'darwin' })

    expect(wrapper.find('[data-testid="command-shell-settings"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-value]').map((item) => item.attributes('data-value'))).toEqual([
      'auto',
      'bash',
      'zsh',
      'fish'
    ])
    expect(settingsClient.checkCommandShell).not.toHaveBeenCalled()
  })

  it('persists an explicit POSIX shell selection', async () => {
    const { wrapper, settingsClient } = await setup({ platform: 'linux' })

    await wrapper.get('[data-value="fish"]').trigger('click')
    await flushPromises()

    expect(settingsClient.updateCommandShell).toHaveBeenCalledWith({ preference: 'fish' })
    expect(settingsClient.checkCommandShell).not.toHaveBeenCalled()
  })

  it('shows the validated executable for an existing Git Bash selection', async () => {
    const executable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const { wrapper, settingsClient } = await setup({
      config: { preference: 'git-bash' },
      availability: {
        supported: true,
        available: true,
        executable,
        source: 'common-path'
      }
    })

    expect(settingsClient.checkCommandShell).toHaveBeenCalledWith(false)
    expect(wrapper.get('[data-testid="command-shell-executable"]').attributes('aria-label')).toBe(
      'settings.common.commandShell.executable'
    )
    expect(wrapper.get('[data-testid="command-shell-status"]').text()).toContain(
      JSON.stringify({ path: executable })
    )
  })

  it('keeps an unavailable explicit Git Bash selection instead of falling back', async () => {
    const { wrapper, settingsClient } = await setup({ config: { preference: 'auto' } })

    await wrapper.get('[data-value="git-bash"]').trigger('click')
    await flushPromises()

    expect(settingsClient.updateCommandShell).toHaveBeenCalledWith({ preference: 'git-bash' })
    expect(settingsClient.checkCommandShell).toHaveBeenCalledWith(false)
    expect(wrapper.get('[data-testid="command-shell-preference"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="command-shell-status"]').text()).toContain(
      'settings.common.commandShell.errors.not-found'
    )
  })

  it('renders an availability check failure as an error instead of a loading state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { wrapper } = await setup({
        config: { preference: 'git-bash' },
        checkError: new Error('probe failed')
      })

      expect(wrapper.get('[data-testid="command-shell-status"]').text()).toBe(
        'settings.common.commandShell.checkFailed'
      )
      expect(wrapper.text()).not.toContain('settings.common.commandShell.checking')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('keeps the persisted profile when a preference update fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { wrapper, settingsClient } = await setup({
        config: { preference: 'auto' },
        updateError: new Error('write failed')
      })

      await wrapper.get('[data-value="git-bash"]').trigger('click')
      await flushPromises()

      expect(settingsClient.updateCommandShell).toHaveBeenCalledWith({ preference: 'git-bash' })
      expect(settingsClient.checkCommandShell).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="command-shell-status"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('settings.common.commandShell.updateFailed')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('persists a browsed executable and forces a fresh validation', async () => {
    const executable = 'D:\\Portable Git\\bin\\bash.exe'
    const { wrapper, settingsClient, deviceClient } = await setup({
      config: { preference: 'git-bash' },
      selectedFile: executable
    })

    await wrapper.get('[data-testid="command-shell-browse"]').trigger('click')
    await flushPromises()

    expect(deviceClient.selectFiles).toHaveBeenCalledWith({
      filters: [{ name: 'Git Bash', extensions: ['exe'] }],
      multiple: false
    })
    expect(settingsClient.updateCommandShell).toHaveBeenCalledWith({
      preference: 'git-bash',
      gitBashExecutableOverride: executable
    })
    expect(settingsClient.checkCommandShell).toHaveBeenLastCalledWith(true)
  })

  it('keeps executable actions from being swallowed by the input blur save', async () => {
    const executable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const { wrapper } = await setup({
      config: {
        preference: 'git-bash',
        gitBashExecutableOverride: executable
      }
    })

    for (const testId of ['command-shell-browse', 'command-shell-clear', 'command-shell-refresh']) {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      wrapper.get(`[data-testid="${testId}"]`).element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  it('persists an edited executable atomically with a preference change', async () => {
    const existingExecutable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const editedExecutable = 'D:\\Portable Git\\bin\\bash.exe'
    const { wrapper, settingsClient } = await setup({
      config: {
        preference: 'git-bash',
        gitBashExecutableOverride: existingExecutable
      }
    })
    await wrapper.get('[data-testid="command-shell-executable"]').setValue(editedExecutable)

    const item = wrapper.get('[data-value="windows-powershell"]')
    item.element.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    wrapper
      .get('[data-testid="command-shell-executable"]')
      .element.dispatchEvent(new FocusEvent('blur'))
    item.element.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }))
    item.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(settingsClient.updateCommandShell).toHaveBeenCalledOnce()
    expect(settingsClient.updateCommandShell).toHaveBeenCalledWith({
      preference: 'windows-powershell',
      gitBashExecutableOverride: editedExecutable
    })
  })

  it('keeps a keyboard preference change atomic with an edited executable', async () => {
    const existingExecutable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const editedExecutable = 'D:\\Portable Git\\bin\\bash.exe'
    const { wrapper, settingsClient } = await setup({
      config: {
        preference: 'git-bash',
        gitBashExecutableOverride: existingExecutable
      }
    })
    const input = wrapper.get('[data-testid="command-shell-executable"]')
    const trigger = wrapper.get('[data-testid="command-shell-preference"]')
    const item = wrapper.get('[data-value="windows-powershell"]')
    await input.setValue(editedExecutable)

    input.element.dispatchEvent(new FocusEvent('blur', { relatedTarget: trigger.element }))
    trigger.element.dispatchEvent(new FocusEvent('blur', { relatedTarget: item.element }))
    await item.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(settingsClient.updateCommandShell).toHaveBeenCalledOnce()
    expect(settingsClient.updateCommandShell).toHaveBeenCalledWith({
      preference: 'windows-powershell',
      gitBashExecutableOverride: editedExecutable
    })
  })

  it('does not let opening the preference menu save an override separately', async () => {
    const existingExecutable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const editedExecutable = 'D:\\Portable Git\\bin\\bash.exe'
    const { wrapper, settingsClient } = await setup({
      config: {
        preference: 'git-bash',
        gitBashExecutableOverride: existingExecutable
      }
    })
    const input = wrapper.get('[data-testid="command-shell-executable"]')
    await input.setValue(editedExecutable)

    wrapper
      .get('[data-testid="command-shell-preference"]')
      .element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    input.element.dispatchEvent(new FocusEvent('blur'))
    wrapper
      .get('[data-value="windows-powershell"]')
      .element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(settingsClient.updateCommandShell).toHaveBeenCalledOnce()
    expect(settingsClient.updateCommandShell).toHaveBeenCalledWith({
      preference: 'windows-powershell',
      gitBashExecutableOverride: editedExecutable
    })
  })

  it('persists an edited executable before refreshing its availability', async () => {
    const executable = 'D:\\Portable Git\\bin\\bash.exe'
    const { wrapper, settingsClient } = await setup({ config: { preference: 'git-bash' } })
    await wrapper.get('[data-testid="command-shell-executable"]').setValue(executable)

    await wrapper.get('[data-testid="command-shell-refresh"]').trigger('click')
    await flushPromises()

    expect(settingsClient.updateCommandShell).toHaveBeenCalledWith({
      preference: 'git-bash',
      gitBashExecutableOverride: executable
    })
    expect(settingsClient.checkCommandShell).toHaveBeenLastCalledWith(true)
  })

  it('applies command shell changes from another settings window and unsubscribes', async () => {
    const executable = 'D:\\Portable Git\\bin\\bash.exe'
    const { wrapper, settingsClient, emitCommandShellChanged, stopCommandShellChanged } =
      await setup({ config: { preference: 'auto' } })

    emitCommandShellChanged({
      preference: 'git-bash',
      gitBashExecutableOverride: executable
    })
    await flushPromises()

    expect(wrapper.getComponent({ name: 'Select' }).props('modelValue')).toBe('git-bash')
    expect(wrapper.get('[data-testid="command-shell-executable"]').element).toHaveProperty(
      'value',
      executable
    )
    expect(settingsClient.updateCommandShell).not.toHaveBeenCalled()
    expect(settingsClient.checkCommandShell).toHaveBeenCalledWith(false)

    wrapper.unmount()
    expect(stopCommandShellChanged).toHaveBeenCalledOnce()
  })

  it('does not let an older save response overwrite a published configuration', async () => {
    const update = createDeferred<AgentCommandShellConfig>()
    const { wrapper, emitCommandShellChanged } = await setup({
      config: { preference: 'auto' },
      updatePromise: update.promise
    })

    await wrapper.get('[data-value="git-bash"]').trigger('click')
    emitCommandShellChanged({ preference: 'windows-powershell' })
    update.resolve({ preference: 'git-bash' })
    await flushPromises()

    expect(wrapper.getComponent({ name: 'Select' }).props('modelValue')).toBe('windows-powershell')
    expect(wrapper.find('[data-testid="command-shell-executable"]').exists()).toBe(false)
  })

  it('discards an availability result for a configuration replaced by an event', async () => {
    const availability = createDeferred<GitBashAvailability>()
    const { wrapper, settingsClient, emitCommandShellChanged } = await setup({
      config: { preference: 'git-bash' },
      availabilityPromise: availability.promise
    })

    emitCommandShellChanged({ preference: 'windows-powershell' })
    settingsClient.checkCommandShell.mockResolvedValue({
      supported: true,
      available: false,
      error: 'not-found'
    })
    availability.resolve({
      supported: true,
      available: true,
      executable: 'C:\\Stale\\bash.exe',
      source: 'override'
    })
    await flushPromises()

    emitCommandShellChanged({ preference: 'git-bash' })
    await flushPromises()

    expect(wrapper.get('[data-testid="command-shell-status"]').text()).toContain(
      'settings.common.commandShell.errors.not-found'
    )
    expect(wrapper.get('[data-testid="command-shell-status"]').text()).not.toContain(
      'C:\\Stale\\bash.exe'
    )
  })
})
