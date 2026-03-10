import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

describe('WorkspaceViewer', () => {
  const setup = async () => {
    vi.resetModules()

    const sidepanelStore = {
      getSessionState: vi.fn(() => ({
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
      })),
      setViewMode: vi.fn()
    }

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
        openFile: vi.fn().mockResolvedValue(undefined)
      })
    }))

    vi.doMock('@/composables/useArtifactCodeEditor', () => ({
      useArtifactCodeEditor: vi.fn()
    }))

    vi.doMock('@/components/artifacts/CodeArtifact.vue', () => ({
      default: defineComponent({
        name: 'CodeArtifact',
        template: '<div />'
      })
    }))
    vi.doMock('@/components/artifacts/MarkdownArtifact.vue', () => ({
      default: defineComponent({
        name: 'MarkdownArtifact',
        template: '<div />'
      })
    }))
    vi.doMock('@/components/artifacts/HTMLArtifact.vue', () => ({
      default: defineComponent({
        name: 'HTMLArtifact',
        template: '<div />'
      })
    }))
    vi.doMock('@/components/artifacts/SvgArtifact.vue', () => ({
      default: defineComponent({
        name: 'SvgArtifact',
        template: '<div />'
      })
    }))
    vi.doMock('@/components/artifacts/MermaidArtifact.vue', () => ({
      default: defineComponent({
        name: 'MermaidArtifact',
        template: '<div />'
      })
    }))
    vi.doMock('@/components/artifacts/ReactArtifact.vue', () => ({
      default: defineComponent({
        name: 'ReactArtifact',
        template: '<div />'
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
        loadingGitDiff: false
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

    return { wrapper }
  }

  it('shows raw artifact content when no preview component is available', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('pre').exists()).toBe(true)
    expect(wrapper.find('pre').text()).toContain('fallback content')
  })
})
