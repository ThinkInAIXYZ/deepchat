import { describe, expect, it } from 'vitest'
import { shouldRejectAgentBinaryRead } from '../../../src/main/lib/binaryReadGuard'

describe('binaryReadGuard', () => {
  it('allows application/octet-stream without binary sniffing', () => {
    expect(shouldRejectAgentBinaryRead('application/octet-stream')).toBe(false)
  })

  it.each(['application/zip', 'application/wasm', 'audio/mpeg', 'video/mp4'])(
    'still rejects known binary MIME %s',
    (mimeType) => {
      expect(shouldRejectAgentBinaryRead(mimeType)).toBe(true)
    }
  )

  it('keeps images available for vision reads', () => {
    expect(shouldRejectAgentBinaryRead('image/png')).toBe(false)
  })
})
