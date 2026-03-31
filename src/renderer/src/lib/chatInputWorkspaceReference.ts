export const CHAT_INPUT_WORKSPACE_ITEM_MIME = 'application/x-deepchat-workspace-item'

export interface ChatInputWorkspaceItemDragPayload {
  path: string
  isDirectory: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const normalizeTrimmedString = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : ''
}

const resolveRelativePathFallback = (targetPath: string, workspacePath: string): string => {
  const normalizedTarget = targetPath.replace(/\\/g, '/')
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')

  if (!normalizedWorkspace) {
    return targetPath
  }

  if (normalizedTarget === normalizedWorkspace) {
    return ''
  }

  const expectedPrefix = `${normalizedWorkspace}/`
  if (!normalizedTarget.startsWith(expectedPrefix)) {
    return targetPath
  }

  return normalizedTarget.slice(expectedPrefix.length)
}

export const setChatInputWorkspaceItemDragData = (
  dataTransfer: DataTransfer | null | undefined,
  payload: ChatInputWorkspaceItemDragPayload
) => {
  const path = normalizeTrimmedString(payload.path)
  if (!dataTransfer || !path) {
    return
  }

  dataTransfer.setData(
    CHAT_INPUT_WORKSPACE_ITEM_MIME,
    JSON.stringify({
      path,
      isDirectory: Boolean(payload.isDirectory)
    })
  )
  dataTransfer.effectAllowed = 'copy'
}

export const getChatInputWorkspaceItemDragData = (
  dataTransfer: DataTransfer | null | undefined
): ChatInputWorkspaceItemDragPayload | null => {
  const dragTypes = dataTransfer?.types ? Array.from(dataTransfer.types) : []
  if (!dragTypes.includes(CHAT_INPUT_WORKSPACE_ITEM_MIME)) {
    return null
  }

  try {
    const raw = dataTransfer?.getData(CHAT_INPUT_WORKSPACE_ITEM_MIME)
    const parsed = JSON.parse(raw || '{}') as unknown
    if (!isRecord(parsed)) {
      return null
    }

    const path = normalizeTrimmedString(parsed.path)
    if (!path) {
      return null
    }

    return {
      path,
      isDirectory: Boolean(parsed.isDirectory)
    }
  } catch (error) {
    console.warn('[ChatInputWorkspaceReference] Failed to parse drag payload:', error)
    return null
  }
}

export const resolveChatInputWorkspaceReferencePath = (
  targetPath: string,
  workspacePath?: string | null,
  fallbackName?: string | null
): string => {
  const normalizedTargetPath = normalizeTrimmedString(targetPath)
  const normalizedFallbackName = normalizeTrimmedString(fallbackName)
  if (!normalizedTargetPath) {
    return normalizedFallbackName
  }

  const normalizedWorkspacePath = normalizeTrimmedString(workspacePath)
  if (!normalizedWorkspacePath) {
    return normalizedFallbackName || normalizedTargetPath
  }

  const relativePath =
    window.api?.toRelativePath?.(normalizedTargetPath, normalizedWorkspacePath) ??
    resolveRelativePathFallback(normalizedTargetPath, normalizedWorkspacePath)
  const normalizedRelativePath = normalizeTrimmedString(relativePath)
  if (normalizedRelativePath && normalizedRelativePath !== '.') {
    return normalizedRelativePath
  }

  return normalizedFallbackName || normalizedTargetPath
}

export const buildChatInputWorkspaceReferenceText = (
  targetPath: string,
  workspacePath?: string | null,
  fallbackName?: string | null
): string => {
  const referencePath = resolveChatInputWorkspaceReferencePath(
    targetPath,
    workspacePath,
    fallbackName
  )
  return referencePath ? `@${referencePath}` : ''
}
