import { OperationRegistry } from '@shared/notifications'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  SurfaceFeedbackController,
  useSurfaceFeedback,
  type SurfaceVisibilitySource
} from '@renderer-notifications'
import { FakeNotificationTime } from '../../../helpers/fakeNotificationTime'

const visibleSurface: SurfaceVisibilitySource = Object.freeze({
  isVisible: () => true,
  subscribe: () => () => undefined
})

describe('useSurfaceFeedback', () => {
  it('cancels its renderer operation when the owning component unmounts', () => {
    const time = new FakeNotificationTime()
    const operations = new OperationRegistry(time)
    const notify = vi.fn()
    const controller = new SurfaceFeedbackController({
      clock: time,
      scheduler: time,
      operations,
      operationOwner: { process: 'renderer', rendererId: 'settings' },
      notifications: { notify },
      visibility: visibleSurface
    })
    const Harness = defineComponent({
      setup() {
        useSurfaceFeedback(controller)
        controller.begin('settings.test.pending', 'Saving')
        return () => null
      }
    })

    const wrapper = mount(Harness)
    expect(operations.get('settings.test.pending')).toMatchObject({ status: 'running' })

    wrapper.unmount()

    expect(operations.get('settings.test.pending')).toBeUndefined()
    expect(
      controller.fail({
        code: 'settings.test.failed',
        title: 'Failed'
      })
    ).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})
