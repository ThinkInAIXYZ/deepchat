import { access, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  skillsInstallPublicUrlRoute,
  skillsInstallUploadRoute,
  skillsListPublicRoute,
  skillsSetPublicStatusRoute,
  skillsUninstallPublicRoute
} from '@shared/contracts/routes'
import type { SkillServicePort } from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import { CliSkillService, retainUploadFile } from '@/cli/skillService'
import type { CliRouteCaller, RouteContext } from '@/routes/routeRegistry'

const caller: CliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'connection-1',
  scopes: ['skills:read', 'skills:write']
}

function skill(overrides: Partial<UnifiedSkillItem> = {}): UnifiedSkillItem {
  return {
    agentId: 'deepchat',
    name: 'safe-skill',
    description: 'Safe\n\u001b[31m description',
    path: '/Users/private/.deepchat/skills/safe-skill/SKILL.md',
    skillRoot: '/Users/private/.deepchat/skills/safe-skill',
    category: 'development',
    platforms: ['linux', 'linux', '\u001b[2JmacOS'],
    metadata: { token: 'metadata-secret' },
    allowedTools: ['read', 'bash'],
    ownerPluginId: 'private-plugin-id',
    canonicalPath: '/Users/private/.deepchat/skills/safe-skill',
    sourceType: 'zip-install',
    disabled: false,
    deepchatDisabled: false,
    agentLinks: {
      codex: {
        path: '/Users/private/.codex/skills/safe-skill',
        state: 'linked',
        createdByDeepChat: true
      }
    },
    mutable: false,
    ...overrides
  }
}

function createHarness(catalog: UnifiedSkillItem[] = [skill()]) {
  const getUnifiedSkillCatalog = vi.fn(async () => catalog)
  const installFromUrlForAgent = vi.fn(async () => ({
    success: true,
    skillName: 'installed-skill',
    targetPath: '/private/install/path'
  }))
  const installFromZipForAgent = vi.fn(async () => ({
    success: true,
    skillName: 'uploaded-skill',
    targetPath: '/private/upload/path'
  }))
  const setSkillDisabledForAgent = vi.fn(async () => undefined)
  const uninstallSkillForAgent = vi.fn(async () => ({
    success: true,
    skillName: 'safe-skill'
  }))
  const recordSettingsActivity = vi.fn()
  const service = new CliSkillService({
    skills: {
      getUnifiedSkillCatalog,
      installFromUrlForAgent,
      installFromZipForAgent,
      setSkillDisabledForAgent,
      uninstallSkillForAgent
    } as Pick<
      SkillServicePort,
      | 'getUnifiedSkillCatalog'
      | 'installFromUrlForAgent'
      | 'installFromZipForAgent'
      | 'setSkillDisabledForAgent'
      | 'uninstallSkillForAgent'
    >,
    agentExists: async (agentId) => agentId === 'agent-1',
    recordSettingsActivity,
    log: { warn: vi.fn() }
  })
  const routes = service.createRoutes()
  const invoke = async (method: string, input: unknown, context: RouteContext = { caller }) => {
    const route = routes.get(method as never)
    if (!route) throw new Error(`Missing route: ${method}`)
    return await route(input, context)
  }
  return {
    service,
    getUnifiedSkillCatalog,
    installFromUrlForAgent,
    installFromZipForAgent,
    setSkillDisabledForAgent,
    uninstallSkillForAgent,
    recordSettingsActivity,
    invoke
  }
}

