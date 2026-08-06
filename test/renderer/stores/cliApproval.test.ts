import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useCliApprovalStore', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('queues targeted requests, resolves once, and removes closed requests', async () => {
    let requested: ((payload: Record<string, unknown>) => void) | undefined
    let closed: ((payload: { requestId: string }) => void) | undefined
    const resolve = vi.fn(async () => false)
    vi.doMock('@api/ApprovalClient', () => ({
      createApprovalClient: () => ({
        onRequested: (listener: typeof requested) => {
          requested = listener
          return vi.fn()
        },
        onClosed: (listener: typeof closed) => {
          closed = listener
          return vi.fn()
        },
        resolve
      })
    }))
    vi.doMock('pinia', async () => {
      const actual = await vi.importActual<typeof import('pinia')>('pinia')
      return { ...actual, defineStore: (_id: string, setup: () => unknown) => setup }
    })

    const { useCliApprovalStore } = await import('@/stores/cliApproval')
    let store: ReturnType<typeof useCliApprovalStore> | undefined
    const Harness = defineComponent({
      setup() {
        store = useCliApprovalStore()
        return () => null
      }
    })
    const wrapper = mount(Harness)

    requested?.({
      requestId: 'approval-request-1234',
      operation: 'skills.installFromUrl',
      effect: 'supply-chain',
      principal: 'human',
      expiresAt: Date.now() + 60_000,
      displayData: { host: 'example.com' }
    })
    requested?.({
      requestId: 'approval-request-5678',
      operation: 'mcp.addPublic',
      effect: 'security-config',
      principal: 'human',
      expiresAt: Date.now() + 60_000
    })
    await flushPromises()

    expect(store?.request.value?.requestId).toBe('approval-request-1234')
    await store?.approve()
    expect(resolve).toHaveBeenCalledWith('approval-request-1234', 'approved')
    expect(store?.request.value?.requestId).toBe('approval-request-5678')

    closed?.({ requestId: 'approval-request-5678' })
    await flushPromises()
    expect(store?.isOpen.value).toBe(false)
    wrapper.unmount()
  })

  it('keeps a request visible when renderer resolution fails so the user can retry', async () => {
    let requested: ((payload: Record<string, unknown>) => void) | undefined
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error('IPC unavailable'))
      .mockResolvedValue(true)
    vi.doMock('@api/ApprovalClient', () => ({
      createApprovalClient: () => ({
        onRequested: (listener: typeof requested) => {
          requested = listener
          return vi.fn()
        },
        onClosed: () => vi.fn(),
        resolve
      })
    }))
    vi.doMock('pinia', async () => {
      const actual = await vi.importActual<typeof import('pinia')>('pinia')
      return { ...actual, defineStore: (_id: string, setup: () => unknown) => setup }
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { useCliApprovalStore } = await import('@/stores/cliApproval')
    let store: ReturnType<typeof useCliApprovalStore> | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          store = useCliApprovalStore()
          return () => null
        }
      })
    )
    requested?.({
      requestId: 'approval-request-1234',
      operation: 'providers.setCredential',
      effect: 'credential',
      principal: 'human',
      expiresAt: Date.now() + 60_000
    })
    await flushPromises()

    await store?.deny()
    expect(store?.request.value?.requestId).toBe('approval-request-1234')
    await store?.deny()
    expect(store?.isOpen.value).toBe(false)

    wrapper.unmount()
    error.mockRestore()
  })

  it('fails closed when the bounded renderer queue is full', async () => {
    let requested: ((payload: Record<string, unknown>) => void) | undefined
    const resolve = vi.fn(async () => true)
    vi.doMock('@api/ApprovalClient', () => ({
      createApprovalClient: () => ({
        onRequested: (listener: typeof requested) => {
          requested = listener
          return vi.fn()
        },
        onClosed: () => vi.fn(),
        resolve
      })
    }))
    vi.doMock('pinia', async () => {
      const actual = await vi.importActual<typeof import('pinia')>('pinia')
      return { ...actual, defineStore: (_id: string, setup: () => unknown) => setup }
    })

    const { useCliApprovalStore } = await import('@/stores/cliApproval')
    let store: ReturnType<typeof useCliApprovalStore> | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          store = useCliApprovalStore()
          return () => null
        }
      })
    )
    for (let index = 0; index < 33; index += 1) {
      requested?.({
        requestId: `approval-request-${String(index).padStart(4, '0')}`,
        operation: 'skills.installFromUrl',
        effect: 'supply-chain',
        principal: 'human',
        expiresAt: Date.now() + 60_000
      })
    }
    await flushPromises()

    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith('approval-request-0032', 'denied')
    expect(store?.request.value?.requestId).toBe('approval-request-0000')
    wrapper.unmount()
  })
})
