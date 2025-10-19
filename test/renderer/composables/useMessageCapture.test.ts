import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMessageCapture } from '@/composables/message/useMessageCapture'

vi.mock('@/composables/usePageCapture', () => ({
  usePageCapture: () => ({
    isCapturing: { value: false },
    captureAndCopy: vi.fn().mockResolvedValue(true)
  })
}))
vi.mock('@/composables/usePresenter', () => ({
  usePresenter: (name: string) => {
    if (name === 'devicePresenter') {
      return { getAppVersion: vi.fn().mockResolvedValue('1.0.0') }
    }
    return {}
  }
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k })
}))
vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    isDark: false
  })
}))

describe('useMessageCapture', () => {
  beforeEach(() => {
    // container
    const container = document.createElement('div')
    container.className = 'message-list-container'
    document.body.appendChild(container)
  })

  afterEach(() => {
    // clean up container to avoid DOM accumulation
    const container = document.querySelector('.message-list-container')
    if (container) {
      document.body.removeChild(container)
    }
  })

  it('captures assistant and user block area', async () => {
    const api = useMessageCapture()

    // prepare elements
    const user = document.createElement('div')
    user.setAttribute('data-message-id', 'u1')
    const asst = document.createElement('div')
    asst.setAttribute('data-message-id', 'a1')
    document.body.appendChild(user)
    document.body.appendChild(asst)

    const ok = await api.captureMessage({
      messageId: 'a1',
      parentId: 'u1',
      modelInfo: { model_name: 'm', model_provider: 'p' }
    })
    expect(ok).toBe(true)

    document.body.removeChild(user)
    document.body.removeChild(asst)
  })

  it('captures from top to current', async () => {
    const api = useMessageCapture()
    const first = document.createElement('div')
    first.setAttribute('data-message-id', 'x-first')
    const current = document.createElement('div')
    current.setAttribute('data-message-id', 'x-current')
    document.body.appendChild(first)
    document.body.appendChild(current)

    const ok = await api.captureMessage({ messageId: 'x-current', fromTop: true })
    expect(ok).toBe(true)

    document.body.removeChild(first)
    document.body.removeChild(current)
  })
})
