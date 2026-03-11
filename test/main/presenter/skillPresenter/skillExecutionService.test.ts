import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ISkillPresenter } from '../../../../src/shared/types/skill'
import { SkillExecutionService } from '../../../../src/main/presenter/skillPresenter/skillExecutionService'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/mock/app',
    getPath: () => '/mock/userData'
  }
}))

vi.mock('../../../../src/main/presenter/agentPresenter/acp/shellEnvHelper', () => ({
  getShellEnvironment: vi.fn().mockResolvedValue({ PATH: '/shell/bin' }),
  getUserShell: vi.fn().mockReturnValue({ shell: '/bin/zsh', args: ['-c'] })
}))

describe('SkillExecutionService', () => {
  let skillPresenter: ISkillPresenter
  let service: SkillExecutionService
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    skillPresenter = {
      getActiveSkills: vi.fn().mockResolvedValue(['ocr']),
      getMetadataList: vi.fn().mockResolvedValue([
        {
          name: 'ocr',
          description: 'OCR helper',
          path: '/skills/ocr/SKILL.md',
          skillRoot: '/skills/ocr'
        }
      ]),
      readSkillFile: vi.fn().mockResolvedValue('---\nname: ocr\ndescription: OCR helper\n---\n'),
      getSkillExtension: vi.fn().mockResolvedValue({
        version: 1,
        env: { API_KEY: 'secret' },
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      }),
      listSkillScripts: vi.fn().mockResolvedValue([
        {
          name: 'run.py',
          relativePath: 'scripts/run.py',
          absolutePath: '/skills/ocr/scripts/run.py',
          runtime: 'python',
          enabled: true
        }
      ])
    } as unknown as ISkillPresenter

    service = new SkillExecutionService(skillPresenter, {} as never)
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('builds spawn plan with skill root cwd and merged env', async () => {
    vi.spyOn(service as never, 'resolveRuntimeCommand' as never).mockResolvedValue({
      command: 'uv',
      mode: 'uv'
    })

    const plan = await (service as never).buildSpawnPlan(
      {
        skill: 'ocr',
        script: 'scripts/run.py',
        args: ['--lang', 'en']
      },
      'conv-1'
    )

    expect(plan.cwd).toBe('/skills/ocr')
    expect(plan.env.PATH).toBe('/shell/bin')
    expect(plan.env.API_KEY).toBe('secret')
    expect(plan.args).toEqual(['run', '/skills/ocr/scripts/run.py', '--lang', 'en'])
  })

  it('falls back to bundled uv for python auto runtime', async () => {
    vi.spyOn(service as never, 'hasCommand' as never).mockResolvedValue(false)
    vi.spyOn(service as never, 'getBundledRuntimeCommand' as never).mockImplementation(
      (command: 'uv' | 'node') => (command === 'uv' ? '/runtime/uv' : null)
    )

    const runtime = await (service as never).resolvePythonRuntime(
      'auto',
      { PATH: '/bin' },
      '/skill'
    )

    expect(runtime).toEqual({
      command: '/runtime/uv',
      mode: 'uv'
    })
  })

  it('rejects scripts that are not declared under scripts directory', async () => {
    await expect(
      service.execute(
        {
          skill: 'ocr',
          script: '../hack.py'
        },
        { conversationId: 'conv-1' }
      )
    ).rejects.toThrow(/not found/)
  })

  it('escapes percent signs for Windows shell quoting', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    expect((service as never).quoteForShell('value%"PATH"%')).toBe('"value%%\\"PATH\\"%%"')
  })
})
