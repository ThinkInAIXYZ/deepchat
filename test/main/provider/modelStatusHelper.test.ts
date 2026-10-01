import { describe, expect, it } from 'vitest'
import { ModelStatusHelper } from '../../../src/main/provider/modelStatusHelper'

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

class MockElectronStoreWithoutSnapshot {
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
  it('writes the default value only when no status exists yet', () => {
    const store = new MockElectronStore()
    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
    })

    helper.ensureModelStatus('ollama', 'qwen3:8b', true)

    expect(helper.getModelStatus('ollama', 'qwen3:8b')).toBe(true)
  })

  it('preserves an explicit user choice when ensureModelStatus runs later', () => {
    const store = new MockElectronStore()
    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
    })

    helper.setModelStatus('ollama', 'deepseek-r1:1.5b', false)
    helper.ensureModelStatus('ollama', 'deepseek-r1:1.5b', true)

    expect(helper.getModelStatus('ollama', 'deepseek-r1:1.5b')).toBe(false)
  })

  it('keeps new hyphenated status separate from dotted legacy fallback across restart', () => {
    const store = new MockElectronStore()
    let helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
    })

    helper.setModelStatus('custom', 'foo-bar', true)
    expect(helper.getModelStatus('custom', 'foo.bar')).toBe(false)

    helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
    })

    expect(helper.getBatchModelStatus('custom', ['foo.bar', 'foo-bar'])).toEqual({
      'foo.bar': false,
      'foo-bar': true
    })
  })

  it('deletes a dotted canonical status without exposing a colliding legacy status', () => {
    const store = new MockElectronStore()
    store.set('model_status_custom_foo-bar', true)
    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
    })

    helper.setModelStatus('custom', 'foo.bar', true)
    helper.deleteModelStatus('custom', 'foo.bar')

    expect(helper.getModelStatus('custom', 'foo.bar')).toBe(false)
    expect(helper.getModelStatus('custom', 'foo-bar')).toBe(true)
    expect(store.has('model_status_custom_foo-bar')).toBe(true)
    expect(store.get('model_status_v2_custom|foo.bar')).toBe(false)
  })

  it('reads legacy dotted status and tombstones only that canonical identity on deletion', () => {
    const store = new MockElectronStore()
    store.set('model_status_custom_foo-bar', true)
    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
    })

    expect(helper.getModelStatus('custom', 'foo.bar')).toBe(true)

    helper.deleteModelStatus('custom', 'foo.bar')

    expect(helper.getModelStatus('custom', 'foo.bar')).toBe(false)
    expect(store.has('model_status_custom_foo-bar')).toBe(true)
    expect(store.get('model_status_v2_custom|foo.bar')).toBe(false)
  })

  it('builds the persisted snapshot once and reuses it for batch lookups', () => {
    const store = new MockElectronStore()
    store.set('model_status_openai_gpt-5-4', true)
    store.set('model_status_openai_gpt-4-1', false)

    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
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
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
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

  it('removes every persisted model status for a provider in one pass', () => {
    const store = new MockElectronStore()
    store.set('model_status_v2_openai|gpt-5.4', true)
    store.set('model_status_v2_openai|gpt-4.1', false)
    store.set('model_status_v2_anthropic|claude-3.5-sonnet', true)

    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
    })

    helper.deleteProviderModelStatuses('openai')

    expect(helper.getBatchModelStatus('openai', ['gpt-5.4', 'gpt-4.1'])).toEqual({
      'gpt-5.4': false,
      'gpt-4.1': false
    })
    expect(helper.getBatchModelStatus('anthropic', ['claude-3.5-sonnet'])).toEqual({
      'claude-3.5-sonnet': true
    })
  })

  it('removes cached provider status keys when a raw store snapshot is unavailable', () => {
    const store = new MockElectronStoreWithoutSnapshot()
    store.set('model_status_v2_openai|gpt-5.4', true)
    store.set('model_status_v2_anthropic|claude-3.5-sonnet', true)

    const helper = new ModelStatusHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      publishEvent: () => undefined
    })

    expect(helper.getModelStatus('openai', 'gpt-5.4')).toBe(true)
    helper.deleteProviderModelStatuses('openai')

    expect(store.has('model_status_v2_openai|gpt-5.4')).toBe(false)
    expect(store.has('model_status_v2_anthropic|claude-3.5-sonnet')).toBe(true)
  })
})
