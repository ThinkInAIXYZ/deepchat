import { createHash } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { UserPluginHookDiagnostic } from '@shared/types/userPlugin'
import type { SessionDatabase } from '@/session/data/database'

export interface DimHookInvocation extends UserPluginHookDiagnostic {
  pluginId: string
  digest: string
  hookId: string
  boundaryId: string
  messageId: string
  launchId: string
  content?: string
  matcher: string
  payload?: Record<string, JsonValue>
  inputTooLarge?: boolean
  legacy?: { entryId: number; productSessionId: string }
}

/** Read-only archive conversion. This port never accepts input or executes commands. */
export function readLegacyPluginHooks(
  database: SessionDatabase,
  sessionId: string
): DimHookInvocation[] {
  const latest = new Map<string, DimHookInvocation>()
  for (const row of database.legacyTape.getBySession(sessionId, 'plugin/context-hook')) {
    try {
      const old = JSON.parse(row.payload_json)?.state
      if (
        !old ||
        old.sessionId !== sessionId ||
        !['pluginId', 'digest', 'hookId', 'boundaryId', 'messageId', 'invocationId'].every(
          (key) => typeof old[key] === 'string' && old[key].length > 0 && old[key].length <= 4096
        ) ||
        !['SessionStart', 'SubagentStart', 'UserPromptSubmit'].includes(old.event) ||
        !['started', 'completed', 'failed', 'uncertain'].includes(old.status) ||
        !Number.isSafeInteger(old.at) ||
        old.at < 0
      )
        continue
      const expected = createHash('sha256')
        .update(
          JSON.stringify([
            old.pluginId,
            old.digest,
            sessionId,
            old.hookId,
            ...(old.hookId === '$session' ? [] : [old.boundaryId])
          ])
        )
        .digest('hex')
      if (old.invocationId !== expected) continue
      const input = old.input
      const retryable =
        input &&
        input.sessionId === sessionId &&
        input.messageId === old.messageId &&
        typeof input.prompt === 'string' &&
        Buffer.byteLength(input.prompt) <= 1024 * 1024 &&
        (input.cwd === null || typeof input.cwd === 'string') &&
        typeof input.model === 'string' &&
        (input.parentSessionId === undefined || typeof input.parentSessionId === 'string') &&
        (input.agentId === undefined || typeof input.agentId === 'string')
      const source = old.event === 'SessionStart' ? old.boundaryId.split(':')[0] : undefined
      const matcher =
        old.event === 'SessionStart'
          ? source
          : old.event === 'SubagentStart'
            ? retryable
              ? (input.agentId ?? '')
              : ''
            : ''
      const payload: Record<string, JsonValue> | undefined = retryable
        ? {
            session_id:
              old.event === 'SubagentStart' && input.parentSessionId
                ? input.parentSessionId
                : sessionId,
            hook_event_name: old.event,
            cwd: input.cwd,
            transcript_path: null,
            model: input.model,
            ...(source ? { source } : {}),
            ...(old.event === 'UserPromptSubmit' ? { prompt: input.prompt } : {}),
            ...(old.event === 'SubagentStart'
              ? { agent_id: sessionId, agent_type: input.agentId ?? 'deepchat' }
              : {})
          }
        : undefined
      latest.delete(old.invocationId)
      latest.set(old.invocationId, {
        invocationId: old.invocationId,
        pluginId: old.pluginId,
        digest: old.digest,
        hookId: old.hookId,
        boundaryId: old.boundaryId,
        messageId: old.messageId,
        sessionId,
        event: old.event,
        status: old.status === 'started' ? 'uncertain' : old.status,
        at: old.at,
        launchId: `legacy:${typeof old.source === 'string' ? old.source : 'unknown'}`,
        matcher,
        ...(typeof old.message === 'string' ? { message: old.message.slice(0, 1024) } : {}),
        ...(old.status === 'completed' &&
        typeof old.content === 'string' &&
        Buffer.byteLength(old.content) <= 8192
          ? { content: old.content }
          : {}),
        ...(old.status !== 'completed' &&
        payload &&
        Buffer.byteLength(JSON.stringify(payload)) <= 1024 * 1024
          ? { payload }
          : {}),
        legacy: { entryId: row.entry_id, productSessionId: sessionId }
      })
    } catch {
      // Malformed archived rows remain inspectable; they cannot become executable retry input.
    }
  }
  return [...latest.values()]
}
