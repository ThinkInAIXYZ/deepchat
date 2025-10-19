import { describe, it, expect, beforeEach } from 'vitest'
import { useMessageScroll } from '@/composables/message/useMessageScroll'

class IO {
  cb: any
  constructor(cb: any) {
    this.cb = cb
  }
  observe() {
    this.cb([{ isIntersecting: false }])
  }
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  // @ts-ignore
  global.IntersectionObserver = IO as any
})

describe('useMessageScroll', () => {
  it('updates scroll info and threshold, supports scrolling to bottom/message', async () => {
    const api = useMessageScroll()
    const container = document.createElement('div')
    const anchor = document.createElement('div')
    Object.defineProperty(container, 'clientHeight', { value: 500 })
    Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(container, 'scrollTop', {
      get() {
        return this._st || 0
      },
      set(v) {
        this._st = v
      }
    })

    api.messagesContainer.value = container as any
    api.scrollAnchor.value = anchor as any

    api.setupScrollObserver()
    expect(api.aboveThreshold.value).toBe(true)

    api.scrollToBottom(false)
    // allow nextTick chain to run
    await Promise.resolve()
    expect((container as any)._st).toBe(1500)

    // add a target to scroll to
    const msg = document.createElement('div')
    msg.setAttribute('data-message-id', 'm-1')

    // Mock scrollIntoView method
    msg.scrollIntoView = () => {}

    document.body.appendChild(msg)
    api.scrollToMessage('m-1')
    await Promise.resolve()
    document.body.removeChild(msg)
  })
})
