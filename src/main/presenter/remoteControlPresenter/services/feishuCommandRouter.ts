import type { ToolInteractionResponse } from '@shared/types/agent-interface'
import type { SessionWithState } from '@shared/types/agent-interface'
import type {
  FeishuInboundMessage,
  FeishuOutboundAction,
  FeishuRuntimeStatusSnapshot,
  RemotePendingInteraction,
  TelegramModelProviderOption
} from '../types'
import { FEISHU_REMOTE_COMMANDS, buildFeishuBindingMeta, buildFeishuEndpointKey } from '../types'
import type { RemoteConversationExecution } from './remoteConversationRunner'
import { buildFeishuPendingInteractionCard } from '../feishu/feishuInteractionPrompt'
import { FeishuAuthGuard } from './feishuAuthGuard'
import { RemoteBindingStore } from './remoteBindingStore'
import { RemoteConversationRunner } from './remoteConversationRunner'

export interface FeishuCommandRouteResult {
  replies: string[]
  outboundActions?: FeishuOutboundAction[]
  conversation?: RemoteConversationExecution
}

type FeishuCommandRouterDeps = {
  authGuard: FeishuAuthGuard
  runner: RemoteConversationRunner
  bindingStore: RemoteBindingStore
  getRuntimeStatus: () => FeishuRuntimeStatusSnapshot
}

const FEISHU_PENDING_ALLOWED_COMMANDS = new Set(['start', 'help', 'status', 'open', 'pending'])

export class FeishuCommandRouter {
  constructor(private readonly deps: FeishuCommandRouterDeps) {}

