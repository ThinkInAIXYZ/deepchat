import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentToolManager } from '@/presenter/toolPresenter/agentTools/agentToolManager'
import {
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME
} from '@/presenter/toolPresenter/agentTools/agentFffSearchHandler'

const fffMock = vi.hoisted(() => ({
  finder: {
    isDestroyed: false,
    destroy: vi.fn(),
    waitForScan: vi.fn(),
    fileSearch: vi.fn(),
    grep: vi.fn()
  },
  isAvailable: vi.fn(),
  create: vi.fn()
}))

vi.mock('@ff-labs/fff-node', () => ({
  FileFinder: {
    isAvailable: fffMock.isAvailable,
    create: fffMock.create
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/mock/app',
    getPath: () => '/tmp',
    isPackaged: false
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      getSize: () => ({ width: 0, height: 0 })
    }))
  }
}))

function buildRuntimePort() {
  return {
    resolveConversationWorkdir: vi.fn().mockResolvedValue(null),
    resolveConversationSessionInfo: vi.fn().mockResolvedValue(null),
    getSkillPresenter: () => ({
      getActiveSkills: vi.fn().mockResolvedValue([]),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
      listSkillScripts: vi.fn().mockResolvedValue([]),
      getSkillExtension: vi.fn().mockResolvedValue({
        version: 1,
        env: {},
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      })
    }),
    getYoBrowserToolHandler: () => ({
      getToolDefinitions: vi.fn().mockReturnValue([]),
      callTool: vi.fn()
    }),
    getFilePresenter: () => ({
      getMimeType: vi.fn().mockResolvedValue('text/plain'),
      prepareFileCompletely: vi.fn()
    }),
    getLlmProviderPresenter: () => ({
      executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
      generateCompletionStandalone: vi.fn(),
      generateImageStandalone: vi.fn()
    }),
    createSettingsWindow: vi.fn(),
    sendToWindow: vi.fn().mockReturnValue(true),
    getApprovedFilePaths: vi.fn().mockReturnValue([]),
    consumeSettingsApproval: vi.fn().mockReturnValue(false)
  } as any
}

describe('AgentToolManager FFF search tools', () => {
  beforeEach(() => {
    fffMock.finder.isDestroyed = false
    fffMock.finder.destroy.mockReset()
    fffMock.finder.waitForScan.mockReset().mockResolvedValue({ ok: true, value: true })
    fffMock.finder.fileSearch.mockReset().mockReturnValue({
      ok: true,
      value: {
        items: [
          {
            relativePath: 'src/main/example.ts',
            fileName: 'example.ts',
            size: 10,
            modified: 1,
            accessFrecencyScore: 0,
            modificationFrecencyScore: 0,
            totalFrecencyScore: 12,
            gitStatus: 'clean'
          }
        ],
        scores: [{ total: 123 }],
        totalMatched: 1,
        totalFiles: 1
      }
    })
    fffMock.finder.grep.mockReset().mockReturnValue({
      ok: true,
      value: {
        items: [
          {
            relativePath: 'src/main/example.ts',
            fileName: 'example.ts',
            gitStatus: 'clean',
            size: 10,
            modified: 1,
            isBinary: false,
            totalFrecencyScore: 1,
            accessFrecencyScore: 0,
            modificationFrecencyScore: 0,
            lineNumber: 3,
            col: 0,
            byteOffset: 1,
            lineContent: 'const needle = true',
            matchRanges: [[6, 12]],
            contextBefore: [],
            contextAfter: []
          }
        ],
        totalMatched: 1,
        totalFilesSearched: 1,
        totalFiles: 1,
        filteredFileCount: 1,
        nextCursor: null
      }
    })
    fffMock.isAvailable.mockReset().mockReturnValue(true)
    fffMock.create.mockReset().mockReturnValue({ ok: true, value: fffMock.finder })
  })

  it('exposes and executes glob through the agent filesystem path', async () => {
    const manager = new AgentToolManager({
      agentWorkspacePath: '/workspace',
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getModelConfig: vi.fn()
      } as any,
      runtimePort: buildRuntimePort()
    })

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace'
    })
    expect(defs.map((def) => def.function.name)).toEqual(
      expect.arrayContaining([GLOB_TOOL_NAME, GREP_TOOL_NAME])
    )

    const result = (await manager.callTool(GLOB_TOOL_NAME, {
      query: 'example',
      options: { maxResults: 5 }
    })) as { content: string; rawData?: { fffSearch?: { source: string } } }

    expect(JSON.parse(result.content)).toEqual([{ path: 'src/main/example.ts', score: 123 }])
    expect(result.rawData?.fffSearch?.source).toBe('fff')
  })

  it('executes grep through the agent filesystem path', async () => {
    const manager = new AgentToolManager({
      agentWorkspacePath: '/workspace',
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getModelConfig: vi.fn()
      } as any,
      runtimePort: buildRuntimePort()
    })

    const result = (await manager.callTool(GREP_TOOL_NAME, {
      query: 'needle',
      pathScope: ['src/main'],
      contextLines: 0,
      maxResults: 5
    })) as { content: string; rawData?: { fffSearch?: { source: string } } }

    expect(JSON.parse(result.content)).toEqual([
      {
        path: 'src/main/example.ts',
        lineNumber: 3,
        snippet: 'const needle = true',
        score: expect.any(Number)
      }
    ])
    expect(result.rawData?.fffSearch?.source).toBe('fff')
  })

  it('pre-checks read permission for grep path scopes', async () => {
    const manager = new AgentToolManager({
      agentWorkspacePath: '/workspace',
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getModelConfig: vi.fn()
      } as any,
      runtimePort: buildRuntimePort()
    })

    const permission = await manager.preCheckToolPermission(
      GREP_TOOL_NAME,
      {
        query: 'needle',
        pathScope: ['/outside/example.ts']
      },
      'conv1'
    )

    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'read',
        paths: ['/outside/example.ts']
      })
    )
  })
})
