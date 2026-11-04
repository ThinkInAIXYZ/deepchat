import { describe, expect, it } from 'vitest'
import type { MessageFile } from '@shared/types/agent-interface'
import { isAudioAttachment } from '@/lib/audioInputSupport'

const createFile = (overrides: Partial<MessageFile>): MessageFile => ({
  name: 'file.txt',
  path: '/tmp/file.txt',
  ...overrides
})

describe('audioInputSupport', () => {
  it('detects audio attachments from mime type', () => {
    expect(
      isAudioAttachment(
        createFile({
          name: 'clip.bin',
          path: '/tmp/clip.bin',
          mimeType: 'audio/flac'
        })
      )
    ).toBe(true)
  })

  it('returns false for non-audio attachments', () => {
    expect(
      isAudioAttachment(
        createFile({
          name: 'report.pdf',
          path: '/tmp/report.pdf',
          mimeType: 'application/pdf'
        })
      )
    ).toBe(false)
  })

  it('detects audio attachments from file extensions when mime type is missing', () => {
    expect(
      isAudioAttachment(
        createFile({
          name: 'clip.M4A',
          path: '/tmp/clip.M4A',
          mimeType: ''
        })
      )
    ).toBe(true)
  })
})
