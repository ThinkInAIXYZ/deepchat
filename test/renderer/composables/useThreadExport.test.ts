import { describe, it, expect, vi, beforeEach } from 'vitest'
const invoke = vi.hoisted(() => vi.fn())
const downloadBlob = vi.hoisted(() => vi.fn())

vi.mock('@/lib/download', () => ({
  downloadBlob
}))

describe('useThreadExport', () => {
  beforeEach(() => {
    downloadBlob.mockClear()
    invoke.mockClear()
    vi.resetModules()
    invoke.mockImplementation((channel: string, presenter: string, method: string) => {
      if (channel !== 'presenter:call' || presenter !== 'exporter') {
        return Promise.resolve(null)
      }
      if (method === 'exportConversation') {
        return Promise.resolve({ filename: 'thread.md', content: 'hello' })
      }
      if (method === 'submitToNowledgeMem') {
        return Promise.resolve({ success: true })
      }
      return Promise.resolve(null)
    })
    window.api = { getWebContentsId: () => 1 }
    window.electron = { ipcRenderer: { invoke } }
  })

  it('exports thread and triggers download', async () => {
    const { useThreadExport } = await import('@/composables/chat/useThreadExport')
    const api = useThreadExport()
    await api.exportThread('t-1', 'markdown')

    expect(invoke).toHaveBeenCalledWith(
      'presenter:call',
      'exporter',
      'exportConversation',
      't-1',
      'markdown'
    )
    expect(downloadBlob).toHaveBeenCalled()
  })

  it('submits to nowledge-mem without download', async () => {
    const { useThreadExport } = await import('@/composables/chat/useThreadExport')
    const api = useThreadExport()
    await api.exportThread('t-2', 'nowledge-mem')

    expect(invoke).toHaveBeenCalledWith('presenter:call', 'exporter', 'submitToNowledgeMem', 't-2')
    expect(downloadBlob).not.toHaveBeenCalled()
  })
})
