import type {
  CreateSessionInput,
  MessageFile,
  SendMessageInput
} from '@shared/types/agent-interface'
import { isUserConfigurableAgentTool } from '@shared/agentTools'

// Tools that no longer ship are dropped from persisted disabled-tool lists so upgraded
// sessions do not carry names the runtime can never resolve.
const RETIRED_BROWSER_AGENT_TOOLS = [
  'cdp_send',
  'load_url',
  'get_browser_status',
  'yo_browser_cdp_send',
  'yo_browser_window_open',
  'yo_browser_window_list'
]
const RETIRED_DEFAULT_AGENT_TOOLS = new Set(['find', 'ls', ...RETIRED_BROWSER_AGENT_TOOLS])
const LEGACY_PERSISTED_DISABLED_AGENT_TOOLS = new Set([
  'find',
  'grep',
  'ls',
  ...RETIRED_BROWSER_AGENT_TOOLS
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

export const isSendMessageInputEmpty = (input: SendMessageInput): boolean =>
  !input.text.trim() &&
  (input.files?.length ?? 0) === 0 &&
  !input.inlineItems?.some((item) => item.type === 'session')

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
