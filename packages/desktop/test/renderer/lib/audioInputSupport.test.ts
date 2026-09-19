import { describe, expect, it } from 'vitest'
import type { MessageFile } from '@shared/types/agent-interface'
import { filterUnsupportedAudioAttachments, isAudioAttachment } from '@/lib/audioInputSupport'

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

  it('filters audio attachments when the model does not support audio input', () => {
    const result = filterUnsupportedAudioAttachments(
      [
        createFile({ name: 'notes.md', path: '/tmp/notes.md', mimeType: 'text/markdown' }),
        createFile({ name: 'clip.wav', path: '/tmp/clip.wav', mimeType: 'audio/wav' }),
        createFile({ name: 'diagram.png', path: '/tmp/diagram.png', mimeType: 'image/png' })
      ],
      false
    )

    expect(result.acceptedFiles).toEqual([
      createFile({ name: 'notes.md', path: '/tmp/notes.md', mimeType: 'text/markdown' }),
      createFile({ name: 'diagram.png', path: '/tmp/diagram.png', mimeType: 'image/png' })
    ])
    expect(result.rejectedAudioFiles).toEqual([
      createFile({ name: 'clip.wav', path: '/tmp/clip.wav', mimeType: 'audio/wav' })
    ])
  })

  it('keeps audio attachments when the model supports audio input', () => {
    const files = [
      createFile({ name: 'clip.wav', path: '/tmp/clip.wav', mimeType: 'audio/wav' }),
      createFile({ name: 'notes.md', path: '/tmp/notes.md', mimeType: 'text/markdown' })
    ]
    const result = filterUnsupportedAudioAttachments(files, true)

    expect(result.acceptedFiles).toEqual(files)
    expect(result.rejectedAudioFiles).toEqual([])
  })
})
