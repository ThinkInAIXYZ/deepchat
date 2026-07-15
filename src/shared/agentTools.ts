export const CRON_JOB_AGENT_TOOL_NAME = 'cronjob'
export const DEFAULT_DISABLED_AGENT_TOOLS = [CRON_JOB_AGENT_TOOL_NAME] as const

export const TAPE_TOOL_NAMES = Object.freeze({
  info: 'tape_info',
  search: 'tape_search',
  context: 'tape_context',
  anchors: 'tape_anchors',
  handoff: 'tape_handoff'
} as const)

export type TapeToolName = (typeof TAPE_TOOL_NAMES)[keyof typeof TAPE_TOOL_NAMES]

export type AgentToolExposure = 'user-configurable' | 'system-model' | 'diagnostic' | 'runtime-only'

const AGENT_TOOL_EXPOSURE_BY_NAME: Readonly<Record<TapeToolName, AgentToolExposure>> =
  Object.freeze({
    [TAPE_TOOL_NAMES.search]: 'system-model',
    [TAPE_TOOL_NAMES.context]: 'system-model',
    [TAPE_TOOL_NAMES.info]: 'diagnostic',
    [TAPE_TOOL_NAMES.anchors]: 'diagnostic',
    [TAPE_TOOL_NAMES.handoff]: 'runtime-only'
  })

export const isTapeToolName = (toolName: string): toolName is TapeToolName =>
  Object.prototype.hasOwnProperty.call(AGENT_TOOL_EXPOSURE_BY_NAME, toolName)

export const getAgentToolExposure = (toolName: string): AgentToolExposure =>
  isTapeToolName(toolName)
    ? AGENT_TOOL_EXPOSURE_BY_NAME[toolName as TapeToolName]
    : 'user-configurable'

export const assertAgentToolExposure = (
  toolName: string,
  expectedExposure: AgentToolExposure
): void => {
  const registeredExposure = getAgentToolExposure(toolName)
  if (registeredExposure !== expectedExposure) {
    throw new Error(
      `Agent tool exposure mismatch for '${toolName}': expected '${expectedExposure}', registered '${registeredExposure}'.`
    )
  }
}

export const isUserConfigurableAgentTool = (toolName: string): boolean =>
  getAgentToolExposure(toolName) === 'user-configurable'
