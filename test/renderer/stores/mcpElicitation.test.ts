import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitElicitationDecisionMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const onElicitationRequestMock = vi.hoisted(() => vi.fn())

vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  onMounted: (callback: () => void) => callback(),
  onUnmounted: vi.fn()
}))

vi.mock('@api/McpClient', () => ({
  createMcpClient: () => ({
    submitElicitationDecision: submitElicitationDecisionMock,
    cancelElicitationRequest: vi.fn().mockResolvedValue(undefined),
    onElicitationRequest: onElicitationRequestMock,
    onElicitationDecision: vi.fn(() => vi.fn()),
    onElicitationCancelled: vi.fn(() => vi.fn())
  })
}))

vi.mock('@api/BrowserClient', () => ({
  createBrowserClient: () => ({
    openExternal: vi.fn().mockResolvedValue(undefined)
  })
}))

const setupStore = async () => {
  vi.resetModules()
  vi.doUnmock('pinia')
  const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
  setActivePinia(createPinia())
  const { useMcpElicitationStore } = await import('@/stores/mcpElicitation')
  return useMcpElicitationStore()
}

describe('MCP elicitation store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats prototype-shaped schema property names as ordinary fields', async () => {
    const store = await setupStore()
    const receiveRequest = onElicitationRequestMock.mock.calls[0][0]
    receiveRequest({
      request: {
        requestId: 'request-1',
        serverName: 'fixture',
        mode: 'form',
        message: 'Enter values',
        requestedSchema: JSON.parse(
          '{"type":"object","properties":{"__proto__":{"type":"string"},' +
            '"toString":{"type":"string"}},"required":["__proto__","toString"]}'
        )
      }
    })

    await store.accept()

    expect(submitElicitationDecisionMock).not.toHaveBeenCalled()
    expect(Object.prototype.hasOwnProperty.call(store.errors, '__proto__')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(store.errors, 'toString')).toBe(true)

    store.setValue('__proto__', 'prototype-value')
    store.setValue('toString', 'method-value')
    await store.accept()

    const content = submitElicitationDecisionMock.mock.calls[0][0].content
    expect(Object.prototype.hasOwnProperty.call(content, '__proto__')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(content, 'toString')).toBe(true)
    expect(content['__proto__']).toBe('prototype-value')
    expect(content.toString).toBe('method-value')
  })
})
