import { defineComponent, nextTick, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

type OutputPayload = { terminalId: string; offset: number; data: string }

class FakeTerminal {
  static instances: FakeTerminal[] = []
  cols = 80
  rows = 24
  written: string[] = []
  element: HTMLElement | null = null
  private dataListener: ((data: string) => void) | null = null

  constructor(readonly options: Record<string, unknown>) {
    FakeTerminal.instances.push(this)
  }
  open(parent: HTMLElement) {
    this.element = document.createElement('textarea')
    parent.appendChild(this.element)
    // Mirror both backends: ordinary keys become terminal input.
    this.element.addEventListener('keydown', (event) => {
      if (event.key.length === 1) this.dataListener?.(event.key)
    })
  }
  write(data: string) {
    if (data === '') throw new RangeError('offset is out of bounds')
    this.written.push(data)
  }
  reset() {
    this.written = []
  }
  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }
  focus() {}
  dispose() {}
  loadAddon() {}
  onData(listener: (data: string) => void) {
    this.dataListener = listener
    return { dispose: () => (this.dataListener = null) }
  }
  onResize() {
    return { dispose() {} }
  }
}

class FakeFitAddon {
  fits = 0
  fit() {
    this.fits += 1
  }
}

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  terminalId: 'terminal-1',
  cwd: '/workspace',
  shell: '/bin/zsh',
  replay: '',
  outputEnd: 0,
  status: 'running',
  ...overrides
})

async function setup(options: {
  accessibility?: boolean
  accessibilityReady?: boolean
  active?: boolean
  workspacePath?: string | null
  attach?: (input: unknown) => Promise<unknown>
}) {
  vi.resetModules()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  FakeTerminal.instances = []
  let outputListener: ((payload: OutputPayload) => void) | null = null
  const client = {
    attach: vi.fn(options.attach ?? (async () => snapshot())),
    restart: vi.fn(async () => snapshot()),
    sendInput: vi.fn(async () => ({ sent: true })),
    resize: vi.fn(async () => ({ resized: true })),
    kill: vi.fn(async () => ({ killed: true })),
    onOutput: vi.fn((listener: (payload: OutputPayload) => void) => {
      outputListener = listener
      return () => (outputListener = null)
    }),
    onExit: vi.fn(() => () => {})
  }
  const accessibilityReady = ref(options.accessibilityReady ?? true)
  const accessibilityEnabled = ref(options.accessibility ?? false)

  vi.doMock('@api/TerminalClient', () => ({ createTerminalClient: () => client }))
  vi.doMock('@api/ProjectClient', () => ({
    createProjectClient: () => ({ selectDirectory: vi.fn(async () => '/picked') })
  }))
  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('@iconify/vue', () => ({ Icon: defineComponent({ template: '<span />' }) }))
  vi.doMock('@dc-ui/components/button', () => ({
    DcButton: defineComponent({
      emits: ['click'],
      template: '<button @click="$emit(\'click\')"><slot /></button>'
    })
  }))
  vi.doMock('@/composables/useAccessibilitySupport', () => ({
    useAccessibilitySupport: () => ({ accessibilityEnabled, accessibilityReady })
  }))
  vi.doMock('@/stores/shortcutKey', () => ({
    useShortcutKeyStore: () => ({ shortcutKeys: { ToggleTerminal: 'Control+`' } })
  }))
  vi.doMock('@/stores/ui/sidepanel', () => ({
    useSidepanelStore: () => reactive({ terminalFocusToken: 0 })
  }))
  vi.doMock('@/stores/theme', () => ({ useThemeStore: () => reactive({ isDark: true }) }))
  vi.doMock('ghostty-web', () => ({
    init: vi.fn(async () => {}),
    Terminal: FakeTerminal,
    FitAddon: FakeFitAddon
  }))
  vi.doMock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
  vi.doMock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))
  vi.doMock('@xterm/xterm/css/xterm.css', () => ({}))

  const TerminalPanel = (await import('@/components/sidepanel/TerminalPanel.vue')).default
  const wrapper = mount(TerminalPanel, {
    attachTo: document.body,
    props: {
      sessionId: 'session-1',
      workspacePath: options.workspacePath === undefined ? '/workspace' : options.workspacePath,
      active: options.active ?? true
    }
  })
  await flushPromises()
  return {
    wrapper,
    client,
    accessibilityReady,
    accessibilityEnabled,
    emitOutput: (payload: OutputPayload) => outputListener?.(payload)
  }
}

const keydown = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('TerminalPanel', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it.each([
    ['ghostty-web', false],
    ['xterm fallback', true]
  ])('%s sends ordinary keys and keeps the toggle chord away from the shell', async (_, a11y) => {
    vi.useFakeTimers()
    const { wrapper, client } = await setup({ accessibility: a11y })
    await vi.runAllTimersAsync()
    const input = wrapper.find('[data-testid="terminal-host"] textarea').element

    keydown(input, { key: 'a', code: 'KeyA' })
    const toggle = keydown(input, { key: '`', code: 'Backquote', ctrlKey: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(client.sendInput).toHaveBeenCalledTimes(1)
    expect(client.sendInput).toHaveBeenCalledWith('terminal-1', 'a')
    // The menu accelerator still needs the event; only the terminal must not see it.
    expect(toggle.defaultPrevented).toBe(false)
  })

  it('keeps output that arrives before the attach snapshot is applied', async () => {
    let resolveAttach!: (value: unknown) => void
    const { emitOutput } = await setup({
      attach: () => new Promise((resolve) => (resolveAttach = resolve))
    })

    emitOutput({ terminalId: 'terminal-1', offset: 0, data: 'banner\r\n' })
    emitOutput({ terminalId: 'terminal-1', offset: 8, data: 'prompt$ ' })
    resolveAttach(snapshot({ replay: 'banner\r\n', outputEnd: 8 }))
    await flushPromises()

    expect(FakeTerminal.instances[0].written).toEqual(['banner\r\n', 'prompt$ '])
  })

  it('does not attach while the panel is hidden and attaches when it opens', async () => {
    const { wrapper, client } = await setup({ active: false })
    expect(client.attach).not.toHaveBeenCalled()

    await wrapper.setProps({ sessionId: 'session-2' })
    await flushPromises()
    expect(client.attach).not.toHaveBeenCalled()

    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(client.attach).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-2' }))
  })

  it('recovers from a missing workdir when another folder is chosen', async () => {
    const attach = vi
      .fn()
      .mockRejectedValueOnce(new Error('[terminal:workdir_missing] gone'))
      .mockResolvedValue(snapshot({ cwd: '/picked' }))
    const { wrapper, client } = await setup({ workspacePath: '/deleted', attach })
    expect(wrapper.find('[data-testid="terminal-no-workdir"]').exists()).toBe(true)

    await wrapper.setProps({ workspacePath: '/picked' })
    await flushPromises()

    expect(client.attach).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="terminal-no-workdir"]').exists()).toBe(false)
  })

  it('waits for the native accessibility status before choosing a renderer', async () => {
    const { client, accessibilityReady, accessibilityEnabled } = await setup({
      accessibilityReady: false
    })
    expect(FakeTerminal.instances).toHaveLength(0)
    expect(client.attach).not.toHaveBeenCalled()

    accessibilityEnabled.value = true
    accessibilityReady.value = true
    await nextTick()
    await flushPromises()

    expect(FakeTerminal.instances).toHaveLength(1)
    expect(FakeTerminal.instances[0].options.screenReaderMode).toBe(true)
  })
})
