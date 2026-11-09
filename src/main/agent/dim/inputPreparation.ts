import type { JsonValue } from '@shared/contracts/json'
import type { ChatMessage, ChatMessageContent } from '@shared/types/core/chat-message'
import type { SendMessageInput, UserMessageContent } from '@shared/types/agent-interface'
import type { AttachmentPreparationPort } from '@shared/types/attachment'
import { buildUserMessageContent, normalizeUserInput } from '@/agent/shared/inputContent'
import { dimContentBlocks } from './auxiliaryModels'
import type { DimPreparedInput } from './backend'

interface InputPreparationOptions {
  capabilities(sessionId: string): { vision: boolean; audio: boolean }
  attachments: AttachmentPreparationPort
  // Audio preparation is supplied by the native media integration, never a TS provider.
  audio?(
    part: Extract<ChatMessageContent, { type: 'input_audio' }>,
    signal?: AbortSignal
  ): Promise<JsonValue[]>
}

/** Product attachment choices and presentation; no admission, history writes or queue ownership. */
export class DimInputPreparation {
  constructor(private readonly options: InputPreparationOptions) {}

  readonly prepare = async (
    sessionId: string,
    input: SendMessageInput,
    signal?: AbortSignal,
    options?: { preserveResolvedRepresentations?: boolean }
  ): Promise<DimPreparedInput> => {
    signal?.throwIfAborted()
    const capability = this.options.capabilities(sessionId)
    const prepared = await this.options.attachments.prepare({
      content: normalizeUserInput(input),
      supportsVision: capability.vision,
      signal,
      preserveResolvedRepresentations: options?.preserveResolvedRepresentations
    })
    signal?.throwIfAborted()
    const representation: UserMessageContent = {
      text: prepared.content.text,
      files: prepared.content.files ?? [],
      links: [],
      search: prepared.content.search === true,
      think: false,
      ...(prepared.content.activeSkills?.length
        ? { activeSkills: prepared.content.activeSkills }
        : {}),
      ...(prepared.content.inlineItems?.length ? { inlineItems: prepared.content.inlineItems } : {})
    }
    if (prepared.summary.status === 'needs_user_action')
      return {
        content: [],
        representation: representation as unknown as JsonValue,
        summary: prepared.summary
      }
    const formatted = buildUserMessageContent(
      prepared.content,
      capability.vision,
      capability.audio,
      {
        includeImageData: true,
        includeAudioData: true,
        includeFileContent: false
      }
    )
    return {
      content: await this.blocks(formatted, signal),
      representation: representation as unknown as JsonValue,
      summary: prepared.summary
    }
  }

  private async blocks(
    content: ChatMessage['content'],
    signal?: AbortSignal
  ): Promise<JsonValue[]> {
    if (typeof content === 'string') return dimContentBlocks(content)
    const blocks: JsonValue[] = []
    for (const part of content ?? []) {
      signal?.throwIfAborted()
      if (part.type === 'input_audio') {
        if (!this.options.audio) throw new Error('Native audio preparation is unavailable')
        blocks.push(...(await this.options.audio(part, signal)))
      } else blocks.push(...dimContentBlocks([part]))
    }
    signal?.throwIfAborted()
    return blocks
  }
}
