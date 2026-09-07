import type {
  SkillServicePort,
  SkillListInput,
  SkillListResult,
  SkillManageRequest,
  SkillManageResult
} from '@shared/types/skill'
import { BUILTIN_SKILL_AGENT_ID } from './agentSkillRoots'
import { buildSkillListResult } from './routingCatalog'
import type { RuntimeSkillViewResult } from './index'

type SkillToolsServicePort = Pick<
  SkillServicePort,
  | 'getActiveSkills'
  | 'getAllSkills'
  | 'getMetadataList'
  | 'manageDraftSkill'
  | 'resolveSessionAgentId'
> & {
  viewSkillForAgent(
    agentId: string,
    name: string,
    options?: { filePath?: string; conversationId?: string; activeSkillNames?: readonly string[] }
  ): Promise<RuntimeSkillViewResult>
}

export class SkillTools {
  constructor(private readonly skillService: SkillToolsServicePort) {}

  async handleSkillList(
    conversationId?: string,
    activeSkillNames?: string[],
    input: SkillListInput = {}
  ): Promise<SkillListResult> {
    const resolvedAgentId = conversationId
      ? await this.skillService.resolveSessionAgentId(conversationId)
      : BUILTIN_SKILL_AGENT_ID
    if (!resolvedAgentId) {
      return buildSkillListResult([], [], [], input)
    }
    const agentId = resolvedAgentId
    const assignedSkills = await this.skillService.getMetadataList(agentId)
    const allSkills = [...assignedSkills]
    if (activeSkillNames !== undefined) {
      const listedNames = new Set(allSkills.map((skill) => skill.name))
      const activeNames = new Set(activeSkillNames)
      for (const skill of await this.skillService.getAllSkills()) {
        if (activeNames.has(skill.name) && !listedNames.has(skill.name)) {
          allSkills.push(skill)
          listedNames.add(skill.name)
        }
      }
    }
    const listedSkillNames = new Set(allSkills.map((skill) => skill.name))
    const sessionActiveSkills = conversationId
      ? (await this.skillService.getActiveSkills(conversationId)).filter((skillName) =>
          listedSkillNames.has(skillName)
        )
      : []
    const runtimeSkills = (activeSkillNames ?? []).filter((skillName) =>
      listedSkillNames.has(skillName)
    )
    return buildSkillListResult(allSkills, sessionActiveSkills, runtimeSkills, input)
  }

  async handleSkillView(
    conversationId: string | undefined,
    input: { name: string; file_path?: string },
    activeSkillNames?: readonly string[]
  ): Promise<RuntimeSkillViewResult> {
    const requestedSkillName = input.name.trim()
    const agentId = conversationId
      ? await this.skillService.resolveSessionAgentId(conversationId)
      : null
    if (!agentId) {
      return {
        success: false,
        name: requestedSkillName,
        error: 'No DeepChat Agent context available'
      }
    }

    return await this.skillService.viewSkillForAgent(agentId, requestedSkillName, {
      filePath: input.file_path,
      conversationId,
      activeSkillNames
    })
  }

  async handleSkillManage(
    conversationId: string | undefined,
    request: SkillManageRequest,
    options: { beforeMutation?: () => void } = {}
  ): Promise<SkillManageResult> {
    if (!conversationId) {
      return {
        success: false,
        action: request.action,
        error: 'No conversation context available for skill_manage'
      }
    }

    return options.beforeMutation
      ? await this.skillService.manageDraftSkill(conversationId, request, options)
      : await this.skillService.manageDraftSkill(conversationId, request)
  }
}
