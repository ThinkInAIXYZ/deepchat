import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { usePromptInputFiles } from '@/components/chat-input/composables/usePromptInputFiles'

const { readFile, toast } = vi.hoisted(() => {
  return {
    readFile: vi.fn(async (path: string) => `content:${path}`),
    toast: vi.fn()
  }
})

vi.mock('@/composables/file/useFileAdapter', () => ({
  useFileAdapter: () => ({
    readFile
  })
}))

vi.mock('@/components/use-toast', () => ({
  useToast: () => ({ toast })
}))

describe('usePromptInputFiles', () => {
  beforeEach(() => {
    readFile.mockClear()
    toast.mockClear()
  })

  it('adds prompt files and emits upload', async () => {
    const fileInput = ref<HTMLInputElement | undefined>(undefined)
    const emit = vi.fn()
    const t = (key: string) => key

    const { handlePromptFiles, selectedFiles } = usePromptInputFiles(fileInput, emit, t)

    await handlePromptFiles([
      {
        id: '1',
        name: 'a.txt',
        type: 'text/plain',
        size: 12,
        path: '/tmp/a.txt',
        createdAt: 1
      },
      {
        id: '2',
        name: 'b.txt',
        type: 'text/plain',
        size: 8,
        path: '/tmp/b.txt',
        content: 'hello',
        createdAt: 2
      }
    ])

    expect(selectedFiles.value).toHaveLength(2)
    expect(selectedFiles.value[0].content).toBe('content:/tmp/a.txt')
    expect(selectedFiles.value[1].content).toBe('hello')
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(readFile).toHaveBeenCalledWith('/tmp/a.txt')
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('file-upload', selectedFiles.value)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'chat.input.promptFilesAdded' })
    )
  })

  it('deduplicates prompt files by name', async () => {
    const fileInput = ref<HTMLInputElement | undefined>(undefined)
    const emit = vi.fn()
    const t = (key: string) => key

    const { handlePromptFiles, selectedFiles } = usePromptInputFiles(fileInput, emit, t)

    await handlePromptFiles([
      {
        id: '1',
        name: 'a.txt',
        type: 'text/plain',
        size: 12,
        path: '/tmp/a.txt',
        createdAt: 1
      }
    ])

    await handlePromptFiles([
      {
        id: '2',
        name: 'a.txt',
        type: 'text/plain',
        size: 12,
        path: '/tmp/a.txt',
        createdAt: 2
      }
    ])

    expect(selectedFiles.value).toHaveLength(1)
    expect(emit).toHaveBeenCalledTimes(1)
  })
})
