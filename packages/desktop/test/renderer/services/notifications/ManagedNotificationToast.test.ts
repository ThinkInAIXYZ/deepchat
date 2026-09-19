import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManagedNotificationToast from '@renderer-notifications/ManagedNotificationToast.vue'
import { ObservableNotificationRecord } from '@renderer-notifications'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count === undefined ? key : `${key}:${params.count}`
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    props: { icon: { type: String, required: true } },
    template: '<span :data-icon="icon" />'
  })
}))

const createRecord = (
  overrides: Partial<ConstructorParameters<typeof ObservableNotificationRecord>[0]> = {}
) =>
  new ObservableNotificationRecord({
    logicalId: 'notification-1',
    code: 'test.notification',
    kind: 'error',
    title: 'Connection failed',
    description: undefined,
    occurrenceCount: 1,
    entityCount: 1,
    pendingCount: 0,
    createdAt: 0,
    lastSeenAt: 0,
    ...overrides
  })

const mountToast = (record: ObservableNotificationRecord) => {
  const onAction = vi.fn()
  const onCloseToast = vi.fn()
  const wrapper = mount(ManagedNotificationToast, {
    props: {
      record,
      onAction,
      onCloseToast
    }
  })
  return { wrapper, onAction, onCloseToast }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ManagedNotificationToast', () => {
  it('updates one fixed-shape component when its external record changes', async () => {
    const record = createRecord()
    const { wrapper } = mountToast(record)
    const root = wrapper.element

    record.patch({
      title: 'Two servers failed',
      description: 'Open server settings',
      occurrenceCount: 3,
      entityCount: 2
    })
    await nextTick()

    expect(wrapper.element).toBe(root)
    expect(wrapper.get('.notification-toast__title').text()).toBe('Two servers failed')
    expect(wrapper.get('.notification-toast__detail-text').text()).toBe('Open server settings')
    expect(wrapper.get('.notification-toast__count').text()).toBe('×3')
    expect(wrapper.findAll('.notification-toast__title')).toHaveLength(1)
    expect(wrapper.findAll('.notification-toast__detail')).toHaveLength(1)
  })

  it('keeps bounded geometry while localized copy and counters grow', async () => {
    const record = createRecord({
      kind: 'actionable',
      title: 'A'.repeat(180),
      description: 'B'.repeat(240),
      occurrenceCount: 9,
      pendingCount: 9,
      action: {
        label: 'C'.repeat(120),
        onClick: vi.fn()
      }
    })
    const { wrapper } = mountToast(record)
    const root = wrapper.get('.notification-toast')
    const rootElement = root.element

    record.patch({
      title: 'D'.repeat(360),
      description: 'E'.repeat(480),
      occurrenceCount: 1_000,
      entityCount: 1_000,
      pendingCount: 1_000
    })
    await nextTick()

    expect(root.element).toBe(rootElement)
    expect(wrapper.findAll('.notification-toast__title')).toHaveLength(1)
    expect(wrapper.findAll('.notification-toast__detail')).toHaveLength(1)
    expect(wrapper.get('.notification-toast__count').text()).toBe('×99+')
    expect(wrapper.get('.notification-toast__pending').text()).toBe('+99+')
    expect(wrapper.get('.notification-toast__title').attributes('title')).toBe('D'.repeat(360))
    expect(wrapper.get('.notification-toast__detail-text').attributes('title')).toBe(
      'E'.repeat(480)
    )
    expect(wrapper.get('.notification-toast__action').attributes('title')).toBe('C'.repeat(120))
  })

  it('closes only after an actionable callback succeeds', async () => {
    const action = {
      label: 'Repair',
      onClick: vi.fn().mockResolvedValue(undefined)
    }
    const record = createRecord({
      kind: 'actionable',
      action
    })
    const { wrapper, onAction, onCloseToast } = mountToast(record)

    await wrapper.get('.notification-toast__action').trigger('click')
    await flushPromises()

    expect(action.onClick).toHaveBeenCalledOnce()
    expect(onAction).toHaveBeenCalledOnce()
    expect(onCloseToast).toHaveBeenCalledOnce()
  })

  it('keeps a failed action visible in the reserved detail row', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const record = createRecord({
      kind: 'actionable',
      action: {
        label: 'Repair',
        onClick: vi.fn().mockRejectedValue(new Error('repair unavailable'))
      }
    })
    const { wrapper, onAction, onCloseToast } = mountToast(record)

    await wrapper.get('.notification-toast__action').trigger('click')
    await flushPromises()

    expect(wrapper.get('.notification-toast__detail-text').text()).toBe(
      'common.notifications.actionFailed'
    )
    expect(onAction).not.toHaveBeenCalled()
    expect(onCloseToast).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
  })

  it('renders determinate progress without changing component geometry', async () => {
    const record = createRecord({
      kind: 'progress',
      progress: 0.25
    })
    const { wrapper } = mountToast(record)

    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
    record.patch({ progress: 0.75 })
    await nextTick()
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('75')
    expect(wrapper.get('.notification-toast__detail-text').text()).toBe('75%')
  })
})
