import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { AgentToolManager } from '@/presenter/agentPresenter/acp/agentToolManager'
import { presenter } from '@/presenter'

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('fs')
  return {
    __esModule: true,
    ...actual,
    default: actual
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir()
  },
  nativeImage: {
    createFromPath: () => ({
      getSize: () => ({ width: 128, height: 96 })
    })
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {
    filePresenter: {
      getMimeType: vi.fn(),
      prepareFileCompletely: vi.fn()
    },
    llmproviderPresenter: {
      generateCompletionStandalone: vi.fn()
    },
    skillPresenter: {
      getActiveSkills: vi.fn().mockResolvedValue([]),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
      listSkillScripts: vi.fn().mockResolvedValue([]),
      getSkillExtension: vi.fn().mockResolvedValue({
        version: 1,
        env: {},
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      })
    },
    newAgentPresenter: {
      getSession: vi.fn().mockResolvedValue(null)
    },
    sessionManager: {
      getSession: vi.fn().mockResolvedValue(null)
    },
    yoBrowserPresenter: {
      toolHandler: {
        getToolDefinitions: vi.fn().mockReturnValue([])
      }
    },
    sessionPresenter: {},
    windowPresenter: {},
    filePermissionService: {
      getApprovedPaths: vi.fn().mockReturnValue([])
    }
  }
}))

describe('AgentToolManager read routing', () => {
  let workspaceDir: string
  let configPresenter: any
  let manager: AgentToolManager

  beforeEach(async () => {
    vi.clearAllMocks()
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-read-'))
    configPresenter = {
      getSkillsEnabled: () => false,
      getSkillsPath: () => workspaceDir,
      getDefaultVisionModel: vi.fn().mockReturnValue(undefined),
      getModelConfig: vi.fn().mockReturnValue({ temperature: 0.2, maxTokens: 1200 })
    }
    manager = new AgentToolManager({
      agentWorkspacePath: workspaceDir,
      configPresenter
    })
  })

  it('uses raw read for text/code files', async () => {
    const filePath = path.join(workspaceDir, 'note.txt')
    await fs.writeFile(filePath, 'hello text', 'utf-8')
    ;(presenter.filePresenter.getMimeType as any).mockResolvedValue('text/plain')

    const result = (await manager.callTool('read', { path: 'note.txt' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('note.txt')
    expect(result.content).toContain('hello text')
    expect(presenter.filePresenter.prepareFileCompletely).not.toHaveBeenCalled()
  })

  it('uses filePresenter llm-friendly content for document files with offset/limit', async () => {
    const filePath = path.join(workspaceDir, 'report.pdf')
    await fs.writeFile(filePath, 'pdf-binary', 'utf-8')
    ;(presenter.filePresenter.getMimeType as any).mockResolvedValue('application/pdf')
    ;(presenter.filePresenter.prepareFileCompletely as any).mockResolvedValue({
      content: 'ABCDEFGH'
    })

    const result = (await manager.callTool(
      'read',
      { path: 'report.pdf', offset: 2, limit: 3 },
      'conv1'
    )) as {
      content: string
    }

    expect(result.content).toContain('chars 2-5')
    expect(result.content).toContain('CDE')
    expect(presenter.filePresenter.prepareFileCompletely).toHaveBeenCalled()
  })

  it('uses vision model for image files when defaultVisionModel is configured', async () => {
    const filePath = path.join(workspaceDir, 'image.png')
    await fs.writeFile(filePath, Buffer.from([0, 1, 2, 3]))
    ;(presenter.filePresenter.getMimeType as any).mockResolvedValue('image/png')
    configPresenter.getDefaultVisionModel.mockReturnValue({
      providerId: 'openai',
      modelId: 'gpt-4o'
    })
    ;(presenter.llmproviderPresenter.generateCompletionStandalone as any).mockResolvedValue(
      'OCR:\nhello\n\nSummary:\na simple image'
    )

    const result = (await manager.callTool('read', { path: 'image.png' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('OCR:')
    expect(result.content).toContain('Summary:')
    expect(presenter.llmproviderPresenter.generateCompletionStandalone).toHaveBeenCalled()
  })

  it('falls back to image metadata when no default vision model configured', async () => {
    const filePath = path.join(workspaceDir, 'image-no-vision.png')
    await fs.writeFile(filePath, Buffer.from([9, 8, 7, 6]))
    ;(presenter.filePresenter.getMimeType as any).mockResolvedValue('image/png')
    configPresenter.getDefaultVisionModel.mockReturnValue(undefined)

    const result = (await manager.callTool('read', { path: 'image-no-vision.png' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('[Image Metadata]')
    expect(result.content).toContain('No defaultVisionModel configured')
  })

  it('rejects non-text binary reads without polluting prompt context', async () => {
    const filePath = path.join(workspaceDir, 'archive.zip')
    await fs.writeFile(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    ;(presenter.filePresenter.getMimeType as any).mockResolvedValue('application/zip')

    const result = (await manager.callTool('read', { path: 'archive.zip' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('Cannot read "archive.zip" as plain text')
    expect(result.content).toContain('conversion/extraction tool or skill script')
    expect(presenter.filePresenter.prepareFileCompletely).not.toHaveBeenCalled()
  })
})
