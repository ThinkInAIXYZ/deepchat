import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { MessageFile } from '@shared/types/agent-interface'
import { useChatInputFiles } from '@/components/chat/composables/useChatInputFiles'

const { notifyMock, fileClient } = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  fileClient: {
    getMimeType: vi.fn(),
    prepareFile: vi.fn(),
    prepareDirectory: vi.fn(),
    readFile: vi.fn(),
    isDirectory: vi.fn(),
    writeImageBase64: vi.fn(),
    getPathForFile: vi.fn(),
    toRelativePath: vi.fn(),
    formatPathForInput: vi.fn()
  }
}))

vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer: notifyMock
}))

vi.mock('@api/FileClient', () => ({
  createFileClient: () => fileClient
}))

vi.mock('@/lib/image', () => ({
  calculateImageTokens: vi.fn(() => 12),
  getClipboardImageInfo: vi.fn(() =>
    Promise.resolve({
      width: 100,
      height: 100,
      compressedBase64: 'data:image/jpeg;base64,thumb'
    })
  ),
  imageFileToBase64: vi.fn(() => Promise.resolve('data:image/png;base64,image'))
}))

function createFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null
  } as unknown as FileList
}

function t(key: string, params?: Record<string, unknown>): string {
  const messages: Record<string, string> = {
    'chat.input.fileUploadFailed': 'Attachment failed',
    'chat.input.fileUploadFailedDesc': 'Could not process {count} files: {names}',
    'chat.input.fileUploadFailedMore': ' and {count} more',
    'chat.input.unnamedFile': 'unnamed file'
  }

  return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(params?.[name] ?? '')
  )
}

describe('useChatInputFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds selected docx files through the file presenter route', async () => {
    const messageFile: MessageFile = {
      name: 'report.docx',
      content: 'Document content',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      metadata: {
        fileName: 'report.docx',
        fileSize: 42,
        fileDescription: 'Word Document',
        fileCreated: new Date().toISOString(),
        fileModified: new Date().toISOString()
      },
      token: 10,
      path: '/tmp/report.docx'
    }
    const emit = vi.fn()
    const target = { files: createFileList([new File(['docx'], 'report.docx')]), value: 'x' }
    fileClient.getPathForFile.mockReturnValue('/tmp/report.docx')
    fileClient.getMimeType.mockResolvedValue(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    fileClient.prepareFile.mockResolvedValue(messageFile)

    const files = useChatInputFiles(ref(undefined), emit, t)
    await files.handleFileSelect({ target } as unknown as Event)

    expect(fileClient.prepareFile).toHaveBeenCalledWith(
      '/tmp/report.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(emit).toHaveBeenCalledWith('file-upload', [messageFile])
    expect(notifyMock).not.toHaveBeenCalled()
    expect(target.value).toBe('')
  })

  it('reports a semantic error when selected files fail processing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const emit = vi.fn()
    const target = { files: createFileList([new File(['bad'], 'broken.docx')]), value: 'x' }
    fileClient.getPathForFile.mockReturnValue('/tmp/broken.docx')
    fileClient.getMimeType.mockResolvedValue(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    fileClient.prepareFile.mockRejectedValue(new Error('invalid docx'))

    const files = useChatInputFiles(ref(undefined), emit, t)
    await files.handleFileSelect({ target } as unknown as Event)

    expect(emit).not.toHaveBeenCalled()
    expect(notifyMock).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.attachment.processingFailed',
      title: 'Attachment failed',
      description: 'Could not process 1 files: broken.docx'
    })
    expect(target.value).toBe('')
    consoleSpy.mockRestore()
  })

  it('updates one attachment representation without mutating the original file object', () => {
    const emit = vi.fn()
    const files = useChatInputFiles(ref(undefined), emit, t)
    const original: MessageFile = {
      name: 'scan.png',
      path: '/tmp/scan.png',
      mimeType: 'image/png'
    }
    files.selectedFiles.value = [original]

    files.updateFile(0, { requestedRepresentation: 'ocr_text' })

    expect(files.selectedFiles.value[0]).toEqual({
      ...original,
      requestedRepresentation: 'ocr_text'
    })
    expect(files.selectedFiles.value[0]).not.toBe(original)
    expect(original.requestedRepresentation).toBeUndefined()
    expect(emit).toHaveBeenCalledWith('file-upload', files.selectedFiles.value)
  })
})
