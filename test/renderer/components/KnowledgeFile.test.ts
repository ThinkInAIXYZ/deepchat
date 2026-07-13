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
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
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
    const stopFileUpdated = vi.fn()
    const knowledgeClient = {
      listFiles: vi.fn().mockResolvedValue([file]),
      getSupportedFileExtensions: vi.fn().mockResolvedValue(['md', 'txt', 'pdf', 'docx']),
      onFileUpdated: vi.fn((listener) => {
        fileUpdatedListener = listener
        return stopFileUpdated
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
    vi.doMock('@/components/use-toast', () => ({
      toast: vi.fn()
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
          Button: buttonStub,
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
      stopFileUpdated
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
    const { wrapper, fileUpdatedListener, stopFileUpdated } = await setup()
    const listener = fileUpdatedListener()

    expect(listener).toBeTruthy()
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
    wrapper.unmount()
    expect(stopFileUpdated).toHaveBeenCalledTimes(1)
  })
})
