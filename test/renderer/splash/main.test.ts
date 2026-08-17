import { afterEach, describe, expect, it, vi } from 'vitest'

const createAppMock = vi.hoisted(() => vi.fn())
const createRendererI18nMock = vi.hoisted(() => vi.fn())

vi.mock('vue', () => ({
  createApp: createAppMock
}))
vi.mock('../../../src/renderer/splash/loading.vue', () => ({
  default: {}
}))
vi.mock('../../../src/renderer/src/i18n/bootstrap', () => ({
  createRendererI18n: createRendererI18nMock
}))

describe('splash bootstrap', () => {
  afterEach(() => {
    document.documentElement.dir = ''
    vi.clearAllMocks()
    vi.resetModules()
  })

  const bootstrapSplash = async (direction: 'auto' | 'rtl' | 'ltr') => {
    const use = vi.fn()
    const mount = vi.fn()
    createAppMock.mockReturnValue({ use, mount })
    createRendererI18nMock.mockResolvedValue({
      i18n: {},
      languageState: {
        requestedLanguage: direction === 'rtl' ? 'fa-IR' : 'en-US',
        locale: direction === 'rtl' ? 'fa-IR' : 'en-US',
        direction
      }
    })
    window.deepchatSplash = {
      onUpdate: vi.fn(() => vi.fn()),
      onUnlockRequest: vi.fn(() => vi.fn()),
      onUnlockProgress: vi.fn(() => vi.fn()),
      onDebugMode: vi.fn(() => vi.fn()),
      getLanguageState: vi.fn(),
      submitUnlock: vi.fn(),
      cancelUnlock: vi.fn(),
      onRecoveryRequest: vi.fn(() => vi.fn()),
      submitRecovery: vi.fn(),
      cancelRecovery: vi.fn()
    }

    await import('../../../src/renderer/splash/main')
    await vi.waitFor(() => expect(mount).toHaveBeenCalledWith('#app'))
    return { use, mount }
  }

  it('applies RTL direction before mounting the splash app', async () => {
    await bootstrapSplash('rtl')

    expect(document.documentElement.dir).toBe('rtl')
  })

  it('uses auto direction for non-RTL language states', async () => {
    await bootstrapSplash('ltr')

    expect(document.documentElement.dir).toBe('auto')
  })
})
