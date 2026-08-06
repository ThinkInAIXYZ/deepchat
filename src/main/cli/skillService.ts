import { randomUUID } from 'node:crypto'
import { constants, copyFile, link, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  PUBLIC_SKILL_LIST_MAX_ITEMS,
  PublicSkillSchema,
  skillsInstallPublicUrlRoute,
  skillsInstallUploadRoute,
  skillsListPublicRoute,
  skillsSetPublicStatusRoute,
  skillsUninstallPublicRoute,
  type PublicSkill,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import type { SkillInstallResult, SkillServicePort } from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import { isHardlinkUnavailableError } from '@shared/utils/filesystem'
import { BUILTIN_SKILL_AGENT_ID } from '@/skill/agentSkillRoots'
import {
  createRouteMap,
  type CliRouteCaller,
  type DeepchatRouteMap,
  type RouteCaller
} from '@/routes/routeRegistry'
import { CliRequestError } from './errors'
import { compareStableText, sanitizePublicStringList, sanitizePublicText } from './publicText'
import type { CliUploadedInputFile } from './server'

const PUBLIC_SKILL_DESCRIPTION_BYTES = 1024
const PUBLIC_SKILL_CATEGORY_BYTES = 128
const PUBLIC_SKILL_PLATFORM_BYTES = 64
const PUBLIC_SKILL_TOOL_BYTES = 128
const PUBLIC_SKILL_PLATFORMS = 32
const PUBLIC_SKILL_TOOLS = 32

type PublicSkillPort = Pick<
  SkillServicePort,
  | 'getUnifiedSkillCatalog'
  | 'installFromUrlForAgent'
  | 'installFromZipForAgent'
  | 'setSkillDisabledForAgent'
  | 'uninstallSkillForAgent'
>

export type CliSkillServiceOptions = Readonly<{
  skills: PublicSkillPort
  agentExists(agentId: string): Promise<boolean>
  recordSettingsActivity?(input: SettingsActivityInput): void
  log?: Pick<Console, 'warn'>
}>

function requireCliCaller(caller: RouteCaller): asserts caller is CliRouteCaller {
  if (caller.kind !== 'cli') {
    throw new CliRequestError('permission_denied', 'Public Skill routes require a CLI caller', {
      httpStatus: 403
    })
  }
}

function requireHumanCliCaller(
  caller: RouteCaller
): asserts caller is CliRouteCaller & { principal: 'human' } {
  requireCliCaller(caller)
  if (caller.principal !== 'human') {
    throw new CliRequestError('permission_denied', 'Skill mutation requires a human CLI caller', {
      httpStatus: 403
    })
  }
}

async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function retainUploadFile(
  uploadPath: string,
  linkFile: typeof link = link
): Promise<Readonly<{ path: string }>> {
  const retainedPath = path.join(path.dirname(uploadPath), `body-${randomUUID()}.tmp`)
  try {
    await linkFile(uploadPath, retainedPath)
  } catch (error) {
    if (!isHardlinkUnavailableError(error)) throw error
    try {
      await copyFile(uploadPath, retainedPath, constants.COPYFILE_EXCL)
    } catch (copyError) {
      await removeFileIfPresent(retainedPath).catch(() => undefined)
      throw copyError
    }
  }
  return { path: retainedPath }
}

function toPublicSkill(skill: UnifiedSkillItem): PublicSkill {
  const description = sanitizePublicText(skill.description, PUBLIC_SKILL_DESCRIPTION_BYTES)
  const category = skill.category
    ? sanitizePublicText(skill.category, PUBLIC_SKILL_CATEGORY_BYTES)
    : { value: '', truncated: false }
  const platforms = sanitizePublicStringList(
    skill.platforms,
    PUBLIC_SKILL_PLATFORMS,
    PUBLIC_SKILL_PLATFORM_BYTES
  )
  const allowedTools = sanitizePublicStringList(
    skill.allowedTools,
    PUBLIC_SKILL_TOOLS,
    PUBLIC_SKILL_TOOL_BYTES
  )
  return PublicSkillSchema.parse({
    agentId: skill.agentId,
    name: skill.name,
    description: description.value,
    category: category.value || null,
    platforms: platforms.values,
    allowedTools: allowedTools.values,
    sourceType: skill.sourceType,
    enabled: !skill.disabled,
    mutable: skill.mutable,
    managedBy:
      skill.ownerPluginId !== undefined
        ? 'plugin'
        : skill.sourceType === 'builtin'
          ? 'deepchat'
          : 'user',
    metadataTruncated:
      description.truncated || category.truncated || platforms.truncated || allowedTools.truncated
  })
}

export class CliSkillService {
  private readonly log: Pick<Console, 'warn'>

  constructor(private readonly options: CliSkillServiceOptions) {
    this.log = options.log ?? console
  }

  createRoutes(): DeepchatRouteMap {
    return createRouteMap([
      [
        skillsListPublicRoute.name,
        async (rawInput, context) => {
          requireCliCaller(context.caller)
          const input = skillsListPublicRoute.input.parse(rawInput)
          const catalog = [...(await this.loadCatalog(input.agentId))].sort((left, right) =>
            compareStableText(left.name, right.name)
          )
          return skillsListPublicRoute.output.parse({
            skills: catalog.slice(0, PUBLIC_SKILL_LIST_MAX_ITEMS).map(toPublicSkill),
            truncated: catalog.length > PUBLIC_SKILL_LIST_MAX_ITEMS
          })
        }
      ],
      [
        skillsInstallPublicUrlRoute.name,
        async (rawInput, context) => {
          requireCliCaller(context.caller)
          const input = skillsInstallPublicUrlRoute.input.parse(rawInput)
          await this.requireAgent(input.agentId)
          let result: SkillInstallResult
          try {
            result = await this.options.skills.installFromUrlForAgent(input.agentId, input.url, {
              overwrite: input.overwrite
            })
          } catch (error) {
            throw this.unavailable('install the Skill', error)
          }
          const name = this.requireInstallSuccess(result)
          this.recordActivity('created', input.agentId, name)
          return skillsInstallPublicUrlRoute.output.parse({
            agentId: input.agentId,
            name,
            installed: true
          })
        }
      ],
      [
        skillsSetPublicStatusRoute.name,
        async (rawInput, context) => {
          requireHumanCliCaller(context.caller)
          const input = skillsSetPublicStatusRoute.input.parse(rawInput)
          const skill = await this.requireSkill(input.agentId, input.name)
          try {
            await this.options.skills.setSkillDisabledForAgent(
              input.agentId,
              skill.name,
              !input.enabled
            )
          } catch (error) {
            throw this.unavailable('update Skill status', error)
          }
          this.recordActivity(input.enabled ? 'enabled' : 'disabled', input.agentId, skill.name)
          return skillsSetPublicStatusRoute.output.parse({
            agentId: input.agentId,
            name: skill.name,
            enabled: input.enabled
          })
        }
      ],
      [
        skillsUninstallPublicRoute.name,
        async (rawInput, context) => {
          requireHumanCliCaller(context.caller)
          const input = skillsUninstallPublicRoute.input.parse(rawInput)
          const skill = await this.requireSkill(input.agentId, input.name)
          if (!skill.mutable) {
            throw new CliRequestError('conflict', 'Externally managed Skill cannot be removed', {
              httpStatus: 409
            })
          }
          let result: SkillInstallResult
          try {
            result = await this.options.skills.uninstallSkillForAgent(input.agentId, skill.name)
          } catch (error) {
            throw this.unavailable('remove the Skill', error)
          }
          this.requireUninstallSuccess(result)
          this.recordActivity('removed', input.agentId, skill.name)
          return skillsUninstallPublicRoute.output.parse({
            agentId: input.agentId,
            name: skill.name,
            removed: true
          })
        }
      ]
    ])
  }

  handlesUpload(method: string): boolean {
    return method === skillsInstallUploadRoute.name
  }

  async dispatchUpload(
    method: string,
    rawInput: unknown,
    upload: CliUploadedInputFile,
    caller: RouteCaller,
    signal: AbortSignal
  ): Promise<unknown> {
    requireHumanCliCaller(caller)
    if (!this.handlesUpload(method)) {
      throw new CliRequestError('not_found', 'Skill upload method is not implemented', {
        httpStatus: 404
      })
    }
    const input = skillsInstallUploadRoute.input.parse(rawInput)
    signal.throwIfAborted()
    await this.requireAgent(input.agentId)
    signal.throwIfAborted()
    let retainedUpload: Readonly<{ path: string }>
    try {
      retainedUpload = await retainUploadFile(upload.path)
    } catch (error) {
      throw this.unavailable('retain the Skill upload', error)
    }
    try {
      let result: SkillInstallResult
      try {
        result = await this.options.skills.installFromZipForAgent(
          input.agentId,
          retainedUpload.path,
          { overwrite: input.overwrite }
        )
      } catch (error) {
        throw this.unavailable('install the Skill', error)
      }
      const name = this.requireInstallSuccess(result)
      this.recordActivity('created', input.agentId, name)
      return skillsInstallUploadRoute.output.parse({
        agentId: input.agentId,
        name,
        installed: true
      })
    } finally {
      await removeFileIfPresent(retainedUpload.path).catch((error) => {
        this.log.warn('[CLI] Failed to release retained Skill upload', {
          failure: { name: error instanceof Error ? error.name : typeof error }
        })
      })
    }
  }

  private async requireAgent(agentId: string): Promise<void> {
    if (agentId === BUILTIN_SKILL_AGENT_ID) return
    let exists: boolean
    try {
      exists = await this.options.agentExists(agentId)
    } catch (error) {
      throw this.unavailable('resolve the Skill Agent', error)
    }
    if (!exists) {
      throw new CliRequestError('not_found', 'Skill Agent was not found', { httpStatus: 404 })
    }
  }

  private async loadCatalog(agentId: string): Promise<UnifiedSkillItem[]> {
    await this.requireAgent(agentId)
    try {
      return await this.options.skills.getUnifiedSkillCatalog(agentId)
    } catch (error) {
      throw this.unavailable('read the Skill catalog', error)
    }
  }

  private async requireSkill(agentId: string, name: string): Promise<UnifiedSkillItem> {
    const skill = (await this.loadCatalog(agentId)).find((candidate) => candidate.name === name)
    if (!skill) {
      throw new CliRequestError('not_found', 'Skill was not found', { httpStatus: 404 })
    }
    return skill
  }

  private requireInstallSuccess(result: SkillInstallResult): string {
    if (result.success && result.skillName) return result.skillName
    switch (result.errorCode) {
      case 'conflict':
        throw new CliRequestError('conflict', 'Skill conflicts with an existing installation', {
          httpStatus: 409
        })
      case 'invalid_skill':
        throw new CliRequestError('invalid_request', 'Skill archive is invalid')
      case 'not_found':
        throw new CliRequestError('not_found', 'Skill archive was not found', { httpStatus: 404 })
      case 'target_locked':
        throw new CliRequestError('conflict', 'Skill installation target is busy', {
          httpStatus: 409,
          retriable: true
        })
      case 'io_error':
        throw new CliRequestError('unavailable', 'Skill installation failed', {
          httpStatus: 503,
          retriable: true
        })
      default:
        throw new CliRequestError('internal_error', 'Skill installer returned an invalid result', {
          httpStatus: 500
        })
    }
  }

  private requireUninstallSuccess(result: SkillInstallResult): void {
    if (result.success) return
    switch (result.errorCode) {
      case 'not_found':
        throw new CliRequestError('not_found', 'Skill was not found', { httpStatus: 404 })
      case 'invalid_skill':
        throw new CliRequestError('invalid_request', 'Skill name is invalid')
      case 'target_locked':
        throw new CliRequestError('conflict', 'Skill installation target is busy', {
          httpStatus: 409,
          retriable: true
        })
      case 'io_error':
        throw new CliRequestError('unavailable', 'Skill could not be removed', {
          httpStatus: 503,
          retriable: true
        })
      default:
        throw new CliRequestError(
          'internal_error',
          'Skill uninstaller returned an invalid result',
          {
            httpStatus: 500
          }
        )
    }
  }

  private unavailable(action: string, error: unknown): CliRequestError {
    this.log.warn(`[CLI] Failed to ${action}`, {
      failure: { name: error instanceof Error ? error.name : typeof error }
    })
    return new CliRequestError('unavailable', `Could not ${action}`, {
      httpStatus: 503,
      retriable: true
    })
  }

  private recordActivity(
    action: SettingsActivityInput['action'],
    agentId: string,
    name: string
  ): void {
    try {
      this.options.recordSettingsActivity?.({
        category: 'knowledge',
        action,
        targetType: 'skill',
        targetId: `${agentId}:${name}`,
        targetLabel: name,
        routeName: 'settings-skills',
        routeParams: { agentId },
        summaryKey: 'settings.controlCenter.activity.settingUpdated',
        summaryParams: { key: name }
      })
    } catch (error) {
      this.log.warn('[CLI] Failed to record Skill activity', {
        failure: { name: error instanceof Error ? error.name : typeof error }
      })
    }
  }
}
