import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { AcpAuthChallenge } from '@shared/types/acp'

const authClient = vi.hoisted(() => ({
  start: vi.fn(),
  sendInput: vi.fn(),
  cancel: vi.fn(),
  outputListener: null as ((payload: unknown) => void) | null,
  stateListener: null as ((payload: unknown) => void) | null
}))
const terminalWrite = vi.hoisted(() => vi.fn())
const terminalData = vi.hoisted(() => ({ listener: null as ((data: string) => void) | null }))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    open() {}
    onData(listener: (data: string) => void) {
      terminalData.listener = listener
    }
    write = terminalWrite
    dispose() {}
  }
}))

vi.mock('@api/AcpAuthClient', () => ({
  createAcpAuthClient: () => ({
    start: authClient.start,
    sendInput: authClient.sendInput,
    cancel: authClient.cancel,
    onOutput: (listener: (payload: unknown) => void) => {
      authClient.outputListener = listener
      return vi.fn()
    },
    onStateChanged: (listener: (payload: unknown) => void) => {
      authClient.stateListener = listener
      return vi.fn()
    }
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const baseChallenge = (methods: AcpAuthChallenge['methods']): AcpAuthChallenge => ({
  id: 'challenge-1',
  agentId: 'agent-1',
  agentName: 'Agent One',
  workdir: '/tmp/workspace',
  origin: 'settings_probe',
  methods
})

async function mountDialog(challenge: AcpAuthChallenge) {
  const AcpAuthDialog = (await import('@/components/acp/AcpAuthDialog.vue')).default
  const wrapper = mount(AcpAuthDialog, {
    props: { open: false, challenge },
    global: {
      stubs: {
        Dialog: passthrough('Dialog'),
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        RadioGroup: passthrough('RadioGroup'),
        RadioGroupItem: true,
        DcButton: passthrough('DcButton')
      }
    }
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  authClient.start.mockReset()
  authClient.sendInput.mockReset()
  authClient.cancel.mockReset().mockResolvedValue({ cancelled: true })
  authClient.outputListener = null
  authClient.stateListener = null
  terminalWrite.mockReset()
  terminalData.listener = null
})

describe('AcpAuthDialog', () => {
  it('preselects exactly one supported method', async () => {
    const wrapper = await mountDialog(
      baseChallenge([
        { id: 'env', name: 'Environment', type: 'unsupported' },
        { id: 'browser', name: 'Browser login', type: 'terminal' }
      ])
    )

    expect((wrapper.vm as any).selectedMethodId).toBe('browser')
  })

  it('requires an explicit choice when multiple methods are supported', async () => {
    const wrapper = await mountDialog(
      baseChallenge([
        { id: 'agent', name: 'Agent login', type: 'agent' },
        { id: 'browser', name: 'Browser login', type: 'terminal' }
      ])
    )

    expect((wrapper.vm as any).selectedMethodId).toBe('')
  })

  it('emits success only after the selected method succeeds', async () => {
    authClient.start.mockResolvedValue({
      challengeId: 'challenge-1',
      state: 'succeeded',
      version: 1
    })
    const wrapper = await mountDialog(
      baseChallenge([{ id: 'agent', name: 'Agent login', type: 'agent' }])
    )

    await (wrapper.vm as any).startAuthentication()

    expect(authClient.start).toHaveBeenCalledWith('challenge-1', 'agent')
    expect(wrapper.emitted('succeeded')).toHaveLength(1)
  })

  it('cancels only the current terminal run', async () => {
    const wrapper = await mountDialog(
      baseChallenge([{ id: 'browser', name: 'Browser login', type: 'terminal' }])
    )
    ;(wrapper.vm as any).runId = 'run-1'

    await (wrapper.vm as any).cancelAuthentication()

    expect(authClient.cancel).toHaveBeenCalledWith('run-1')
  })

  it('keeps terminal output that arrives before the start response', async () => {
    let resolveStart:
      | ((value: { challengeId: string; runId: string; state: 'running'; version: number }) => void)
      | null = null
    authClient.start.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve
      })
    )
    const wrapper = await mountDialog(
      baseChallenge([{ id: 'browser', name: 'Browser login', type: 'terminal' }])
    )

    const starting = (wrapper.vm as any).startAuthentication()
    authClient.outputListener?.({
      challengeId: 'challenge-1',
      runId: 'run-early',
      data: 'EARLY_OUTPUT',
      version: Date.now()
    })
    await flushPromises()

    expect((wrapper.vm as any).runId).toBe('run-early')
    expect(terminalWrite).toHaveBeenCalledWith('EARLY_OUTPUT')

    resolveStart?.({
      challengeId: 'challenge-1',
      runId: 'run-early',
      state: 'running',
      version: 1
    })
    await starting
  })

  it('cancels a terminal run returned after the dialog closes', async () => {
    let resolveStart:
      | ((value: { challengeId: string; runId: string; state: 'running'; version: number }) => void)
      | null = null
    authClient.start.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve
      })
    )
    const wrapper = await mountDialog(
      baseChallenge([{ id: 'browser', name: 'Browser login', type: 'terminal' }])
    )

    const starting = (wrapper.vm as any).startAuthentication()
    ;(wrapper.vm as any).handleOpenChange(false)
    resolveStart?.({
      challengeId: 'challenge-1',
      runId: 'run-late',
      state: 'running',
      version: 1
    })
    await starting

    expect(authClient.cancel).toHaveBeenCalledWith('run-late')
    expect((wrapper.vm as any).runId).toBeNull()
  })

  it('cancels the active terminal run on unmount', async () => {
    authClient.start.mockResolvedValue({
      challengeId: 'challenge-1',
      runId: 'run-active',
      state: 'running',
      version: 1
    })
    const wrapper = await mountDialog(
      baseChallenge([{ id: 'browser', name: 'Browser login', type: 'terminal' }])
    )
    await (wrapper.vm as any).startAuthentication()

    wrapper.unmount()

    expect(authClient.cancel).toHaveBeenCalledWith('run-active')
  })

  it('does not apply a start response older than a state event', async () => {
    let resolveStart:
      | ((value: { challengeId: string; runId: string; state: 'running'; version: number }) => void)
      | null = null
    authClient.start.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve
      })
    )
    const wrapper = await mountDialog(
      baseChallenge([{ id: 'browser', name: 'Browser login', type: 'terminal' }])
    )

    const starting = (wrapper.vm as any).startAuthentication()
    authClient.stateListener?.({
      challengeId: 'challenge-1',
      runId: 'run-1',
      state: 'succeeded',
      version: 2
    })
    resolveStart?.({
      challengeId: 'challenge-1',
      runId: 'run-1',
      state: 'running',
      version: 1
    })
    await starting

    expect((wrapper.vm as any).state).toBe('succeeded')
    expect(wrapper.emitted('succeeded')).toHaveLength(1)
  })

  it('drops buffered terminal input before a later run starts', async () => {
    vi.useFakeTimers()
    authClient.start
      .mockResolvedValueOnce({
        challengeId: 'challenge-1',
        runId: 'run-1',
        state: 'running',
        version: 1
      })
      .mockResolvedValueOnce({
        challengeId: 'challenge-1',
        runId: 'run-2',
        state: 'running',
        version: 2
      })
    const wrapper = await mountDialog(
      baseChallenge([{ id: 'browser', name: 'Browser login', type: 'terminal' }])
    )
    try {
      await (wrapper.vm as any).startAuthentication()
      terminalData.listener?.('secret')

      ;(wrapper.vm as any).handleOpenChange(false)
      await wrapper.setProps({ open: false })
      await wrapper.setProps({ open: true })
      await flushPromises()
      await (wrapper.vm as any).startAuthentication()
      await vi.advanceTimersByTimeAsync(8)

      expect(authClient.sendInput).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })
})
