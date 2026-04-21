import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelStatusHelper } from '../../../../src/main/presenter/configPresenter/modelStatusHelper'

const { send } = vi.hoisted(() => ({
  send: vi.fn()
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    send
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

class MockElectronStore {
  private readonly data = new Map<string, unknown>()
  public getCallCount = 0
  public snapshotReadCount = 0

  get(key: string) {
    this.getCallCount += 1
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

  get store() {
    this.snapshotReadCount += 1
    return Object.fromEntries(this.data.entries())
  }
}

describe('ModelStatusHelper.ensureModelStatus', () => {
  beforeEach(() => {
    send.mockReset()
  })

  it('writes the default value only when no status exists yet', () => {
    const store = new MockElectronStore()
    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value)
    })

    helper.ensureModelStatus('ollama', 'qwen3:8b', true)

    expect(helper.getModelStatus('ollama', 'qwen3:8b')).toBe(true)
    expect(send).not.toHaveBeenCalled()
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
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('builds the persisted snapshot once and reuses it for batch lookups', () => {
    const store = new MockElectronStore()
    store.set('model_status_openai_gpt-5-4', true)
    store.set('model_status_openai_gpt-4-1', false)

    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value)
    })

    expect(helper.getBatchModelStatus('openai', ['gpt-5.4', 'gpt-4.1'])).toEqual({
      'gpt-5.4': true,
      'gpt-4.1': false
    })
    expect(helper.getBatchModelStatus('openai', ['gpt-5.4'])).toEqual({
      'gpt-5.4': true
    })

    expect(store.snapshotReadCount).toBe(1)
    expect(store.getCallCount).toBe(0)
  })

  it('keeps the in-memory snapshot in sync after writes and deletes', () => {
    const store = new MockElectronStore()
    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value)
    })

    expect(helper.getModelStatus('openai', 'gpt-5.4')).toBe(false)
    expect(store.snapshotReadCount).toBe(1)

    helper.setModelStatus('openai', 'gpt-5.4', true)
    expect(helper.getBatchModelStatus('openai', ['gpt-5.4'])).toEqual({
      'gpt-5.4': true
    })

    helper.deleteModelStatus('openai', 'gpt-5.4')
    expect(helper.getBatchModelStatus('openai', ['gpt-5.4'])).toEqual({
      'gpt-5.4': false
    })
    expect(store.snapshotReadCount).toBe(1)
  })
})
