import type {
  SkillServicePort,
  SkillListItem,
  SkillManageRequest,
  SkillManageResult,
  SkillViewResult
} from '@shared/types/skill'

export class SkillTools {
  constructor(private readonly skillService: SkillServicePort) {}

  async handleSkillList(
    conversationId?: string,
    allowedSkillNames?: string[] | null,
    activeSkillNames?: string[]
  ): Promise<{
    skills: SkillListItem[]
    pinnedCount: number
    activeCount: number
    totalCount: number
  }> {
    const allowedSkillSet = Array.isArray(allowedSkillNames)
      ? new Set(allowedSkillNames.map((skillName) => skillName.trim()).filter(Boolean))
      : undefined
    const allSkills = (await this.skillService.getMetadataList()).filter(
      (skill) => !allowedSkillSet || allowedSkillSet.has(skill.name)
    )
    const listedSkillNames = new Set(allSkills.map((skill) => skill.name))
    const pinnedSkills = conversationId
      ? (await this.skillService.getActiveSkills(conversationId)).filter((skillName) =>
          listedSkillNames.has(skillName)
        )
      : []
    const activeSkills = (Array.isArray(activeSkillNames) ? activeSkillNames : pinnedSkills).filter(
      (skillName) => listedSkillNames.has(skillName)
    )
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
    input: { name: string; file_path?: string },
    allowedSkillNames?: string[] | null
  ): Promise<SkillViewResult> {
    const requestedSkillName = input.name.trim()
    const allowedSkillSet = Array.isArray(allowedSkillNames)
      ? new Set(allowedSkillNames.map((skillName) => skillName.trim()).filter(Boolean))
      : undefined
    if (allowedSkillSet && !allowedSkillSet.has(requestedSkillName)) {
      return {
        success: false,
        name: requestedSkillName,
        error: `Skill '${requestedSkillName}' is not enabled for this agent`
      }
    }

    return await this.skillService.viewSkill(requestedSkillName, {
      filePath: input.file_path,
      conversationId
    })
  }

  async handleSkillManage(
    conversationId: string | undefined,
    request: SkillManageRequest
  ): Promise<SkillManageResult> {
    if (!conversationId) {
      return {
        success: false,
        action: request.action,
        error: 'No conversation context available for skill_manage'
      }
    }

    return await this.skillService.manageDraftSkill(conversationId, request)
  }
}
