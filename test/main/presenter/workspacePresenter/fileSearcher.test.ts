import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchFiles } from '@/presenter/workspacePresenter/fileSearcher'

const fffMock = vi.hoisted(() => ({
  globFiles: vi.fn()
}))

vi.mock('@/lib/agentRuntime/fffSearchService', () => ({
  FffSearchService: vi.fn(() => ({
    globFiles: fffMock.globFiles
  }))
}))

describe('workspace fileSearcher', () => {
  beforeEach(() => {
    fffMock.globFiles.mockReset()
  })

  it('uses FFF glob search and filters default excluded folders', async () => {
    fffMock.globFiles.mockResolvedValue([
      { path: 'src/needle.ts', score: 10 },
      { path: 'node_modules/pkg/needle.ts', score: 9 },
      { path: 'dist/needle.js', score: 8 }
    ])

    const result = await searchFiles('/workspace', '*needle*', {
      maxResults: 10,
      sortBy: 'name'
    })

    expect(fffMock.globFiles).toHaveBeenCalledWith('**/*needle*', {
      workspaceRoot: '/workspace',
      maxResults: 500,
      pageIndex: 0
    })
    expect(result.files).toEqual([path.normalize('/workspace/src/needle.ts')])
    expect(result.hasMore).toBe(false)
  })

  it('continues FFF glob pagination when excluded files fill the first page', async () => {
    fffMock.globFiles
      .mockResolvedValueOnce(
        Array.from({ length: 500 }, (_, index) => ({
          path: `node_modules/pkg/file-${index}.ts`,
          score: 10
        }))
      )
      .mockResolvedValueOnce([{ path: 'src/needle.ts', score: 9 }])

    const result = await searchFiles('/workspace-excluded-page', '*needle*', {
      maxResults: 10,
      sortBy: 'name'
    })

    expect(fffMock.globFiles).toHaveBeenNthCalledWith(1, '**/*needle*', {
      workspaceRoot: '/workspace-excluded-page',
      maxResults: 500,
      pageIndex: 0
    })
    expect(fffMock.globFiles).toHaveBeenNthCalledWith(2, '**/*needle*', {
      workspaceRoot: '/workspace-excluded-page',
      maxResults: 500,
      pageIndex: 1
    })
    expect(result.files).toEqual([path.normalize('/workspace-excluded-page/src/needle.ts')])
    expect(result.hasMore).toBe(false)
  })

  it('does not skip the tail of a fetched FFF page when later cursors need it', async () => {
    fffMock.globFiles.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) => ({
        path: `src/file-${String(index).padStart(3, '0')}.ts`,
        score: 10
      }))
    )

    await searchFiles('/workspace-page-tail', '*file*', {
      maxResults: 10,
      sortBy: 'name'
    })
    const result = await searchFiles('/workspace-page-tail', '*file*', {
      maxResults: 10,
      cursor: Buffer.from('200').toString('base64'),
      sortBy: 'name'
    })

    expect(fffMock.globFiles).toHaveBeenCalledTimes(1)
    expect(result.files[0]).toBe(path.normalize('/workspace-page-tail/src/file-200.ts'))
  })
})
