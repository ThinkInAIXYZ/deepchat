import type {
  MessageFile,
  SendMessageInput,
  UserMessageContent,
  UserMessageInlineItem
} from '@shared/types/agent-interface'
import { getValidInlineItems } from '@shared/messageInlineItems'

const normalizeStringList = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  )

export function extractUserMessageInput(content: string): SendMessageInput {
  const fallback: SendMessageInput = { text: '', files: [] }

  try {
    const parsed = JSON.parse(content) as UserMessageContent | SendMessageInput | string
    if (typeof parsed === 'string') return { text: parsed, files: [] }
    if (!parsed || typeof parsed !== 'object') return fallback

    const text = typeof parsed.text === 'string' ? parsed.text : ''
    const files = Array.isArray((parsed as { files?: unknown }).files)
      ? ((parsed as { files?: unknown }).files as MessageFile[]).filter(Boolean)
      : []
    const activeSkills = normalizeStringList(
      Array.isArray((parsed as { activeSkills?: unknown }).activeSkills)
        ? ((parsed as { activeSkills?: unknown }).activeSkills as string[])
        : []
    )
    const inlineItems = Array.isArray((parsed as { inlineItems?: unknown }).inlineItems)
      ? ((parsed as { inlineItems?: unknown }).inlineItems as NonNullable<
          SendMessageInput['inlineItems']
        >)
      : []
    return {
      text,
      files,
      search: (parsed as { search?: unknown }).search === true,
      ...(activeSkills.length > 0 ? { activeSkills } : {}),
      ...(inlineItems.length > 0 ? { inlineItems } : {})
    }
  } catch {
    return { text: content, files: [] }
  }
}

export function normalizeUserMessageInput(input: string | SendMessageInput): SendMessageInput {
  if (typeof input === 'string') return { text: input, files: [] }
  if (!input || typeof input !== 'object') return { text: '', files: [] }

  const text = typeof input.text === 'string' ? input.text : ''
  const files = Array.isArray(input.files) ? input.files.filter(Boolean) : []
  const activeSkills = normalizeStringList(
    Array.isArray(input.activeSkills) ? input.activeSkills : []
  )
  const inlineItems = Array.isArray(input.inlineItems) ? input.inlineItems : []
  return {
    text,
    files,
    search: input.search === true,
    ...(activeSkills.length > 0 ? { activeSkills } : {}),
    ...(inlineItems.length > 0 ? { inlineItems } : {}),
    ...(input.attachmentFallbackPolicy === 'auto' ||
    input.attachmentFallbackPolicy === 'send_without_image_content'
      ? { attachmentFallbackPolicy: input.attachmentFallbackPolicy }
      : {})
  }
}

export function retainEditedSessionGrants(
  originalItems: unknown,
  editedItems: readonly UserMessageInlineItem[]
): UserMessageInlineItem[] {
  const originals = Array.isArray(originalItems) ? originalItems : []
  return editedItems.map((item) => {
    if (item.type !== 'session') return item
    const original = originals.find(
      (source) =>
        source?.type === 'session' &&
        source.sessionId === item.sessionId &&
        source.tapeIncarnationId === item.tapeIncarnationId
    )
    if (!original) {
      throw new Error(
        'Edited message contains a session reference that was not originally granted.'
      )
    }
    return { ...original, offset: item.offset }
  })
}

export function buildEditedUserContent(
  rawContent: string,
  text: string,
  inlineItems?: UserMessageInlineItem[]
): string {
  const fallback: UserMessageContent = {
    text,
    files: [],
    links: [],
    search: false,
    think: false
  }

  let parsed: Record<string, unknown> | string
  try {
    parsed = JSON.parse(rawContent) as Record<string, unknown> | string
  } catch {
    parsed = rawContent
  }

  if (inlineItems) {
    inlineItems = retainEditedSessionGrants(
      typeof parsed === 'object' && parsed && !Array.isArray(parsed) ? parsed.inlineItems : [],
      inlineItems
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return JSON.stringify({
      ...fallback,
      ...(inlineItems?.length ? { inlineItems: getValidInlineItems(text, inlineItems) } : {})
    })
  }

  const next = { ...parsed, text } as Record<string, unknown>
  delete next.inlineItems
  const references = inlineItems
    ? getValidInlineItems(text, inlineItems)
    : Array.isArray(parsed.inlineItems)
      ? parsed.inlineItems
          .filter((item) => item?.type === 'session')
          .map((item) => ({ ...item, offset: text.length }))
      : []
  if (references.length > 0) next.inlineItems = references
  if (!Array.isArray(next.files)) next.files = []
  if (!Array.isArray(next.links)) next.links = []
  if (typeof next.search !== 'boolean') next.search = false
  if (typeof next.think !== 'boolean') next.think = false

  if (inlineItems) {
    delete next.content
  } else if (Array.isArray(next.content)) {
    let replaced = false
    const mapped = next.content.map((item) => {
      if (
        !replaced &&
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (item as { type?: unknown }).type === 'text'
      ) {
        replaced = true
        return { ...(item as Record<string, unknown>), content: text }
      }
      return item
    })
    if (!replaced) mapped.unshift({ type: 'text', content: text })
    next.content = mapped
  }

  return JSON.stringify(next)
}
