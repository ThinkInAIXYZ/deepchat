import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelStatusHelper } from '../../../../src/main/presenter/configPresenter/modelStatusHelper'

const { sendToRenderer } = vi.hoisted(() => ({
  sendToRenderer: vi.fn()
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    sendToRenderer
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

class MockElectronStore {
  private readonly data = new Map<string, unknown>()

  get(key: string) {
    return this.data.get(key)
  }

  set(key: string, value: unknown) {
    this.data.set(key, value)
  }

  delete(key: string) {
    this.data.delete(key)
  }

  has(key: string) {
    return this.data.has(key)
  }
}

describe('ModelStatusHelper.ensureModelStatus', () => {
  beforeEach(() => {
    sendToRenderer.mockReset()
  })

  it('writes the default value only when no status exists yet', () => {
    const store = new MockElectronStore()
    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value)
    })

    helper.ensureModelStatus('ollama', 'qwen3:8b', true)

    expect(helper.getModelStatus('ollama', 'qwen3:8b')).toBe(true)
    expect(sendToRenderer).not.toHaveBeenCalled()
  })

  it('preserves an explicit user choice when ensureModelStatus runs later', () => {
    const store = new MockElectronStore()
    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value)
    })

    helper.setModelStatus('ollama', 'deepseek-r1:1.5b', false)
    helper.ensureModelStatus('ollama', 'deepseek-r1:1.5b', true)

    expect(helper.getModelStatus('ollama', 'deepseek-r1:1.5b')).toBe(false)
    expect(sendToRenderer).toHaveBeenCalledTimes(1)
  })
})
