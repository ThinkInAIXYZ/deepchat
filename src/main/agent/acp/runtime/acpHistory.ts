import { createHash } from 'node:crypto'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import type { AcpHistorySnapshot } from '@shared/types/acp-extensions'
import { AcpContentMapper } from './acpContentMapper'
import { readLodySessionMeta } from './acpLodyExtensions'
import { createState } from '@/agent/deepchat/runtime/types'
import { accumulate } from '@/agent/deepchat/runtime/accumulator'

/** History is staged as a complete ordered response, never merged by matching text. */
export function buildAcpHistory(
  updates: SessionNotification[],
  verifiedComplete: boolean
): AcpHistorySnapshot {
  const digest = createHash('sha256').update(JSON.stringify(updates)).digest('hex')
  const entries: AcpHistorySnapshot['entries'] = []
  let stream = createState()
  let mapper = new AcpContentMapper()
  let role: 'user' | 'assistant' | undefined
  let turnId: string | undefined
  let userText = ''
  const flush = () => {
    if (role && (userText || stream.blocks.length))
      entries.push({
        id: `${digest}:${entries.length}`,
        role,
        turnId,
        text: userText,
        blocks: structuredClone(stream.blocks).map((block) => ({
          ...block,
          status:
            block.status === 'loading' || block.status === 'pending' ? 'success' : block.status
        }))
      })
    stream = createState()
    mapper = new AcpContentMapper()
    userText = ''
  }
  for (const notification of updates) {
    const update = notification.update
    const meta = readLodySessionMeta(update._meta)
    if (meta.task?.skipTranscript) continue
    const nextRole =
      update.sessionUpdate === 'user_message_chunk'
        ? 'user'
        : [
              'agent_message_chunk',
              'agent_thought_chunk',
              'tool_call',
              'tool_call_update'
            ].includes(update.sessionUpdate)
          ? 'assistant'
          : undefined
    if (!nextRole) continue
    if (nextRole !== role || (meta.turnId && turnId && meta.turnId !== turnId)) flush()
    role = nextRole
    turnId = meta.turnId ?? (nextRole === 'assistant' ? turnId : undefined)
    if (update.sessionUpdate === 'user_message_chunk') {
      const content = update.content
      if (content.type === 'text') userText += content.text
      else if (content.type === 'resource_link') userText += `\n${content.uri}`
      else userText += `\n[${content.type}]`
    } else mapper.map(notification).events.forEach((event) => accumulate(stream, event))
  }
  flush()
  return { digest, verifiedComplete, readAt: Date.now(), entries }
}
