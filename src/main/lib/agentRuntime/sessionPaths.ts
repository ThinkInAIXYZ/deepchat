import { createHash } from 'crypto'
import { app } from 'electron'
import path from 'path'

const INVALID_WINDOWS_SEGMENT_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
const TRAILING_WINDOWS_SEGMENT_CHARS = /[. ]+$/g

export function getSessionsRoot(): string {
  return path.resolve(app.getPath('home'), '.deepchat', 'sessions')
}

export function resolveSessionDir(conversationId: string): string | null {
  if (!conversationId.trim()) {
    return null
  }

  const sessionsRoot = getSessionsRoot()
  const resolvedSessionDir = path.resolve(sessionsRoot, conversationId)
  const rootWithSeparator = sessionsRoot.endsWith(path.sep)
    ? sessionsRoot
    : `${sessionsRoot}${path.sep}`

  if (resolvedSessionDir !== sessionsRoot && !resolvedSessionDir.startsWith(rootWithSeparator)) {
    return null
  }

  return resolvedSessionDir
}

export function resolveToolOffloadPath(conversationId: string, toolCallId: string): string | null {
  const sessionDir = resolveSessionDir(conversationId)
  if (!sessionDir) {
    return null
  }

  const safeToolCallId = sanitizeToolCallIdForOffload(toolCallId)
  return path.join(sessionDir, `tool_${safeToolCallId}.offload`)
}

export function resolveToolOffloadTemplatePath(conversationId: string): string | null {
  const sessionDir = resolveSessionDir(conversationId)
  if (!sessionDir) {
    return null
  }

  return path.join(sessionDir, 'tool_<toolCallId>.offload')
}

function sanitizeToolCallIdForOffload(toolCallId: string): string {
  const sanitizedBase = Array.from(toolCallId.trim(), (char) => {
    const charCode = char.charCodeAt(0)
    if (charCode <= 0x1f || INVALID_WINDOWS_SEGMENT_CHARS.has(char)) {
      return '_'
    }

    return char
  })
    .join('')
    .replace(TRAILING_WINDOWS_SEGMENT_CHARS, '')

  const fingerprint = createHash('sha1').update(toolCallId).digest('hex').slice(0, 8)
  const sanitized = [sanitizedBase || 'tool_call', fingerprint].filter(Boolean).join('_')

  return sanitized || 'tool_call'
}
