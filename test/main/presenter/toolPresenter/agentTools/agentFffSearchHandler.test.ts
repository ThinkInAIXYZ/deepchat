import { describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  AgentFffSearchHandler,
  GLOB_TOOL_NAME
} from '@/presenter/toolPresenter/agentTools/agentFffSearchHandler'
import { FffSearchUnavailableError } from '@/lib/agentRuntime/fffSearchService'

vi.mock('@shared/logger', () => ({
  default: {
    warn: vi.fn()
  }
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    __esModule: true,
    ...actual,
    default: actual
  }
})

describe('AgentFffSearchHandler', () => {
  it('returns structured JSON and FFF metadata for glob', async () => {
    const service = {
      findFiles: vi.fn().mockResolvedValue([{ path: 'src/main/example.ts', score: 10 }])
    }
    const handler = new AgentFffSearchHandler({
      workspaceRoot: '/workspace',
      allowedDirectories: ['/workspace'],
      service: service as any
    })

    const result = await handler.glob({ query: 'example' })

    expect(JSON.parse(result.content)).toEqual([{ path: 'src/main/example.ts', score: 10 }])
    expect(result.metadata.source).toBe('fff')
  })

  it('raises the FFF unavailable error without shell fallback', async () => {
    const service = {
      findFiles: vi.fn().mockRejectedValue(new FffSearchUnavailableError('native unavailable'))
    }
    const handler = new AgentFffSearchHandler({
      workspaceRoot: '/workspace',
      allowedDirectories: ['/workspace'],
      service: service as any
    })

    await expect(handler.glob({ query: 'fallback' })).rejects.toThrow('native unavailable')
  })

  it('rejects path scopes outside the workspace before search execution', async () => {
    const service = {
      grep: vi.fn()
    }
    const handler = new AgentFffSearchHandler({
      workspaceRoot: '/workspace',
      allowedDirectories: ['/workspace'],
      service: service as any
    })

    await expect(
      handler.grep({
        query: 'secret',
        pathScope: ['/outside/secret.ts']
      })
    ).rejects.toThrow('Access denied')
    expect(service.grep).not.toHaveBeenCalled()
  })

  it('normalizes extensionless file scopes exactly and directory scopes with a slash', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fff-handler-scope-'))
    await fs.writeFile(path.join(workspaceRoot, 'Dockerfile'), 'FROM scratch', 'utf-8')
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    const service = {
      grep: vi.fn().mockResolvedValue([])
    }
    const handler = new AgentFffSearchHandler({
      workspaceRoot,
      allowedDirectories: [workspaceRoot],
      service: service as any
    })

    try {
      await handler.grep({
        query: 'FROM',
        pathScope: ['Dockerfile']
      })
      await handler.grep({
        query: 'needle',
        pathScope: ['src']
      })
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true })
    }

    expect(service.grep).toHaveBeenNthCalledWith(
      1,
      'FROM',
      expect.objectContaining({
        pathScope: ['Dockerfile']
      })
    )
    expect(service.grep).toHaveBeenNthCalledWith(
      2,
      'needle',
      expect.objectContaining({
        pathScope: ['src/']
      })
    )
  })

  it('validates arguments before invoking search', async () => {
    const handler = new AgentFffSearchHandler({
      workspaceRoot: '/workspace',
      allowedDirectories: ['/workspace'],
      service: {} as any
    })

    await expect(handler.glob({})).rejects.toThrow(`Invalid arguments for ${GLOB_TOOL_NAME}`)
  })
})
