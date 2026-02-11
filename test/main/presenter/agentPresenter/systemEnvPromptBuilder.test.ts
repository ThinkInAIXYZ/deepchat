import path from 'node:path'
import * as fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { presenter } from '@/presenter'
import {
  buildRuntimeCapabilitiesPrompt,
  buildSystemEnvPrompt
} from '@/presenter/agentPresenter/message/systemEnvPromptBuilder'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      ...actual.promises,
      readFile: vi.fn()
    }
  }
})

vi.mock('@/presenter', () => ({
  presenter: {
    configPresenter: {
      getProviderModels: vi.fn(),
      getCustomModels: vi.fn()
    }
  }
}))

describe('systemEnvPromptBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(presenter.configPresenter.getProviderModels as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(presenter.configPresenter.getCustomModels as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(fs.promises.readFile as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ENOENT')
    )
  })

  it('builds env prompt with git=yes and AGENTS instructions', async () => {
    const workdir = path.resolve(path.sep, 'workspace', 'deepchat')
    const gitPath = path.join(workdir, '.git')
    const agentsPath = path.join(workdir, 'AGENTS.md')

    ;(fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (targetPath: string) => targetPath === gitPath
    )
    ;(fs.promises.readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      '# Repository Guidelines\nLine 2'
    )
    ;(presenter.configPresenter.getProviderModels as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'model-a', name: 'Model A' }
    ])

    const prompt = await buildSystemEnvPrompt({
      providerId: 'provider-x',
      modelId: 'model-a',
      workdir,
      platform: 'win32',
      now: new Date('2026-02-11T12:00:00.000Z')
    })

    expect(prompt).toContain('You are powered by the model named Model A.')
    expect(prompt).toContain('The exact model ID is provider-x/model-a')
    expect(prompt).toContain(`Working directory: ${workdir}`)
    expect(prompt).toContain('Is directory a git repo: yes')
    expect(prompt).toContain('Platform: win32')
    expect(prompt).toContain("Today's date: Wed Feb 11 2026")
    expect(prompt).toContain(`Instructions from: ${agentsPath}`)
    expect(prompt).toContain('# Repository Guidelines\nLine 2')
  })

  it('falls back when AGENTS.md is missing and git=no', async () => {
    const workdir = path.resolve(path.sep, 'workspace', 'deepchat')
    const prompt = await buildSystemEnvPrompt({
      providerId: 'provider-y',
      modelId: 'model-b',
      workdir,
      platform: 'linux',
      now: new Date('2026-02-11T12:00:00.000Z')
    })

    expect(prompt).toContain('You are powered by the model named model-b.')
    expect(prompt).toContain('The exact model ID is provider-y/model-b')
    expect(prompt).toContain('Is directory a git repo: no')
    expect(prompt).toContain('[SystemEnvPromptBuilder] AGENTS.md not found or unreadable:')
  })

  it('builds stable runtime capabilities prompt', () => {
    const prompt = buildRuntimeCapabilitiesPrompt()
    expect(prompt).toContain('## Runtime Capabilities')
    expect(prompt).toContain('YoBrowser')
    expect(prompt).toContain('process(list|poll|log|write|kill|remove)')
  })

  it('falls back to unknown provider/model identity', async () => {
    const workdir = path.resolve(path.sep, 'workspace', 'deepchat')
    const prompt = await buildSystemEnvPrompt({
      providerId: '  ',
      modelId: '',
      workdir,
      now: new Date('2026-02-11T12:00:00.000Z')
    })

    expect(prompt).toContain('You are powered by the model named unknown-model.')
    expect(prompt).toContain('The exact model ID is unknown-provider/unknown-model')
  })
})
