import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const notifyRenderer = vi.hoisted(() => vi.fn())

async function setup() {
  vi.resetModules()

  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const { useKnowledgeConfigOperation } =
    await import('../../../src/renderer/settings/lib/useKnowledgeConfigOperation')
  let operation!: ReturnType<typeof useKnowledgeConfigOperation>
  const Harness = defineComponent({
    setup() {
      operation = useKnowledgeConfigOperation()
      return () => null
    }
  })
  const wrapper = mount(Harness)

  return { wrapper, operation }
}

describe('useKnowledgeConfigOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps failed dialog persistence retryable, commits only after persistence, and never toasts', async () => {
    const { wrapper, operation } = await setup()
    const perform = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const commit = vi.fn()
    const request = {
      code: 'settings.knowledgeBase.test.save',
      source: 'dialog' as const,
      label: 'common.saving',
      perform,
      commit
    }

    const running = operation.run(request)
    expect(operation.snapshot.value.status).toBe('pending')
    await expect(running).resolves.toBe(false)

    expect(commit).not.toHaveBeenCalled()
    expect(operation.snapshot.value.status).toBe('error')
    // 对话框保存：失败走按钮 ⚠ + 内联错误，不弹 toast
    expect(operation.lastError.value).toEqual({ title: 'common.error.operationFailed' })
    expect(notifyRenderer).not.toHaveBeenCalled()

    operation.retry()
    await flushPromises()

    expect(perform).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(operation.lastError.value).toBeNull()
    // 成功走按钮 ✅，不弹 toast
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect(operation.snapshot.value.status).toBe('idle')
    expect(operation.source.value).toBeNull()
    wrapper.unmount()
  })

  it('does not retry persisted work when the local commit callback throws', async () => {
    const { wrapper, operation } = await setup()
    const perform = vi.fn().mockResolvedValue(true)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const commitError = new Error('local render failure')

    await expect(
      operation.run({
        code: 'settings.knowledgeBase.test.save',
        source: 'dialog',
        label: 'common.saving',
        perform,
        commit: () => {
          throw commitError
        }
      })
    ).resolves.toBe(true)

    operation.retry()
    await flushPromises()

    expect(perform).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      '[KnowledgeConfigOperation] settings.knowledgeBase.test.save local commit failed',
      commitError
    )
    wrapper.unmount()
    consoleError.mockRestore()
  })

  it('uses the operation-specific failure copy for the inline dialog error', async () => {
    const { wrapper, operation } = await setup()

    await operation.run({
      code: 'settings.knowledgeBase.test.dimensions',
      source: 'dialog',
      label: 'common.saving',
      perform: vi.fn().mockResolvedValue(false),
      commit: vi.fn(),
      failure: () => ({
        title: 'settings.knowledgeBase.autoDetectDimensionsError'
      })
    })

    expect(operation.lastError.value).toEqual({
      title: 'settings.knowledgeBase.autoDetectDimensionsError'
    })
    expect(notifyRenderer).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps toasting for panel and confirmation operations', async () => {
    const { wrapper, operation } = await setup()
    const perform = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const commit = vi.fn()
    const request = {
      code: 'settings.knowledgeBase.test.remove',
      source: 'panel' as const,
      label: 'common.saving',
      perform,
      commit
    }

    await expect(operation.run(request)).resolves.toBe(false)
    expect(operation.lastError.value).toBeNull()
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.knowledgeBase.test.remove.failed',
        title: 'common.error.operationFailed'
      })
    )

    operation.retry()
    await flushPromises()

    expect(commit).toHaveBeenCalledTimes(1)
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        code: 'settings.knowledgeBase.test.remove.succeeded',
        title: 'common.saved'
      })
    )
    wrapper.unmount()
  })
})
