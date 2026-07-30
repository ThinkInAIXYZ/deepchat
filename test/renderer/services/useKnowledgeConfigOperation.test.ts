import { describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

async function setup() {
  vi.resetModules()

  const snapshot = ref<any>({ status: 'idle', version: 0 })
  const controller = {
    begin: vi.fn((operationId: string, label: string) => {
      snapshot.value = { status: 'pending', operationId, label, version: 1 }
    }),
    succeed: vi.fn((result) => {
      snapshot.value = {
        status: 'success',
        operationId: 'knowledge-operation',
        ...result,
        version: 2
      }
    }),
    fail: vi.fn((result) => {
      snapshot.value = {
        status: 'error',
        operationId: 'knowledge-operation',
        ...result,
        version: 2
      }
    }),
    clearSettled: vi.fn(() => {
      snapshot.value = { status: 'idle', version: 3 }
    })
  }

  vi.doMock('@renderer-notifications/rendererNotificationRuntime', () => ({
    createRendererSurfaceFeedbackController: () => controller
  }))
  vi.doMock('@renderer-notifications/useSurfaceFeedback', () => ({
    useSurfaceFeedback: () => ({
      snapshot,
      setActive: vi.fn()
    })
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

  return { wrapper, operation, controller, snapshot }
}

describe('useKnowledgeConfigOperation', () => {
  it('keeps failed persistence retryable and commits only after persistence succeeds', async () => {
    const { wrapper, operation, controller, snapshot } = await setup()
    const perform = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const commit = vi.fn()
    const request = {
      code: 'settings.knowledgeBase.test.save',
      source: 'dialog' as const,
      label: 'common.saving',
      perform,
      commit
    }

    await expect(operation.run(request)).resolves.toBe(false)

    expect(commit).not.toHaveBeenCalled()
    expect(snapshot.value.status).toBe('error')
    expect(controller.fail).toHaveBeenCalledWith({
      code: 'settings.knowledgeBase.test.save.failed',
      title: 'common.error.operationFailed'
    })

    operation.retry()
    await flushPromises()

    expect(perform).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(controller.succeed).toHaveBeenCalledWith({
      code: 'settings.knowledgeBase.test.save.succeeded',
      title: 'common.saved'
    })
    expect(controller.clearSettled).toHaveBeenCalledTimes(1)
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

  it('uses the operation-specific failure copy when the source can diagnose the failure', async () => {
    const { wrapper, operation, controller } = await setup()

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

    expect(controller.fail).toHaveBeenCalledWith({
      code: 'settings.knowledgeBase.test.dimensions.failed',
      title: 'settings.knowledgeBase.autoDetectDimensionsError'
    })
    wrapper.unmount()
  })
})
