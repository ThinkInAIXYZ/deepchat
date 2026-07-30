import { OperationRegistry } from '@shared/notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationManager,
  SurfaceFeedbackController,
  type NotificationPresenter,
  type SurfaceVisibilitySource
} from '@renderer-notifications'
import { FakeNotificationTime } from '../../../helpers/fakeNotificationTime'

class FakeSurfaceVisibility implements SurfaceVisibilitySource {
  private readonly listeners = new Set<() => void>()

  constructor(private visible = true) {}

  isVisible(): boolean {
    return this.visible
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    for (const listener of Array.from(this.listeners)) listener()
  }
}

const createHarness = () => {
  const time = new FakeNotificationTime()
  const visibility = new FakeSurfaceVisibility()
  const presentations: Array<{
    events: Parameters<NotificationPresenter['present']>[2]
    dismiss: ReturnType<typeof vi.fn>
  }> = []
  const presenter: NotificationPresenter = {
    present: (_record, _options, events) => {
      const dismiss = vi.fn()
      presentations.push({ events, dismiss })
      return { dismiss }
    }
  }
  const manager = new NotificationManager({
    presenter,
    clock: time,
    scheduler: time
  })
  const operations = new OperationRegistry(time)
  const operationEvents: string[] = []
  operations.subscribe((event) => {
    operationEvents.push(`${event.type}:${event.operation.status}`)
  })
  const controller = new SurfaceFeedbackController({
    clock: time,
    scheduler: time,
    operations,
    operationOwner: { process: 'renderer', rendererId: 'settings' },
    notifications: manager,
    visibility
  })
  return {
    controller,
    manager,
    operationEvents,
    operations,
    presentations,
    time,
    visibility
  }
}

const succeed = (controller: SurfaceFeedbackController) => {
  controller.begin('settings.agent.save', 'Saving')
  controller.succeed({
    code: 'settings.agent.saved',
    title: 'Saved'
  })
}

