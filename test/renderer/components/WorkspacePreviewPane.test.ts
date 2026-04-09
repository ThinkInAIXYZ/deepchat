import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import WorkspacePreviewPane from '../../../src/renderer/src/components/sidepanel/viewer/WorkspacePreviewPane.vue'
import type { MarkdownLinkContext } from '@/components/markdown/linkTypes'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const createFilePreview = (overrides: Record<string, unknown> = {}) => ({
  path: 'C:/repo/docs/index.html',
  relativePath: 'docs/index.html',
  name: 'index.html',
  mimeType: 'text/html',
  kind: 'html',
  content: '<html></html>',
  previewUrl: 'workspace-preview://root-id/docs/index.html',
  thumbnail: '',
  language: 'html',
  metadata: {
    fileName: 'index.html',
    fileSize: 128,
    fileCreated: new Date('2024-01-01T00:00:00Z'),
    fileModified: new Date('2024-01-02T00:00:00Z')
  },
  ...overrides
})

describe('WorkspacePreviewPane', () => {
  it.each([
    ['html', 'workspace-preview://root-id/docs/index.html', 'allow-scripts allow-same-origin'],
    ['pdf', 'workspace-preview://root-id/docs/manual.pdf', undefined],
    ['svg', 'workspace-preview://root-id/docs/diagram.svg', 'allow-scripts allow-same-origin']
  ])('renders %s file previews inside a single iframe pane', (kind, previewUrl, sandbox) => {
    const wrapper = mount(WorkspacePreviewPane, {
      props: {
        sessionId: 'session-1',
        previewKind: kind,
        filePreview: createFilePreview({
          path: `C:/repo/docs/example.${kind}`,
          relativePath: `docs/example.${kind}`,
          name: `example.${kind}`,
          mimeType:
            kind === 'pdf' ? 'application/pdf' : kind === 'svg' ? 'image/svg+xml' : 'text/html',
          kind,
          previewUrl
        })
      },
      global: {
        stubs: {
          MarkdownRenderer: defineComponent({
            name: 'MarkdownRenderer',
            props: {
              linkContext: {
                type: Object as () => MarkdownLinkContext | undefined,
                default: undefined
              }
            },
            template: '<div />'
          }),
          HTMLArtifact: defineComponent({
            name: 'HTMLArtifact',
            template: '<div />'
          }),
          SvgArtifact: defineComponent({
            name: 'SvgArtifact',
            template: '<div />'
          }),
          MermaidArtifact: defineComponent({
            name: 'MermaidArtifact',
            template: '<div />'
          }),
          ReactArtifact: defineComponent({
            name: 'ReactArtifact',
            template: '<div />'
          })
        }
      }
    })

    expect(wrapper.get('[data-testid="workspace-preview-pane"]').classes()).toEqual(
      expect.arrayContaining(['flex', 'h-full', 'min-h-0', 'w-full', 'flex-col', 'overflow-hidden'])
    )
    const iframe = wrapper.get('iframe')
    expect(iframe.attributes('src')).toBe(previewUrl)
    expect(wrapper.get(`[data-testid="workspace-preview-${kind}"]`).classes()).toEqual(
      expect.arrayContaining(['flex-1', 'min-h-0', 'w-full'])
    )

    if (sandbox) {
      expect(iframe.attributes('sandbox')).toBe(sandbox)
    } else {
      expect(iframe.attributes('sandbox')).toBeUndefined()
    }
  })

  it('keeps markdown preview in the markdown pane instead of iframe', () => {
    const wrapper = mount(WorkspacePreviewPane, {
      props: {
        sessionId: 'session-1',
        previewKind: 'markdown',
        filePreview: createFilePreview({
          path: 'C:/repo/README.md',
          relativePath: 'README.md',
          name: 'README.md',
          mimeType: 'text/markdown',
          kind: 'markdown',
          content: '# Hello',
          previewUrl: undefined
        })
      },
      global: {
        stubs: {
          MarkdownRenderer: defineComponent({
            name: 'MarkdownRenderer',
            props: {
              content: {
                type: String,
                required: true
              },
              messageId: {
                type: String,
                default: undefined
              },
              threadId: {
                type: String,
                default: undefined
              },
              linkContext: {
                type: Object as () => MarkdownLinkContext | undefined,
                default: undefined
              }
            },
            template:
              '<div data-testid="markdown-renderer" :data-message-id="messageId" :data-thread-id="threadId" :data-link-source="linkContext?.source" :data-link-session-id="linkContext?.sessionId" :data-source-file-path="linkContext?.sourceFilePath">{{ content }}</div>'
          }),
          HTMLArtifact: true,
          SvgArtifact: true,
          MermaidArtifact: true,
          ReactArtifact: true
        }
      }
    })

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.get('[data-testid="workspace-preview-pane"]').classes()).toEqual(
      expect.arrayContaining(['flex', 'h-full', 'min-h-0', 'w-full', 'flex-col', 'overflow-hidden'])
    )
    expect(wrapper.get('[data-testid="workspace-preview-markdown"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="markdown-renderer"]').text()).toContain('# Hello')
    expect(wrapper.get('[data-testid="markdown-renderer"]').attributes('data-message-id')).toBe(
      'C:/repo/README.md'
    )
    expect(wrapper.get('[data-testid="markdown-renderer"]').attributes('data-thread-id')).toBe(
      'session-1'
    )
    expect(wrapper.get('[data-testid="markdown-renderer"]').attributes('data-link-source')).toBe(
      'workspace'
    )
    expect(
      wrapper.get('[data-testid="markdown-renderer"]').attributes('data-link-session-id')
    ).toBe('session-1')
    expect(
      wrapper.get('[data-testid="markdown-renderer"]').attributes('data-source-file-path')
    ).toBe('C:/repo/README.md')
  })

  it('keeps image preview in the image pane instead of iframe', () => {
    const wrapper = mount(WorkspacePreviewPane, {
      props: {
        sessionId: 'session-1',
        previewKind: 'image',
        filePreview: createFilePreview({
          path: 'C:/repo/assets/logo.png',
          relativePath: 'assets/logo.png',
          name: 'logo.png',
          mimeType: 'image/png',
          kind: 'image',
          content: 'imgcache://logo.png',
          previewUrl: undefined
        })
      },
      global: {
        stubs: {
          MarkdownRenderer: true,
          HTMLArtifact: true,
          SvgArtifact: true,
          MermaidArtifact: true,
          ReactArtifact: true
        }
      }
    })

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.get('[data-testid="workspace-preview-pane"]').classes()).toEqual(
      expect.arrayContaining(['flex', 'h-full', 'min-h-0', 'w-full', 'flex-col', 'overflow-hidden'])
    )
    expect(wrapper.get('[data-testid="workspace-preview-image"] img').attributes('src')).toBe(
      'imgcache://logo.png'
    )
  })

  it('passes full-height classes to HTML artifact previews', () => {
    const wrapper = mount(WorkspacePreviewPane, {
      props: {
        sessionId: 'session-1',
        previewKind: 'html',
        artifact: {
          id: 'artifact-1',
          type: 'text/html',
          title: 'Preview',
          content: '<html><body>Hello</body></html>',
          status: 'loaded'
        }
      },
      global: {
        stubs: {
          MarkdownRenderer: true,
          HTMLArtifact: defineComponent({
            name: 'HTMLArtifact',
            props: {
              block: {
                type: Object,
                required: true
              },
              isPreview: {
                type: Boolean,
                required: true
              },
              viewportSize: {
                type: String,
                default: undefined
              }
            },
            template: '<div data-testid="html-artifact-stub" />'
          }),
          SvgArtifact: true,
          MermaidArtifact: true,
          ReactArtifact: true
        }
      }
    })

    expect(wrapper.get('[data-testid="workspace-preview-html-artifact"]').classes()).toEqual(
      expect.arrayContaining(['flex-1', 'min-h-0', 'w-full', 'overflow-hidden'])
    )
    expect(wrapper.get('[data-testid="html-artifact-stub"]').classes()).toEqual(
      expect.arrayContaining(['h-full', 'min-h-0', 'w-full'])
    )
  })
})
