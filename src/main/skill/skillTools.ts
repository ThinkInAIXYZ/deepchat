import type {
  SkillServicePort,
  SkillListItem,
  SkillManageRequest,
  SkillManageResult,
  SkillViewResult
} from '@shared/types/skill'
import { BUILTIN_SKILL_AGENT_ID } from './agentSkillRoots'

export class SkillTools {
  constructor(private readonly skillService: SkillServicePort) {}

  async handleSkillList(
    conversationId?: string,
    activeSkillNames?: string[]
  ): Promise<{
    skills: SkillListItem[]
    pinnedCount: number
    activeCount: number
    totalCount: number
  }> {
    const resolvedAgentId = conversationId
      ? await this.skillService.resolveSessionAgentId(conversationId)
      : BUILTIN_SKILL_AGENT_ID
    if (!resolvedAgentId) {
      return { skills: [], pinnedCount: 0, activeCount: 0, totalCount: 0 }
    }
    const agentId = resolvedAgentId
    const allSkills = await this.skillService.getMetadataList(agentId)
    const listedSkillNames = new Set(allSkills.map((skill) => skill.name))
    const pinnedSkills = conversationId
      ? (await this.skillService.getActiveSkills(conversationId)).filter((skillName) =>
          listedSkillNames.has(skillName)
        )
      : []
    // Keep persisted pins separate from current-message activation, while exposing
    // the effective active state to the model for this tool loop.
    const runtimeSkills = (activeSkillNames ?? []).filter((skillName) =>
      listedSkillNames.has(skillName)
    )
    const activeSkills = Array.from(new Set([...pinnedSkills, ...runtimeSkills]))
    const pinnedSet = new Set(pinnedSkills)
    const activeSet = new Set(activeSkills)

    const skillList = allSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      category: skill.category ?? null,
      platforms: skill.platforms,
      metadata: skill.metadata,
      isPinned: pinnedSet.has(skill.name),
      active: activeSet.has(skill.name)
    }))

    return {
      skills: skillList,
      pinnedCount: pinnedSkills.length,
      activeCount: activeSkills.length,
      totalCount: allSkills.length
    }
  }

  async handleSkillView(
    conversationId: string | undefined,
    input: { name: string; file_path?: string }
  ): Promise<SkillViewResult> {
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
      conversationId
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
