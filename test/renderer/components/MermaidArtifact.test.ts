import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import MermaidArtifact from '@/components/artifacts/MermaidArtifact.vue'

// Mock mermaid library
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined)
  }
}))

describe('MermaidArtifact', () => {
  describe('sanitizeMermaidContent', () => {
    // Import the function from the component
    // Since it's defined inside the component, we'll test the behavior indirectly
    // by testing the renderDiagram function behavior

    it('should render normal mermaid content', async () => {
      const wrapper = mount(MermaidArtifact, {
        props: {
          block: {
            content: 'graph TD\nA-->B',
            artifact: { type: 'application/vnd.ant.mermaid', title: 'Test Diagram' }
          },
          isPreview: true
        },
        attachTo: document.body
      })

      // Wait for component to mount and initialize
      await new Promise((resolve) => setTimeout(resolve, 100))

      const mermaidRef = wrapper.find({ ref: 'mermaidRef' })
      expect(mermaidRef.exists()).toBe(true)

      // The content should be sanitized and set to innerHTML
      // Since we can't directly access the sanitizeMermaidContent function,
      // we verify that the content is set and doesn't contain dangerous tags
      expect(mermaidRef.element.textContent).toBe('graph TD\nA-->B')
    })

    it('should filter dangerous img tag with onerror', async () => {
      const maliciousContent = 'graph TD\nA["<img src=x onerror=alert(1)>"]'

      const wrapper = mount(MermaidArtifact, {
        props: {
          block: {
            content: maliciousContent,
            artifact: { type: 'application/vnd.ant.mermaid', title: 'Malicious Diagram' }
          },
          isPreview: true
        },
        attachTo: document.body
      })

      // Wait for component to mount and initialize
      await new Promise((resolve) => setTimeout(resolve, 100))

      const mermaidRef = wrapper.find({ ref: 'mermaidRef' })
      expect(mermaidRef.exists()).toBe(true)

      // The img tag should be removed
      const content = mermaidRef.element.textContent ?? ''
      expect(content).not.toContain('<img')
      expect(content).not.toContain('onerror')
      // But the basic mermaid structure should remain
      expect(content).toContain('graph TD')
      expect(content).toContain('A[')
    })

    it('should filter script tags', async () => {
      const maliciousContent = 'graph TD\nA<script>alert(1)</script>'

      const wrapper = mount(MermaidArtifact, {
        props: {
          block: {
            content: maliciousContent,
            artifact: { type: 'application/vnd.ant.mermaid', title: 'Malicious Diagram' }
          },
          isPreview: true
        },
        attachTo: document.body
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const mermaidRef = wrapper.find({ ref: 'mermaidRef' })
      const content = mermaidRef.element.textContent ?? ''
      expect(content).not.toContain('<script>')
      expect(content).not.toContain('alert(1)')
      expect(content).toContain('graph TD')
    })

    it('should filter event handlers', async () => {
      const maliciousContent = 'graph TD\nA["<div onclick=alert(1)>Click me</div>"]'

      const wrapper = mount(MermaidArtifact, {
        props: {
          block: {
            content: maliciousContent,
            artifact: { type: 'application/vnd.ant.mermaid', title: 'Malicious Diagram' }
          },
          isPreview: true
        },
        attachTo: document.body
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const mermaidRef = wrapper.find({ ref: 'mermaidRef' })
      const content = mermaidRef.element.textContent ?? ''
      expect(content).not.toContain('onclick')
      expect(content).not.toContain('alert(1)')
    })

    it('should filter dangerous protocols', async () => {
      const maliciousContent = 'graph TD\nA["javascript:alert(1)"]'

      const wrapper = mount(MermaidArtifact, {
        props: {
          block: {
            content: maliciousContent,
            artifact: { type: 'application/vnd.ant.mermaid', title: 'Malicious Diagram' }
          },
          isPreview: true
        },
        attachTo: document.body
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const mermaidRef = wrapper.find({ ref: 'mermaidRef' })
      const content = mermaidRef.element.textContent ?? ''
      expect(content).not.toContain('javascript:')
      expect(content).toContain('graph TD')
    })

    it('should handle the exact PoC from the vulnerability report', async () => {
      const pocContent =
        'graph TD\nA["<img src=x onerror=\'(async()=>{ const ipc=window.electron.ipcRenderer; await ipc.invoke(`presenter:call`, `mcpPresenter`, `addMcpServer`, `test`, {command:`calc.exe`,args:[],type:`stdio`,enabled:true,name:`test`}); await ipc.invoke(`presenter:call`, `mcpPresenter`, `startServer`, `test`);})()\'/>"]'

      const wrapper = mount(MermaidArtifact, {
        props: {
          block: {
            content: pocContent,
            artifact: { type: 'application/vnd.ant.mermaid', title: 'PoC Diagram' }
          },
          isPreview: true
        },
        attachTo: document.body
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const mermaidRef = wrapper.find({ ref: 'mermaidRef' })
      // The img tag should be completely removed
      const content = mermaidRef.element.textContent ?? ''
      expect(content).not.toContain('<img')
      expect(content).not.toContain('onerror')
      expect(content).not.toContain('ipc.invoke')
      expect(content).not.toContain('calc.exe')
      // But the basic mermaid structure should remain
      expect(content).toContain('graph TD')
      expect(content).toContain('A[')
    })
  })

  it('does not render preview when isPreview is false', () => {
    const wrapper = mount(MermaidArtifact, {
      props: {
        block: {
          content: 'graph TD\nA-->B',
          artifact: { type: 'application/vnd.ant.mermaid', title: 'Test Diagram' }
        },
        isPreview: false
      }
    })

    // Should show code block instead of mermaid preview
    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)
    expect(pre.text()).toContain('graph TD')
    expect(pre.text()).toContain('A-->B')
  })
})
