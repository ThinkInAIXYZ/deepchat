import { describe, expect, it, vi } from 'vitest'
import { getUtilityParentPort } from '@/platform/utilityParentPort'

describe('getUtilityParentPort', () => {
  it('adapts Node child-process IPC when Electron parentPort is absent', () => {
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
    const parentPortDescriptor = Object.getOwnPropertyDescriptor(process, 'parentPort')
    const send = vi.fn()
    const received = vi.fn()
    const request = { type: 'probe', value: 1 }

    delete (process as NodeJS.Process & { parentPort?: unknown }).parentPort
    Object.defineProperty(process, 'send', { configurable: true, value: send })

    try {
      const parentPort = getUtilityParentPort()
      expect(parentPort).not.toBeNull()

      parentPort!.on('message', received)
      process.emit('message', request)
      parentPort!.postMessage(request)

      expect(received).toHaveBeenCalledWith(request)
      expect(send).toHaveBeenCalledWith(request)
    } finally {
      process.off('message', received)
      if (sendDescriptor) Object.defineProperty(process, 'send', sendDescriptor)
      else delete (process as NodeJS.Process & { send?: unknown }).send
      if (parentPortDescriptor) Object.defineProperty(process, 'parentPort', parentPortDescriptor)
    }
  })
})
