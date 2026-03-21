import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('usePresenter', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(window as any).api = {
      getWebContentsId: vi.fn(() => 1)
    }
    ;(window as any).electron = {
      ipcRenderer: {
        invoke: vi.fn().mockResolvedValue({ ok: true })
      }
    }
  })

  it('preserves undefined properties in object payloads across IPC', async () => {
    const { usePresenter } = await import('@/composables/usePresenter')
    const presenter = usePresenter('newAgentPresenter')

    await presenter.updateSessionGenerationSettings('s1', {
      temperature: 0.7,
      thinkingBudget: undefined,
      forceInterleavedThinkingCompat: undefined
    })

    const invoke = (window as any).electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>
    expect(invoke).toHaveBeenCalledTimes(1)

    const payload = invoke.mock.calls[0][4] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(payload, 'thinkingBudget')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(payload, 'forceInterleavedThinkingCompat')).toBe(
      true
    )
    expect(payload.thinkingBudget).toBeUndefined()
    expect(payload.forceInterleavedThinkingCompat).toBeUndefined()
    expect(payload.temperature).toBe(0.7)
  })
})
