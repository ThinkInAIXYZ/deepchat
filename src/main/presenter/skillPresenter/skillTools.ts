import type { ISkillPresenter, SkillControlAction, SkillListItem } from '@shared/types/skill'

export class SkillTools {
  constructor(private readonly skillPresenter: ISkillPresenter) {}

  async handleSkillList(
    conversationId?: string
  ): Promise<{ skills: SkillListItem[]; activeCount: number; totalCount: number }> {
    const allSkills = await this.skillPresenter.getMetadataList()
    const activeSkills = conversationId
      ? await this.skillPresenter.getActiveSkills(conversationId)
      : []
    const activeSet = new Set(activeSkills)

    const skillList = allSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      active: activeSet.has(skill.name)
    }))

    return {
      skills: skillList,
      activeCount: activeSkills.length,
      totalCount: allSkills.length
    }
  }

  async handleSkillControl(
    conversationId: string | undefined,
    action: SkillControlAction,
    skillNames: string[]
  ): Promise<{
    success: boolean
    action?: SkillControlAction
    affectedSkills?: string[]
    activeSkills?: string[]
    error?: string
  }> {
    if (!conversationId) {
      return {
        success: false,
        error: 'No conversation context available for skill control'
      }
    }

    if (!skillNames.length) {
      return {
        success: false,
        error: 'No skill names provided'
      }
    }

    const currentActiveSkills = await this.skillPresenter.getActiveSkills(conversationId)
    const currentSet = new Set(currentActiveSkills)

    let newActiveSkills: string[]
    let affectedSkills: string[]

    if (action === 'activate') {
      const validatedSkills = await this.skillPresenter.validateSkillNames(skillNames)
      validatedSkills.forEach((skill) => currentSet.add(skill))
      newActiveSkills = Array.from(currentSet)
      affectedSkills = validatedSkills
    } else {
      skillNames.forEach((skill) => currentSet.delete(skill))
      newActiveSkills = Array.from(currentSet)
      affectedSkills = skillNames
    }

    await this.skillPresenter.setActiveSkills(conversationId, newActiveSkills)

    return {
      success: true,
      action,
      affectedSkills,
      activeSkills: newActiveSkills
    }
  }
}
