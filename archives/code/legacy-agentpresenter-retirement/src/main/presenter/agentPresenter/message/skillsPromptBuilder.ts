import type { AgentPromptRuntimePort } from '../runtimePorts'

/**
 * Build the skills prompt section for the system prompt.
 * Loads active skills content and formats them for injection.
 *
 * @param conversationId - The conversation ID to get active skills for
 * @returns A formatted string containing all active skill contents, or empty string if no skills active
 */
export async function buildSkillsPrompt(
  promptRuntime: AgentPromptRuntimePort,
  conversationId: string
): Promise<string> {
  try {
    if (!promptRuntime.getSkillsEnabled()) {
      return ''
    }

    const activeSkills = await promptRuntime.getActiveSkills(conversationId)

    if (activeSkills.length === 0) {
      return ''
    }

    const skillContents: string[] = []

    for (const skillName of activeSkills) {
      const skillContent = await promptRuntime.loadSkillContent(skillName)
      if (skillContent && skillContent.content) {
        skillContents.push(`## Skill: ${skillName}\n\n${skillContent.content}`)
      }
    }

    if (skillContents.length === 0) {
      return ''
    }

    return `# Active Skills\n\nThe following skills are currently active and provide specialized guidance:\n\n${skillContents.join('\n\n---\n\n')}`
  } catch (error) {
    console.warn('[SkillsPromptBuilder] Failed to build skills prompt:', error)
    return ''
  }
}

/**
 * Build the skills metadata prompt section for the system prompt.
 * Lists available skills and how to activate them.
 * Delegates to skillPresenter.getMetadataPrompt() to avoid code duplication.
 */
export async function buildSkillsMetadataPrompt(
  promptRuntime: AgentPromptRuntimePort
): Promise<string> {
  try {
    if (!promptRuntime.getSkillsEnabled()) {
      return ''
    }

    return await promptRuntime.getMetadataPrompt()
  } catch (error) {
    console.warn('[SkillsPromptBuilder] Failed to build skills metadata prompt:', error)
    return ''
  }
}

/**
 * Get allowed tools from active skills for a conversation.
 * Used to extend MCP tool filtering based on skill requirements.
 *
 * @param conversationId - The conversation ID
 * @returns Array of allowed tool names from active skills
 */
export async function getSkillsAllowedTools(
  promptRuntime: AgentPromptRuntimePort,
  conversationId: string
): Promise<string[]> {
  try {
    if (!promptRuntime.getSkillsEnabled()) {
      return []
    }

    return await promptRuntime.getActiveSkillsAllowedTools(conversationId)
  } catch (error) {
    console.warn('[SkillsPromptBuilder] Failed to get skills allowed tools:', error)
    return []
  }
}
