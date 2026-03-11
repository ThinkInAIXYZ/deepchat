import { describe, expect, it, vi, beforeEach } from 'vitest'
import { shouldRejectAgentBinaryRead } from '../../../src/main/lib/binaryReadGuard'
import { isLikelyTextFile } from '@/presenter/filePresenter/mime'

vi.mock('@/presenter/filePresenter/mime', () => ({
  detectMimeType: vi.fn(),
  isLikelyTextFile: vi.fn()
}))

describe('binaryReadGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to text detection for application/octet-stream', async () => {
    vi.mocked(isLikelyTextFile).mockResolvedValue(true)

    await expect(
      shouldRejectAgentBinaryRead('/tmp/maybe-text.bin', 'application/octet-stream')
    ).resolves.toBe(false)
  })

  it('still rejects octet-stream files that do not look like text', async () => {
    vi.mocked(isLikelyTextFile).mockResolvedValue(false)

    await expect(
      shouldRejectAgentBinaryRead('/tmp/blob.bin', 'application/octet-stream')
    ).resolves.toBe(true)
  })
})