describe('CLI Skill service', () => {
  it('retains uploads on filesystems without hardlink support', async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'deepchat-cli-skill-retain-'))
    const uploadPath = path.join(tempDirectory, 'body-upload.tmp')
    await writeFile(uploadPath, 'archive-bytes')

    try {
      const retained = await retainUploadFile(uploadPath, async () => {
        throw Object.assign(new Error('hardlinks are unavailable'), { code: 'EPERM' })
      })
      expect(retained.path).not.toBe(uploadPath)
      await expect(readFile(retained.path, 'utf8')).resolves.toBe('archive-bytes')
    } finally {
      await rm(tempDirectory, { recursive: true, force: true })
    }
  })

  it('accepts signed HTTPS URLs but rejects credentials, fragments, and unsafe filenames', () => {
    expect(
      skillsInstallPublicUrlRoute.input.safeParse({
        url: 'https://skills.example/archive.zip?signature=private'
      }).success
    ).toBe(true)
    for (const url of [
      'http://skills.example/archive.zip',
      'https://user:secret@skills.example/archive.zip',
      'https://skills.example/archive.zip#fragment'
    ]) {
      expect(skillsInstallPublicUrlRoute.input.safeParse({ url }).success).toBe(false)
    }
    expect(
      skillsInstallUploadRoute.input.safeParse({ filename: 'unsafe\u001b[31m.zip' }).success
    ).toBe(false)
  })

  it('returns bounded public metadata without filesystem or plugin internals', async () => {
    const harness = createHarness()

    const result = await harness.invoke(skillsListPublicRoute.name, {})

    expect(result).toEqual({
      skills: [
        {
          agentId: 'deepchat',
          name: 'safe-skill',
          description: 'Safe [31m description',
          category: 'development',
          platforms: ['[2JmacOS', 'linux'],
          allowedTools: ['bash', 'read'],
          sourceType: 'zip-install',
          enabled: true,
          mutable: false,
          managedBy: 'plugin',
          metadataTruncated: false
        }
      ],
      truncated: false
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('/Users/private')
    expect(serialized).not.toContain('private-plugin-id')
    expect(serialized).not.toContain('metadata-secret')
  })

  it('byte-bounds untrusted metadata and reports truncation', async () => {
    const harness = createHarness([
      skill({
        description: '界'.repeat(1_000),
        allowedTools: Array.from({ length: 10_000 }, (_, index) => `tool-${index}`)
      })
    ])

    const result = (await harness.invoke(skillsListPublicRoute.name, {})) as {
      skills: Array<{ description: string; allowedTools: string[]; metadataTruncated: boolean }>
    }

    expect(Buffer.byteLength(result.skills[0].description, 'utf8')).toBeLessThanOrEqual(1024)
    expect(result.skills[0].allowedTools).toHaveLength(32)
    expect(result.skills[0].metadataTruncated).toBe(true)
  })

  it('bounds scanning of metadata that sanitizes to empty text', async () => {
    const harness = createHarness([
      skill({ description: `${'\u0000'.repeat(100_000)}unreachable-tail` })
    ])

    const result = (await harness.invoke(skillsListPublicRoute.name, {})) as {
      skills: Array<{ description: string; metadataTruncated: boolean }>
    }

    expect(result.skills[0]).toMatchObject({ description: '', metadataTruncated: true })
  })

  it('installs HTTPS URLs while returning only a stable public result', async () => {
    const harness = createHarness()
    const url = 'https://skills.example/archive.zip?signature=private'

    const result = await harness.invoke(skillsInstallPublicUrlRoute.name, {
      url,
      overwrite: true
    })

    expect(result).toEqual({
      agentId: 'deepchat',
      name: 'installed-skill',
      installed: true
    })
    expect(harness.installFromUrlForAgent).toHaveBeenCalledWith('deepchat', url, {
      overwrite: true
    })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(harness.recordSettingsActivity).toHaveBeenCalledOnce()
  })

  it('maps raw installer failures to stable errors without leaking paths', async () => {
    const harness = createHarness()
    harness.installFromUrlForAgent.mockResolvedValueOnce({
      success: false,
      errorCode: 'io_error',
      error: 'EACCES /Users/private/secret-path'
    })

    const failure = await harness
      .invoke(skillsInstallPublicUrlRoute.name, {
        url: 'https://skills.example/archive.zip'
      })
      .catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'unavailable',
      message: 'Skill installation failed'
    })
    expect(String((failure as Error).message)).not.toContain('/Users/private')
  })

  it('retains an approved upload until installation settles', async () => {
    const harness = createHarness()
    const signal = new AbortController().signal
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'deepchat-cli-skill-'))
    const uploadPath = path.join(tempDirectory, 'body-upload.tmp')
    await writeFile(uploadPath, 'archive-bytes')
    let retainedPath = ''
    let releaseInstall!: () => void
    const installReleased = new Promise<void>((resolve) => {
      releaseInstall = resolve
    })
    const installStarted = new Promise<void>((resolve) => {
      harness.installFromZipForAgent.mockImplementationOnce(async (_agentId, zipPath) => {
        retainedPath = zipPath
        resolve()
        await installReleased
        return { success: true, skillName: 'uploaded-skill' }
      })
    })

    try {
      const operation = harness.service.dispatchUpload(
        skillsInstallUploadRoute.name,
        { filename: 'skill.zip', overwrite: false },
        { path: uploadPath, size: 13 },
        caller,
        signal
      )
      await installStarted
      expect(retainedPath).not.toBe(uploadPath)
      await unlink(uploadPath)
      await expect(readFile(retainedPath, 'utf8')).resolves.toBe('archive-bytes')
      releaseInstall()

      await expect(operation).resolves.toEqual({
        agentId: 'deepchat',
        name: 'uploaded-skill',
        installed: true
      })
      await expect(access(retainedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      releaseInstall()
      await rm(tempDirectory, { recursive: true, force: true })
    }
  })

  it('allows policy-authorized Agent URL installs but rejects upload and execution mutations', async () => {
    const harness = createHarness()
    const agentCaller: CliRouteCaller = {
      ...caller,
      principal: 'agent',
      tokenId: 'token-id-conversation-1',
      conversationId: 'conversation-1',
      expiresAt: Date.now() + 60_000
    }

    await expect(
      harness.invoke(
        skillsInstallPublicUrlRoute.name,
        { url: 'https://skills.example/archive.zip' },
        { caller: agentCaller }
      )
    ).resolves.toMatchObject({ name: 'installed-skill', installed: true })
    await expect(
      harness.invoke(
        skillsSetPublicStatusRoute.name,
        { name: 'safe-skill', enabled: false },
        { caller: agentCaller }
      )
    ).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(
      harness.service.dispatchUpload(
        skillsInstallUploadRoute.name,
        { filename: 'skill.zip' },
        { path: '/unused/body.tmp', size: 42 },
        agentCaller,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('updates status and refuses removal of externally managed Skills', async () => {
    const mutableSkill = skill({ ownerPluginId: undefined, mutable: true })
    const harness = createHarness([mutableSkill])

    await expect(
      harness.invoke(skillsSetPublicStatusRoute.name, {
        name: 'safe-skill',
        enabled: false
      })
    ).resolves.toEqual({ agentId: 'deepchat', name: 'safe-skill', enabled: false })
    expect(harness.setSkillDisabledForAgent).toHaveBeenCalledWith('deepchat', 'safe-skill', true)
    await expect(
      harness.invoke(skillsUninstallPublicRoute.name, { name: 'safe-skill' })
    ).resolves.toEqual({ agentId: 'deepchat', name: 'safe-skill', removed: true })

    const managed = createHarness()
    await expect(
      managed.invoke(skillsUninstallPublicRoute.name, { name: 'safe-skill' })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(managed.uninstallSkillForAgent).not.toHaveBeenCalled()
  })

  it('rejects renderer callers and missing Agent scopes', async () => {
    const harness = createHarness()

    await expect(
      harness.invoke(
        skillsListPublicRoute.name,
        {},
        { caller: { kind: 'renderer', webContentsId: 1, windowId: 1 } }
      )
    ).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(
      harness.invoke(skillsListPublicRoute.name, { agentId: 'missing-agent' })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
