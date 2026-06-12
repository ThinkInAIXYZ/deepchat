import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { MessageFile } from '@shared/types/agent-interface'
import { useChatInputFiles } from '@/components/chat/composables/useChatInputFiles'

const { toastMock, fileClient } = vi.hoisted(() => ({
  toastMock: vi.fn(),
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

vi.mock('@/components/use-toast', () => ({
  useToast: () => ({
    toast: toastMock
  })
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
    expect(toastMock).not.toHaveBeenCalled()
    expect(target.value).toBe('')
  })

  it('shows a destructive toast when selected files fail processing', async () => {
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
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Attachment failed',
      description: 'Could not process 1 files: broken.docx',
      variant: 'destructive'
    })
    expect(target.value).toBe('')
    consoleSpy.mockRestore()
  })
})