describe('SurfaceFeedbackController', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a successful result inline while a surface lease is active', () => {
    const { controller, operationEvents, presentations, time } = createHarness()
    controller.acquireLease()

    succeed(controller)
    expect(controller.getSnapshot().status).toBe('success')
    expect(operationEvents).toEqual(['created:created', 'started:running', 'settled:succeeded'])

    time.advanceBy(1_999)
    expect(controller.getSnapshot().status).toBe('success')
    expect(presentations).toHaveLength(0)
    time.advanceBy(1)
    expect(controller.getSnapshot().status).toBe('idle')
  })

  it('preserves current feedback when a new operation cannot start', () => {
    const { controller } = createHarness()
    controller.acquireLease()
    succeed(controller)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(controller.begin('', 'Saving')).toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'success',
      title: 'Saved'
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[SurfaceFeedbackController] begin failed',
      expect.any(TypeError)
    )
  })

  it('rejects a blank pending label without throwing or leaking an operation', () => {
    const { controller, operations } = createHarness()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(controller.begin('settings.agent.save', '   ')).toBe(false)
    expect(controller.getSnapshot().status).toBe('idle')
    expect(operations.get('settings.agent.save')).toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      '[SurfaceFeedbackController] begin failed',
      expect.any(TypeError)
    )
  })

  it('requires pending work to be explicitly cancelled instead of silently clearing it', () => {
    const { controller, operationEvents } = createHarness()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    controller.begin('settings.agent.save', 'Saving')

    expect(controller.clearSettled()).toBe(false)
    expect(controller.getSnapshot().status).toBe('pending')

    expect(controller.cancelPending()).toBe(true)
    expect(controller.getSnapshot().status).toBe('idle')
    expect(operationEvents.at(-1)).toBe('settled:cancelled')
    expect(consoleError).toHaveBeenCalledWith(
      '[SurfaceFeedbackController] clear settled feedback failed',
      expect.any(Error)
    )
  })

  it('closes an operation when terminal display data is invalid', () => {
    const { controller, operations } = createHarness()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    controller.begin('settings.agent.save', 'Saving')

    expect(
      controller.fail({
        code: 'not a semantic code',
        title: ''
      })
    ).toBe(false)

    expect(controller.getSnapshot().status).toBe('idle')
    expect(operations.get('settings.agent.save')).toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      '[SurfaceFeedbackController] settle error failed',
      expect.any(TypeError)
    )
  })

  it('diagnoses duplicate and late transitions without replacing the active operation', () => {
    const { controller, operations } = createHarness()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(controller.begin('settings.agent.save', 'Saving')).toBe(true)

    expect(controller.begin('settings.agent.other', 'Saving another')).toBe(false)
    expect(operations.get('settings.agent.save')).toMatchObject({ status: 'running' })
    expect(operations.get('settings.agent.other')).toBeUndefined()

    expect(
      controller.fail({
        code: 'settings.agent.saveFailed',
        title: 'Save failed'
      })
    ).toBe(true)
    expect(
      controller.fail({
        code: 'settings.agent.saveFailed',
        title: 'Save failed again'
      })
    ).toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'error',
      title: 'Save failed'
    })
    expect(consoleError).toHaveBeenCalledTimes(2)
  })

  it('pauses inline success time while the document is hidden', () => {
    const { controller, presentations, time, visibility } = createHarness()
    controller.acquireLease()
    succeed(controller)

    time.advanceBy(600)
    visibility.setVisible(false)
    time.advanceBy(10_000)
    expect(controller.getSnapshot().status).toBe('success')
    expect(presentations).toHaveLength(0)

    visibility.setVisible(true)
    time.advanceBy(1_399)
    expect(controller.getSnapshot().status).toBe('success')
    time.advanceBy(1)
    expect(controller.getSnapshot().status).toBe('idle')
  })

  it('does not replay observed inline success after its lease becomes inactive', () => {
    const { controller, presentations, time } = createHarness()
    const lease = controller.acquireLease()
    succeed(controller)

    time.advanceBy(500)
    lease.setActive(false)
    time.advanceBy(200)

    expect(presentations).toHaveLength(0)
    expect(controller.getSnapshot().status).toBe('idle')
  })

  it('does not replay observed inline errors after their lease becomes inactive', () => {
    const { controller, presentations, time } = createHarness()
    const lease = controller.acquireLease()
    controller.begin('settings.agent.save', 'Saving')
    controller.fail({
      code: 'settings.agent.saveFailed',
      title: 'Save failed'
    })

    time.advanceBy(10_000)
    lease.setActive(false)
    time.advanceBy(200)

    expect(presentations).toHaveLength(0)
    expect(controller.getSnapshot().status).toBe('error')
  })

  it('rechecks inline availability after notification creation starts', () => {
    const time = new FakeNotificationTime()
    const visibility = new FakeSurfaceVisibility()
    const dismiss = vi.fn()
    let controller: SurfaceFeedbackController
    const notify = vi.fn(() => {
      controller.acquireLease()
      return { dismiss }
    })
    controller = new SurfaceFeedbackController({
      clock: time,
      scheduler: time,
      operations: new OperationRegistry(time),
      operationOwner: { process: 'renderer', rendererId: 'settings' },
      notifications: { notify },
      visibility
    })

    controller.begin('settings.agent.save', 'Saving')
    controller.fail({
      code: 'settings.agent.saveFailed',
      title: 'Save failed'
    })
    time.advanceBy(200)

    expect(notify).toHaveBeenCalledOnce()
    expect(dismiss).toHaveBeenCalledOnce()
    expect(dismiss).toHaveBeenCalledWith('surface-reclaimed')
    expect(controller.getSnapshot().status).toBe('error')
  })

  it('hands off an unobserved result once and does not replay it after inline reclaim', () => {
    const { controller, presentations, time } = createHarness()
    const lease = controller.acquireLease()
    controller.begin('settings.agent.save', 'Saving')
    lease.setActive(false)
    controller.fail({
      code: 'settings.agent.saveFailed',
      title: 'Save failed'
    })

    time.advanceBy(200)
    expect(presentations).toHaveLength(1)

    lease.setActive(true)
    expect(presentations[0].dismiss).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().status).toBe('error')

    lease.setActive(false)
    time.advanceBy(200)
    expect(presentations).toHaveLength(1)
  })

  it('clears handed-off success only after Sonner closes it', () => {
    const { controller, presentations, time } = createHarness()
    succeed(controller)

    time.advanceBy(200)
    expect(presentations).toHaveLength(1)
    expect(controller.getSnapshot().status).toBe('success')

    presentations[0].events.onClosed('auto')
    expect(controller.getSnapshot().status).toBe('idle')
  })

  it('keeps a handed-off error relevant without replaying it after auto close', () => {
    const { controller, presentations, time } = createHarness()
    controller.begin('settings.agent.save', 'Saving')
    controller.fail({
      code: 'settings.agent.saveFailed',
      title: 'Save failed'
    })

    time.advanceBy(200)
    presentations[0].events.onClosed('auto')
    expect(controller.getSnapshot().status).toBe('error')

    time.advanceBy(60_000)
    expect(presentations).toHaveLength(1)
    expect(controller.clearSettled()).toBe(true)
    expect(controller.getSnapshot().status).toBe('idle')
  })

  it('waits until every mounted lease is inactive before handing off', () => {
    const { controller, presentations, time, visibility } = createHarness()
    const primary = controller.acquireLease()
    const secondary = controller.acquireLease()
    visibility.setVisible(false)
    controller.begin('settings.agent.save', 'Saving')
    controller.fail({
      code: 'settings.agent.saveFailed',
      title: 'Save failed'
    })

    primary.release()
    time.advanceBy(200)
    expect(presentations).toHaveLength(0)

    secondary.release()
    time.advanceBy(200)
    expect(presentations).toHaveLength(1)
  })
})
