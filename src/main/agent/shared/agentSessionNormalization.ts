const RETIRED_DEFAULT_AGENT_TOOLS = new Set(['find', 'ls'])
const LEGACY_PERSISTED_DISABLED_AGENT_TOOLS = new Set(['find', 'grep', 'ls'])
const LEGACY_AGENT_TOOL_NAME_MAP: Record<string, string> = {
  yo_browser_cdp_send: 'cdp_send',
  yo_browser_window_open: 'load_url',
  yo_browser_window_list: 'get_browser_status'
}

export const normalizeDisabledAgentTools = (
  disabledAgentTools?: string[],
  options?: { dropLegacySearchTools?: boolean }
): string[] => {
  if (!Array.isArray(disabledAgentTools)) return []
  const retiredTools = options?.dropLegacySearchTools
    ? LEGACY_PERSISTED_DISABLED_AGENT_TOOLS
    : RETIRED_DEFAULT_AGENT_TOOLS

  return Array.from(
    new Set(
      disabledAgentTools
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .map((item) => LEGACY_AGENT_TOOL_NAME_MAP[item] ?? item)
        .filter((item) => Boolean(item) && !retiredTools.has(item))
    )
  ).sort((left, right) => left.localeCompare(right))
}

export const normalizeActiveSkills = (activeSkills?: string[]): string[] => {
  if (!Array.isArray(activeSkills)) return []
  return Array.from(
    new Set(
      activeSkills
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}
