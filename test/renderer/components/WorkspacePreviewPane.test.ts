import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import WorkspacePreviewPane from '../../../src/renderer/src/components/sidepanel/viewer/WorkspacePreviewPane.vue'

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

    const iframe = wrapper.get('iframe')
    expect(iframe.attributes('src')).toBe(previewUrl)
    expect(wrapper.get(`[data-testid="workspace-preview-${kind}"]`).exists()).toBe(true)

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
              }
            },
            template:
              '<div data-testid="markdown-renderer" :data-message-id="messageId" :data-thread-id="threadId">{{ content }}</div>'
          }),
          HTMLArtifact: true,
          SvgArtifact: true,
          MermaidArtifact: true,
          ReactArtifact: true
        }
      }
    })

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.get('[data-testid="workspace-preview-markdown"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="markdown-renderer"]').text()).toContain('# Hello')
    expect(wrapper.get('[data-testid="markdown-renderer"]').attributes('data-message-id')).toBe(
      'C:/repo/README.md'
    )
    expect(wrapper.get('[data-testid="markdown-renderer"]').attributes('data-thread-id')).toBe(
      'session-1'
    )
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
    expect(wrapper.get('[data-testid="workspace-preview-image"] img').attributes('src')).toBe(
      'imgcache://logo.png'
    )
  })
})
