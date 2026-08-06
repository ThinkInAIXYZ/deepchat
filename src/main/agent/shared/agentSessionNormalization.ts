import type {
  CreateSessionInput,
  MessageFile,
  SendMessageInput
} from '@shared/types/agent-interface'
import { isUserConfigurableAgentTool } from '@shared/agentTools'

const RETIRED_DEFAULT_AGENT_TOOLS = new Set(['find', 'ls'])
const LEGACY_PERSISTED_DISABLED_AGENT_TOOLS = new Set(['find', 'grep', 'ls'])
const LEGACY_AGENT_TOOL_NAME_MAP = new Map<string, string>([
  ['yo_browser_cdp_send', 'cdp_send'],
  ['yo_browser_window_open', 'load_url'],
  ['yo_browser_window_list', 'get_browser_status']
])

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
        .map((item) => LEGACY_AGENT_TOOL_NAME_MAP.get(item) ?? item)
        .filter(
          (item) => Boolean(item) && !retiredTools.has(item) && isUserConfigurableAgentTool(item)
        )
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

export const normalizeSendMessageInput = (content: string | SendMessageInput): SendMessageInput => {
  if (typeof content === 'string') {
    return { text: content, files: [] }
  }

  if (!content || typeof content !== 'object') {
    return { text: '', files: [] }
  }

  const text = typeof content.text === 'string' ? content.text : ''
  const files = Array.isArray(content.files)
    ? content.files.filter((file): file is MessageFile => Boolean(file))
    : []
  const activeSkills = normalizeActiveSkills(content.activeSkills)
  const inlineItems = Array.isArray(content.inlineItems) ? content.inlineItems : []
  const attachmentFallbackPolicy =
    content.attachmentFallbackPolicy === 'auto' ||
    content.attachmentFallbackPolicy === 'send_without_image_content'
      ? content.attachmentFallbackPolicy
      : undefined
  return {
    text,
    files,
    ...(content.search === true ? { search: true } : {}),
    ...(activeSkills.length > 0 ? { activeSkills } : {}),
    ...(inlineItems.length > 0 ? { inlineItems } : {}),
    ...(attachmentFallbackPolicy ? { attachmentFallbackPolicy } : {})
  }
}

export const normalizeCreateSessionInput = (input: CreateSessionInput): SendMessageInput =>
  normalizeSendMessageInput({
    text: typeof input.message === 'string' ? input.message : '',
    files: Array.isArray(input.files) ? input.files : [],
    ...(input.search === true ? { search: true } : {}),
    activeSkills: input.activeSkills,
    inlineItems: Array.isArray(input.inlineItems) ? input.inlineItems : []
  })
