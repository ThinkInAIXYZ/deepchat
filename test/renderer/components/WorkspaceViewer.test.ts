import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

describe('WorkspaceViewer', () => {
  const setup = async (options?: {
    sessionState?: {
      selectedArtifactContext: {
        threadId: string
        messageId: string
        artifactId: string
      } | null
      selectedFilePath: string | null
      selectedDiffPath: string | null
      viewMode: 'preview' | 'code'
      sections: {
        files: boolean
        git: boolean
        artifacts: boolean
      }
    }
    props?: Record<string, unknown>
  }) => {
    vi.resetModules()

    const sessionState =
      options?.sessionState ??
      ({
        selectedArtifactContext: {
          threadId: 'thread-1',
          messageId: 'message-1',
          artifactId: 'artifact-1'
        },
        selectedFilePath: null,
        selectedDiffPath: null,
        viewMode: 'preview',
        sections: {
          files: true,
          git: false,
          artifacts: true
        }
      } as const)

    const sidepanelStore = {
      getSessionState: vi.fn(() => sessionState),
      setViewMode: vi.fn()
    }

    const openFileMock = vi.fn().mockResolvedValue(undefined)

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: () => ({
        openFile: openFileMock
      })
    }))

    vi.doMock('@/components/sidepanel/viewer/WorkspaceCodePane.vue', () => ({
      default: defineComponent({
        name: 'WorkspaceCodePane',
        props: {
          source: {
            type: Object,
            required: true
          }
        },
        template: '<div data-testid="code-pane">{{ source.type }}</div>'
      })
    }))

    vi.doMock('@/components/sidepanel/viewer/WorkspacePreviewPane.vue', () => ({
      default: defineComponent({
        name: 'WorkspacePreviewPane',
        props: {
          sessionId: {
            type: String,
            default: undefined
          },
          previewKind: {
            type: String,
            required: true
          }
        },
        template:
          '<div data-testid="preview-pane" :data-session-id="sessionId">{{ previewKind }}</div>'
      })
    }))

    vi.doMock('@/components/sidepanel/viewer/WorkspaceInfoPane.vue', () => ({
      default: defineComponent({
        name: 'WorkspaceInfoPane',
        template: '<div data-testid="info-pane">info</div>'
      })
    }))

    const WorkspaceViewer = (await import('@/components/sidepanel/WorkspaceViewer.vue')).default
    const wrapper = mount(WorkspaceViewer, {
      props: {
        sessionId: 'thread-1',
        artifact: {
          id: 'artifact-1',
          type: 'application/octet-stream',
          title: 'Raw artifact',
          content: 'fallback content',
          status: 'loaded'
        },
        filePreview: null,
        gitDiff: null,
        loadingFilePreview: false,
        loadingGitDiff: false,
        ...options?.props
      },
      global: {
        stubs: {
          Button: defineComponent({
            name: 'Button',
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
          })
        }
      }
    })

    return { wrapper, sidepanelStore, openFileMock }
  }

  it('shows raw artifact preview through preview pane fallback', async () => {
    const { wrapper } = await setup()

    expect(wrapper.get('[data-testid="workspace-viewer-body"]').classes()).toEqual(
      expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-hidden'])
    )
    expect(wrapper.get('[data-testid="preview-pane"]').classes()).toEqual(
      expect.arrayContaining(['h-full', 'min-h-0', 'w-full'])
    )
    expect(wrapper.get('[data-testid="preview-pane"]').text()).toContain('raw')
    expect(wrapper.text()).toContain('artifacts.preview')
    expect(wrapper.text()).toContain('artifacts.code')
  })

  it('renders code pane only for text files', async () => {
    const { wrapper } = await setup({
      sessionState: {
        selectedArtifactContext: null,
        selectedFilePath: 'C:/repo/src/app.ts',
        selectedDiffPath: null,
        viewMode: 'preview',
        sections: {
          files: true,
          git: false,
          artifacts: true
        }
      },
      props: {
        artifact: null,
        filePreview: {
          path: 'C:/repo/src/app.ts',
          relativePath: 'src/app.ts',
          name: 'app.ts',
          mimeType: 'application/typescript',
          kind: 'text',
          content: 'export const app = 1',
          language: 'ts',
          metadata: {
            fileName: 'app.ts',
            fileSize: 18,
            fileCreated: new Date('2024-01-01T00:00:00Z'),
            fileModified: new Date('2024-01-02T00:00:00Z')
          }
        }
      }
    })

    expect(wrapper.find('[data-testid="code-pane"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="code-pane"]').classes()).toEqual(
      expect.arrayContaining(['h-full', 'min-h-0', 'w-full'])
    )
    expect(wrapper.find('[data-testid="preview-pane"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('artifacts.preview')
    expect(wrapper.text()).not.toContain('artifacts.code')
  })

  it('shows preview and code tabs for markdown files', async () => {
    const { wrapper, sidepanelStore } = await setup({
      sessionState: {
        selectedArtifactContext: null,
        selectedFilePath: 'C:/repo/README.md',
        selectedDiffPath: null,
        viewMode: 'preview',
        sections: {
          files: true,
          git: false,
          artifacts: true
        }
      },
      props: {
        artifact: null,
        filePreview: {
          path: 'C:/repo/README.md',
          relativePath: 'README.md',
          name: 'README.md',
          mimeType: 'text/markdown',
          kind: 'markdown',
          content: '# Hello',
          language: 'markdown',
          metadata: {
            fileName: 'README.md',
            fileSize: 7,
            fileCreated: new Date('2024-01-01T00:00:00Z'),
            fileModified: new Date('2024-01-02T00:00:00Z')
          }
        }
      }
    })

    expect(wrapper.get('[data-testid="preview-pane"]').text()).toContain('markdown')
    expect(wrapper.get('[data-testid="preview-pane"]').attributes('data-session-id')).toBe(
      'thread-1'
    )

    const codeButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('artifacts.code'))
    expect(codeButton).toBeTruthy()

    await codeButton!.trigger('click')
    expect(sidepanelStore.setViewMode).toHaveBeenCalledWith('thread-1', 'code')
  })

  it('shows preview only for pdf files', async () => {
    const { wrapper } = await setup({
      sessionState: {
        selectedArtifactContext: null,
        selectedFilePath: 'C:/repo/manual.pdf',
        selectedDiffPath: null,
        viewMode: 'preview',
        sections: {
          files: true,
          git: false,
          artifacts: true
        }
      },
      props: {
        artifact: null,
        filePreview: {
          path: 'C:/repo/manual.pdf',
          relativePath: 'manual.pdf',
          name: 'manual.pdf',
          mimeType: 'application/pdf',
          kind: 'pdf',
          content: 'page one',
          previewUrl: 'workspace-preview://root-id/manual.pdf',
          metadata: {
            fileName: 'manual.pdf',
            fileSize: 1024,
            fileCreated: new Date('2024-01-01T00:00:00Z'),
            fileModified: new Date('2024-01-02T00:00:00Z')
          }
        }
      }
    })

    expect(wrapper.get('[data-testid="preview-pane"]').text()).toContain('pdf')
    expect(wrapper.find('[data-testid="code-pane"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('artifacts.preview')
    expect(wrapper.text()).not.toContain('artifacts.code')
  })

  it('shows preview and code tabs for svg files', async () => {
    const { wrapper, sidepanelStore } = await setup({
      sessionState: {
        selectedArtifactContext: null,
        selectedFilePath: 'C:/repo/diagram.svg',
        selectedDiffPath: null,
        viewMode: 'preview',
        sections: {
          files: true,
          git: false,
          artifacts: true
        }
      },
      props: {
        artifact: null,
        filePreview: {
          path: 'C:/repo/diagram.svg',
          relativePath: 'diagram.svg',
          name: 'diagram.svg',
          mimeType: 'image/svg+xml',
          kind: 'svg',
          content: '<svg></svg>',
          previewUrl: 'workspace-preview://root-id/diagram.svg',
          language: 'svg',
          metadata: {
            fileName: 'diagram.svg',
            fileSize: 256,
            fileCreated: new Date('2024-01-01T00:00:00Z'),
            fileModified: new Date('2024-01-02T00:00:00Z')
          }
        }
      }
    })

    expect(wrapper.get('[data-testid="preview-pane"]').text()).toContain('svg')

    const codeButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('artifacts.code'))
    expect(codeButton).toBeTruthy()

    await codeButton!.trigger('click')
    expect(sidepanelStore.setViewMode).toHaveBeenCalledWith('thread-1', 'code')
  })

  it('shows info pane for unsupported files', async () => {
    const { wrapper } = await setup({
      sessionState: {
        selectedArtifactContext: null,
        selectedFilePath: 'C:/repo/archive.zip',
        selectedDiffPath: null,
        viewMode: 'preview',
        sections: {
          files: true,
          git: false,
          artifacts: true
        }
      },
      props: {
        artifact: null,
        filePreview: {
          path: 'C:/repo/archive.zip',
          relativePath: 'archive.zip',
          name: 'archive.zip',
          mimeType: 'application/zip',
          kind: 'binary',
          content: '',
          metadata: {
            fileName: 'archive.zip',
            fileSize: 4096,
            fileCreated: new Date('2024-01-01T00:00:00Z'),
            fileModified: new Date('2024-01-02T00:00:00Z')
          }
        }
      }
    })

    expect(wrapper.find('[data-testid="info-pane"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="info-pane"]').classes()).toEqual(
      expect.arrayContaining(['h-full', 'min-h-0', 'w-full'])
    )
    expect(wrapper.find('[data-testid="preview-pane"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="code-pane"]').exists()).toBe(false)
  })
})
