import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

describe('KnowledgeFile', () => {
  async function setup() {
    vi.resetModules()

    const file = {
      id: 'file-1',
      name: 'guide.md',
      path: '/workspace/guide.md',
      mimeType: 'text/markdown',
      status: 'processing' as const,
      uploadedAt: 123,
      metadata: {
        size: 1024,
        totalChunks: 3
      }
    }
    let fileUpdatedListener:
      | ((updatedFile: {
          id: string
          name: string
          path: string
          mimeType: string
          status: 'processing' | 'completed' | 'error' | 'paused'
          uploadedAt: number
          metadata: { size: number; totalChunks: number; errorReason?: string }
        }) => void)
      | null = null
    let fileProgressListener:
      | ((progress: { fileId: string; completed: number; error: number; total: number }) => void)
      | null = null
    const stopFileUpdated = vi.fn()
    const stopFileProgress = vi.fn()
    const knowledgeClient = {
      listFiles: vi.fn().mockResolvedValue([file]),
      getSupportedFileExtensions: vi.fn().mockResolvedValue(['md', 'txt', 'pdf', 'docx']),
      onFileUpdated: vi.fn((listener) => {
        fileUpdatedListener = listener
        return stopFileUpdated
      }),
      onFileProgress: vi.fn((listener) => {
        fileProgressListener = listener
        return stopFileProgress
      }),
      similarityQuery: vi.fn().mockResolvedValue([]),
      validateFile: vi.fn().mockResolvedValue({ isSupported: true }),
      addFile: vi.fn().mockResolvedValue({ data: file }),
      deleteFile: vi.fn().mockResolvedValue(true),
      reAddFile: vi.fn().mockResolvedValue({ data: { ...file, status: 'processing' } }),
      pauseAllRunningTasks: vi.fn().mockResolvedValue(true),
      resumeAllPausedTasks: vi.fn().mockResolvedValue(true)
    }
    const deviceClient = {
      copyText: vi.fn()
    }
    const fileClient = {
      getPathForFile: vi.fn(() => '/workspace/guide.md')
    }

    vi.doMock('@api/KnowledgeClient', () => ({
      createKnowledgeClient: () => knowledgeClient
    }))
    vi.doMock('@api/DeviceClient', () => ({
      createDeviceClient: () => deviceClient
    }))
    vi.doMock('@api/FileClient', () => ({
      createFileClient: () => fileClient
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const KnowledgeFile = (
      await import('../../../src/renderer/settings/components/KnowledgeFile.vue')
    ).default

    const wrapper = mount(KnowledgeFile, {
      props: {
        builtinKnowledgeDetail: {
          id: 'knowledge-1',
          description: 'Local docs',
          embedding: {
            providerId: 'openai',
            modelId: 'text-embedding-3-small'
          },
          dimensions: 1536,
          normalized: true,
          fragmentsNumber: 6,
          enabled: true
        }
      },
      global: {
        stubs: {
          Icon: true,
          DcButton: buttonStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          Input: true,
          ScrollArea: passthrough('ScrollArea'),
          Tooltip: passthrough('Tooltip'),
          TooltipContent: passthrough('TooltipContent'),
          TooltipProvider: passthrough('TooltipProvider'),
          TooltipTrigger: passthrough('TooltipTrigger'),
          KnowledgeFileItem: true
        }
      }
    })
    await flushPromises()

    return {
      wrapper,
      knowledgeClient,
      fileUpdatedListener: () => fileUpdatedListener,
      fileProgressListener: () => fileProgressListener,
      stopFileUpdated,
      stopFileProgress
    }
  }

  it('loads files and supported extensions through KnowledgeClient', async () => {
    const { wrapper, knowledgeClient } = await setup()
    const vm = wrapper.vm as any

    expect(knowledgeClient.listFiles).toHaveBeenCalledWith('knowledge-1')
    expect(knowledgeClient.getSupportedFileExtensions).toHaveBeenCalledTimes(1)
    expect(knowledgeClient.onFileUpdated).toHaveBeenCalledTimes(1)
    expect(vm.fileList).toEqual([expect.objectContaining({ id: 'file-1' })])
    expect(vm.acceptExts).toEqual(['txt', 'md', 'markdown', 'docx', 'pptx', 'pdf'])
  })

  it('applies typed file update events and unsubscribes on unmount', async () => {
    const {
      wrapper,
      fileUpdatedListener,
      fileProgressListener,
      stopFileUpdated,
      stopFileProgress
    } = await setup()
    const listener = fileUpdatedListener()
    const progressListener = fileProgressListener()

    expect(listener).toBeTruthy()
    expect(progressListener).toBeTruthy()
    progressListener?.({
      fileId: 'file-1',
      completed: 2,
      error: 1,
      total: 4
    })
    expect((wrapper.vm as any).fileProgressById.get('file-1')).toEqual({
      completed: 2,
      error: 1,
      total: 4
    })
    listener?.({
      id: 'file-1',
      name: 'guide.md',
      path: '/workspace/guide.md',
      mimeType: 'text/markdown',
      status: 'completed',
      uploadedAt: 123,
      metadata: {
        size: 1024,
        totalChunks: 3
      }
    })

    expect((wrapper.vm as any).fileList[0].status).toBe('completed')
    expect((wrapper.vm as any).fileProgressById.has('file-1')).toBe(false)
    wrapper.unmount()
    expect(stopFileUpdated).toHaveBeenCalledTimes(1)
    expect(stopFileProgress).toHaveBeenCalledTimes(1)
  })

  it('keeps a search failure inside the search surface', async () => {
    const { wrapper, knowledgeClient } = await setup()
    const vm = wrapper.vm as any
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    knowledgeClient.similarityQuery.mockRejectedValueOnce(new Error('query failed'))
    vm.searchKey = 'missing document'

    await vm.handleSearch()

    expect(vm.searchError).toBe('settings.knowledgeBase.searchError')
    expect(vm.searchResult).toEqual([])
    expect(vm.loading).toBe(false)
    consoleError.mockRestore()
    wrapper.unmount()
  })

  it('summarizes rejected uploads without starting unsupported files', async () => {
    const { wrapper, knowledgeClient } = await setup()
    const vm = wrapper.vm as any
    knowledgeClient.validateFile.mockResolvedValueOnce({
      isSupported: false,
      error: 'Unsupported file type'
    })

    await vm.handleFileUpload([new File(['content'], 'notes.exe')])

    expect(knowledgeClient.addFile).not.toHaveBeenCalled()
    expect(vm.uploadFailures).toEqual([
      expect.objectContaining({
        name: 'notes.exe',
        reason: 'settings.knowledgeBase.fileSupport'
      })
    ])
    expect(vm.uploading).toBe(false)
    wrapper.unmount()
  })

  it('keeps a failed re-add visible on the file row', async () => {
    const { wrapper, knowledgeClient } = await setup()
    const vm = wrapper.vm as any
    knowledgeClient.reAddFile.mockResolvedValueOnce({ error: 'Embedding failed' })

    await vm.reAddFile(vm.fileList[0])

    expect(vm.fileList[0].status).toBe('error')
    expect(vm.fileList[0].metadata.errorReason).toBe('settings.knowledgeBase.uploadError')
    wrapper.unmount()
  })

  it('does not remove a file locally when deletion is rejected', async () => {
    const { wrapper, knowledgeClient } = await setup()
    const vm = wrapper.vm as any
    knowledgeClient.deleteFile.mockResolvedValueOnce(false)

    await vm.deleteFile('file-1')

    expect(vm.fileList).toHaveLength(1)
    expect(vm.pageError).toBe('common.error.operationFailed')
    wrapper.unmount()
  })
})
