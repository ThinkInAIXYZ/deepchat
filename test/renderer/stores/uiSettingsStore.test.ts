import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

describe('uiSettingsStore', () => {
  let invoke: ReturnType<typeof vi.fn>
  let on: ReturnType<typeof vi.fn>
  let unsubscribe: ReturnType<typeof vi.fn>

  const mountStoreHost = async () => {
    const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
    const { useUiSettingsStore } = await import('../../../src/renderer/src/stores/uiSettingsStore')
    let store: ReturnType<typeof useUiSettingsStore> | null = null
    const pinia = createPinia()
    setActivePinia(pinia)

    const Host = defineComponent({
      setup() {
        store = useUiSettingsStore()
        return () => null
      }
    })

    const wrapper = mount(Host, {
      global: {
        plugins: [pinia]
      }
    })

    if (!store) {
      throw new Error('Failed to initialize uiSettingsStore in test host')
    }

    return { wrapper, store }
  }

  beforeEach(() => {
    vi.doUnmock('pinia')
    vi.resetModules()

    unsubscribe = vi.fn()
    invoke = vi.fn(async (routeName: string, input: any) => {
      if (routeName === 'settings.getSnapshot') {
        return {
          version: 1,
          values: {
            fontSizeLevel: 3,
            fontFamily: 'Inter',
            codeFontFamily: 'JetBrains Mono',
            autoScrollEnabled: false,
            notificationsEnabled: false
          }
        }
      }

      if (routeName === 'settings.listSystemFonts') {
        return {
          fonts: ['Inter', 'JetBrains Mono']
        }
      }

      if (routeName === 'settings.update') {
        return {
          version: 2,
          changedKeys: input.changes.map((change: { key: string }) => change.key),
          values: Object.fromEntries(
            input.changes.map((change: { key: string; value: unknown }) => [
              change.key,
              change.value
            ])
          )
        }
      }

      throw new Error(`Unexpected route in test: ${routeName}`)
    })
    on = vi.fn(() => unsubscribe)

    Object.assign(window, {
      deepchat: {
        invoke,
        on
      },
      electron: undefined
    })
  })

  it('hydrates from the typed settings snapshot and reacts to typed settings.changed events', async () => {
    const { wrapper, store } = await mountStoreHost()

    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('settings.getSnapshot', { keys: undefined })
    expect(on).toHaveBeenCalledWith('settings.changed', expect.any(Function))
    expect(store.fontSizeLevel).toBe(3)
    expect(store.fontFamily).toBe('Inter')
    expect(store.codeFontFamily).toBe('JetBrains Mono')
    expect(store.autoScrollEnabled).toBe(false)
    expect(store.notificationsEnabled).toBe(false)

    const listener = on.mock.calls[0]?.[1] as
      | ((payload: {
          changedKeys: string[]
          version: number
          values: Record<string, unknown>
        }) => void)
      | undefined

    listener?.({
      changedKeys: ['fontSizeLevel', 'notificationsEnabled'],
      version: 3,
      values: {
        fontSizeLevel: 4,
        notificationsEnabled: true
      }
    })

    expect(store.fontSizeLevel).toBe(4)
    expect(store.notificationsEnabled).toBe(true)

    wrapper.unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('uses typed routes for settings updates and system font loading', async () => {
    const { store } = await mountStoreHost()

    await flushPromises()

    await store.fetchSystemFonts()
    await store.updateFontSizeLevel(10)

    expect(invoke).toHaveBeenNthCalledWith(2, 'settings.listSystemFonts', {})
    expect(invoke).toHaveBeenNthCalledWith(3, 'settings.update', {
      changes: [{ key: 'fontSizeLevel', value: 4 }]
    })
    expect(store.systemFonts).toEqual(['Inter', 'JetBrains Mono'])
    expect(store.fontSizeLevel).toBe(4)
  })
})