  async handleMessage(message: FeishuInboundMessage): Promise<FeishuCommandRouteResult> {
    const endpointKey = buildFeishuEndpointKey(message.chatId, message.threadId)
    const bindingMeta = buildFeishuBindingMeta({
      chatId: message.chatId,
      threadId: message.threadId,
      chatType: message.chatType
    })
    const command = message.command?.name

    if (command === 'start') {
      const auth = this.deps.authGuard.ensureAuthorized(message)
      if (!auth.ok && auth.silent) {
        return {
          replies: []
        }
      }

      return {
        replies: [this.formatStartMessage(auth.ok)]
      }
    }

    if (command === 'help') {
      if (message.chatType !== 'p2p' && !message.mentionedBot) {
        return {
          replies: []
        }
      }

      return {
        replies: [this.formatHelpMessage()]
      }
    }

    if (command === 'pair') {
      return {
        replies: [this.deps.authGuard.pair(message, message.command?.args ?? '')]
      }
    }

    const auth = this.deps.authGuard.ensureAuthorized(message)
    if (!auth.ok) {
      return {
        replies: auth.silent ? [] : [auth.message]
      }
    }

    try {
      const pendingInteraction = await this.deps.runner.getPendingInteraction(endpointKey)
      if (pendingInteraction) {
        if (!command) {
          return await this.handlePendingTextResponse(endpointKey, message.text, pendingInteraction)
        }

        if (command === 'pending') {
          return this.buildPendingPromptResult(pendingInteraction)
        }

        if (!FEISHU_PENDING_ALLOWED_COMMANDS.has(command)) {
          return {
            replies: [this.formatPendingCommandBlockedMessage(pendingInteraction)]
          }
        }
      }

      switch (command) {
        case 'new': {
          const title = message.command?.args?.trim()
          const session = await this.deps.runner.createNewSession(endpointKey, title, bindingMeta)
          return {
            replies: [`Started a new session: ${this.formatSessionLabel(session)}`]
          }
        }

        case 'sessions': {
          const sessions = await this.deps.runner.listSessions(endpointKey)
          if (sessions.length === 0) {
            return {
              replies: ['No DeepChat sessions were found.']
            }
          }

          return {
            replies: [
              [
                'Recent sessions:',
                ...sessions.map((session, index) => this.formatSessionLine(session, index + 1))
              ].join('\n')
            ]
          }
        }

        case 'use': {
          const rawIndex = message.command?.args?.trim()
          const index = Number.parseInt(rawIndex ?? '', 10)
          if (!Number.isInteger(index) || index <= 0) {
            return {
              replies: ['Usage: /use <index>']
            }
          }

          const session = await this.deps.runner.useSessionByIndex(
            endpointKey,
            index - 1,
            bindingMeta
          )
          return {
            replies: [`Now using: ${this.formatSessionLabel(session)}`]
          }
        }

        case 'stop': {
          const stopped = await this.deps.runner.stop(endpointKey)
          return {
            replies: [
              stopped ? 'Stopped the active generation.' : 'There is no active generation to stop.'
            ]
          }
        }

        case 'open': {
          const openResult = await this.deps.runner.open(endpointKey)
          return {
            replies: [
              openResult.status === 'ok'
                ? `Opened on desktop: ${this.formatSessionLabel(openResult.session)}`
                : openResult.status === 'windowNotFound'
                  ? 'Could not find a DeepChat desktop window. Open DeepChat and try /open again.'
                  : 'No bound session. Send a message, /new, or /use first.'
            ]
          }
        }

        case 'pending':
          return {
            replies: ['No pending interaction is waiting.']
          }

        case 'model':
          return await this.handleModelCommand(message, endpointKey)

        case 'status': {
          const runtime = this.deps.getRuntimeStatus()
          const status = await this.deps.runner.getStatus(endpointKey)
          const defaultAgentId = await this.deps.runner.getDefaultAgentId()
          const feishuConfig = this.deps.bindingStore.getFeishuConfig()
          return {
            replies: [
              [
                'DeepChat Feishu Remote',
                `Runtime: ${runtime.state}`,
                `Default agent: ${defaultAgentId}`,
                `Current session: ${status.session ? this.formatSessionLabel(status.session) : 'none'}`,
                `Current agent: ${status.session?.agentId ?? 'none'}`,
                `Current model: ${status.session?.modelId ?? 'none'}`,
                `Generating: ${status.isGenerating ? 'yes' : 'no'}`,
                `Waiting: ${status.pendingInteraction ? this.formatPendingStatus(status.pendingInteraction) : 'none'}`,
                `Paired users: ${feishuConfig.pairedUserOpenIds.length}`,
                `Bindings: ${Object.keys(feishuConfig.bindings).length}`,
                `Last error: ${runtime.lastError ?? 'none'}`
              ].join('\n')
            ]
          }
        }

        default:
          break
      }

      return {
        replies: [],
        conversation: await this.deps.runner.sendText(endpointKey, message.text, bindingMeta)
      }
    } catch (error) {
      return {
        replies: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  private async handleModelCommand(
    message: FeishuInboundMessage,
    endpointKey: string
  ): Promise<FeishuCommandRouteResult> {
    const session = await this.deps.runner.getCurrentSession(endpointKey)
    if (!session) {
      return {
        replies: ['No bound session. Send a message, /new, or /use first.']
      }
    }

    const providers = await this.deps.runner.listAvailableModelProviders()
    if (providers.length === 0) {
      return {
        replies: ['No enabled providers or models are available.']
      }
    }

    const rawArgs = message.command?.args?.trim() ?? ''
    if (!rawArgs) {
      return {
        replies: [this.formatModelOverview(session, providers)]
      }
    }

    const [providerId, ...modelParts] = rawArgs.split(/\s+/)
    const modelId = modelParts.join(' ').trim()
    if (!providerId || !modelId) {
      return {
        replies: ['Usage: /model <providerId> <modelId>']
      }
    }

    const provider = providers.find((item) => item.providerId === providerId)
    const model = provider?.models.find((item) => item.modelId === modelId)
    if (!provider || !model) {
      return {
        replies: [
          `Model "${providerId} ${modelId}" is not enabled.\n\n${this.formatModelOverview(session, providers)}`
        ]
      }
    }

    const updatedSession = await this.deps.runner.setSessionModel(
      endpointKey,
      provider.providerId,
      model.modelId
    )

    return {
      replies: [
        [
          'Model updated.',
          `Session: ${this.formatSessionLabel(updatedSession)}`,
          `Provider: ${provider.providerName}`,
          `Model: ${model.modelName}`
        ].join('\n')
      ]
    }
  }

  private async handlePendingTextResponse(
    endpointKey: string,
    text: string,
    interaction: RemotePendingInteraction
  ): Promise<FeishuCommandRouteResult> {
    const response = this.resolvePendingTextResponse(text, interaction)
    if (!response) {
      return {
        replies: [this.formatPendingTextReplyHint(interaction)]
      }
    }

    const result = await this.deps.runner.respondToPendingInteraction(endpointKey, response)
    return {
      replies: [
        result.waitingForUserMessage
          ? 'Reply with your answer in your next message.'
          : this.describeInteractionResponse(interaction, response)
      ],
      ...(result.execution ? { conversation: result.execution } : {})
    }
  }

  private buildPendingPromptResult(
    interaction: RemotePendingInteraction
  ): FeishuCommandRouteResult {
    return {
      replies: [],
      outboundActions: [
        {
          type: 'sendCard',
          card: buildFeishuPendingInteractionCard(interaction),
          fallbackText: this.formatPendingTextReplyHint(interaction)
        }
      ]
    }
  }

  private resolvePendingTextResponse(
    text: string,
    interaction: RemotePendingInteraction
  ): ToolInteractionResponse | null {
    const normalized = text.trim()
    if (!normalized) {
      return null
    }

    if (interaction.type === 'permission') {
      const lowered = normalized.toLowerCase()
      if (lowered === 'allow') {
        return { kind: 'permission', granted: true }
      }
      if (lowered === 'deny') {
        return { kind: 'permission', granted: false }
      }
      return null
    }

    const question = interaction.question
    if (!question) {
      return null
    }

    if (!question.multiple) {
      const optionIndex = Number.parseInt(normalized, 10)
      if (
        Number.isInteger(optionIndex) &&
        optionIndex > 0 &&
        optionIndex <= question.options.length
      ) {
        return {
          kind: 'question_option',
          optionLabel: question.options[optionIndex - 1].label
        }
      }

      const matchedOption = question.options.find(
        (option) =>
          option.label.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0
      )
      if (matchedOption) {
        return {
          kind: 'question_option',
          optionLabel: matchedOption.label
        }
      }
    }

    if (question.multiple || question.custom !== false) {
      return {
        kind: 'question_custom',
        answerText: normalized
      }
    }

    return null
  }

  private describeInteractionResponse(
    interaction: RemotePendingInteraction,
    response: ToolInteractionResponse
  ): string {
    if (interaction.type === 'permission' && response.kind === 'permission') {
      return response.granted ? 'Approved. Continuing...' : 'Denied.'
    }

    if (response.kind === 'question_option') {
      return `Selected: ${response.optionLabel}`
    }

    if (response.kind === 'question_custom') {
      return `Answer received: ${response.answerText.trim()}`
    }

    return 'Reply with your answer in a new message.'
  }

  private formatModelOverview(
    session: SessionWithState,
    providers: TelegramModelProviderOption[]
  ): string {
    return [
      `Session: ${this.formatSessionLabel(session)}`,
      `Current model: ${session.modelId ?? 'none'}`,
      'Usage: /model <providerId> <modelId>',
      '',
      'Available models:',
      ...providers.flatMap((provider) => [
        `${provider.providerName} (${provider.providerId})`,
        ...provider.models.map(
          (model) => `- ${model.modelName} (${provider.providerId} ${model.modelId})`
        )
      ])
    ].join('\n')
  }

  private formatPendingTextReplyHint(interaction: RemotePendingInteraction): string {
    if (interaction.type === 'permission') {
      return 'Reply with ALLOW or DENY.'
    }

    if (interaction.question?.multiple) {
      return 'Reply with your answer in plain text.'
    }

    if (interaction.question?.custom !== false) {
      return 'Reply with an option number, exact label, or your own answer.'
    }

    return 'Reply with an option number or exact label.'
  }

  private formatPendingCommandBlockedMessage(interaction: RemotePendingInteraction): string {
    return `Resolve the pending ${interaction.type} first. Send /pending to review it again.`
  }

  private formatPendingStatus(interaction: RemotePendingInteraction): string {
    const toolLabel = interaction.toolName.trim() || 'unknown tool'
    return `${interaction.type} via ${toolLabel}`
  }

  private formatStartMessage(isAuthorized: boolean): string {
    if (isAuthorized) {
      return [
        'DeepChat Feishu Remote is ready.',
        'Send any message to continue the bound session, or /help for commands.'
      ].join('\n')
    }

    return [
      'DeepChat Feishu Remote is online.',
      'Pair first from a direct message with /pair <code> before using group control.'
    ].join('\n')
  }

  private formatHelpMessage(): string {
    return [
      'DeepChat Feishu Remote commands:',
      ...FEISHU_REMOTE_COMMANDS.map((item) => `/${item.command} - ${item.description}`),
      'Plain text sends to the current bound session unless a tool interaction is waiting.'
    ].join('\n')
  }

  private formatSessionLabel(session: Pick<SessionWithState, 'id' | 'title'>): string {
    return `${session.title} [${session.id}]`
  }

  private formatSessionLine(session: SessionWithState, index: number): string {
    return `${index}. ${session.title} [${session.id}]`
  }
}
