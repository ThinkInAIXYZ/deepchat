import type { ToolInteractionResponse, SessionWithState } from '@shared/types/agent-interface'
import type {
  RemotePendingInteraction,
  TelegramModelProviderOption,
  WeixinIlinkInboundMessage,
  WeixinIlinkRuntimeStatusSnapshot
} from '../types'
import { buildWeixinIlinkBindingMeta, buildWeixinIlinkEndpointKey } from '../types'
import type { RemoteConversationExecution } from './remoteConversationRunner'
import { RemoteBindingStore } from './remoteBindingStore'
import { RemoteConversationRunner } from './remoteConversationRunner'
import { WeixinIlinkAuthGuard } from './weixinIlinkAuthGuard'

export interface WeixinIlinkCommandRouteResult {
  replies: string[]
  conversation?: RemoteConversationExecution
}

type WeixinIlinkCommandRouterDeps = {
  authGuard: WeixinIlinkAuthGuard
  runner: RemoteConversationRunner
  bindingStore: RemoteBindingStore
  getRuntimeStatus: () => WeixinIlinkRuntimeStatusSnapshot
}

const PENDING_ALLOWED_COMMANDS = new Set(['start', 'help', 'status', 'open', 'pending'])

const COMMANDS: Array<{
  command: string
  description: string
}> = [
  {
    command: 'start',
    description: 'Show remote control status'
  },
  {
    command: 'help',
    description: 'Show available commands'
  },
  {
    command: 'new',
    description: 'Start a new session'
  },
  {
    command: 'sessions',
    description: 'List recent sessions'
  },
  {
    command: 'use',
    description: 'Bind a listed session'
  },
  {
    command: 'stop',
    description: 'Stop the active generation'
  },
  {
    command: 'open',
    description: 'Open the current session on desktop'
  },
  {
    command: 'pending',
    description: 'Show the current pending interaction'
  },
  {
    command: 'model',
    description: 'View or switch the current model'
  },
  {
    command: 'status',
    description: 'Show runtime and session status'
  }
]

export class WeixinIlinkCommandRouter {
  constructor(private readonly deps: WeixinIlinkCommandRouterDeps) {}

  async handleMessage(message: WeixinIlinkInboundMessage): Promise<WeixinIlinkCommandRouteResult> {
    const endpointKey = buildWeixinIlinkEndpointKey(message.accountId, message.userId)
    const bindingMeta = buildWeixinIlinkBindingMeta({
      userId: message.userId
    })
    const command = message.command?.name

    if (command === 'start') {
      const auth = this.deps.authGuard.ensureAuthorized(message)
      return {
        replies: [this.formatStartMessage(auth.ok, message.accountId)]
      }
    }

    if (command === 'help') {
      return {
        replies: [this.formatHelpMessage()]
      }
    }

    if (command === 'pair') {
      return {
        replies: ['Weixin iLink pairing is not available yet. Use QR login with the owner account.']
      }
    }

    const auth = this.deps.authGuard.ensureAuthorized(message)
    if (!auth.ok) {
      return {
        replies: [auth.message]
      }
    }

    try {
      const pendingInteraction = await this.deps.runner.getPendingInteraction(endpointKey)
      if (pendingInteraction) {
        if (!command) {
          return await this.handlePendingTextResponse(endpointKey, message.text, pendingInteraction)
        }

        if (command === 'pending') {
          return {
            replies: [this.formatPendingInteraction(pendingInteraction)]
          }
        }

        if (!PENDING_ALLOWED_COMMANDS.has(command)) {
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
              replies: ['No sessions were found.']
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
          const account = this.deps.bindingStore.getWeixinIlinkAccount(message.accountId)
          return {
            replies: [
              [
                'DeepChat Weixin iLink Remote',
                `Runtime: ${runtime.state}`,
                `Account: ${message.accountId}`,
                `Owner: ${account?.ownerUserId ?? 'unknown'}`,
                `Default agent: ${defaultAgentId}`,
                `Current session: ${status.session ? this.formatSessionLabel(status.session) : 'none'}`,
                `Current agent: ${status.session?.agentId ?? 'none'}`,
                `Current model: ${status.session?.modelId ?? 'none'}`,
                `Current workdir: ${status.session?.projectDir?.trim() || 'none'}`,
                `Generating: ${status.isGenerating ? 'yes' : 'no'}`,
                `Waiting: ${status.pendingInteraction ? this.formatPendingStatus(status.pendingInteraction) : 'none'}`,
                `Bindings: ${Object.keys(account?.bindings ?? {}).length}`,
                `Last error: ${runtime.lastError ?? account?.lastFatalError ?? 'none'}`
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
    message: WeixinIlinkInboundMessage,
    endpointKey: string
  ): Promise<WeixinIlinkCommandRouteResult> {
    const session = await this.deps.runner.getCurrentSession(endpointKey)
    if (!session) {
      return {
        replies: ['No bound session. Send a message, /new, or /use first.']
      }
    }

    if (await this.deps.runner.isSessionModelLocked(session)) {
      return {
        replies: ['ACP sessions lock the model. Change the channel default agent instead.']
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
  ): Promise<WeixinIlinkCommandRouteResult> {
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
      if (/^\d+$/.test(normalized)) {
        const optionIndex = Number.parseInt(normalized, 10)
        if (optionIndex > 0 && optionIndex <= question.options.length) {
          return {
            kind: 'question_option',
            optionLabel: question.options[optionIndex - 1].label
          }
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
    if (interaction.type === 'permission') {
      return response.kind === 'permission' && response.granted
        ? 'Permission granted.'
        : 'Permission denied.'
    }

    return response.kind === 'question_option'
      ? `Selected option: ${response.optionLabel}`
      : 'Answer received.'
  }

  private formatPendingInteraction(interaction: RemotePendingInteraction): string {
    if (interaction.type === 'permission') {
      const permission = interaction.permission
      return [
        `Pending permission: ${permission?.description || interaction.toolName}`,
        'Reply with "allow" or "deny".'
      ].join('\n')
    }

    const question = interaction.question
    return [
      question?.question || 'Pending question',
      ...(question?.options.map((option, index) => `${index + 1}. ${option.label}`) ?? [])
    ].join('\n')
  }

  private formatPendingCommandBlockedMessage(interaction: RemotePendingInteraction): string {
    return [
      'Finish the current pending interaction first.',
      this.formatPendingInteraction(interaction)
    ].join('\n\n')
  }

  private formatPendingTextReplyHint(interaction: RemotePendingInteraction): string {
    return [
      'That reply could not be matched to the pending interaction.',
      this.formatPendingInteraction(interaction)
    ].join('\n\n')
  }

  private formatPendingStatus(interaction: RemotePendingInteraction): string {
    return interaction.type === 'permission'
      ? interaction.permission?.description || interaction.toolName
      : interaction.question?.question || interaction.toolName
  }

  private formatStartMessage(isAuthorized: boolean, accountId: string): string {
    return [
      'DeepChat Weixin iLink Remote',
      `Account: ${accountId}`,
      isAuthorized
        ? 'This owner account is authorized to control the current bot.'
        : 'This Weixin user is not authorized to control the current bot.',
      'Use /help to view available commands.'
    ].join('\n')
  }

  private formatHelpMessage(): string {
    return [
      'Available commands:',
      ...COMMANDS.map((item) => `/${item.command} - ${item.description}`)
    ].join('\n')
  }

  private formatSessionLabel(session: SessionWithState): string {
    return `${session.title || 'Untitled'} (${session.id})`
  }

  private formatSessionLine(session: SessionWithState, index: number): string {
    return `${index}. ${this.formatSessionLabel(session)}`
  }

  private formatModelOverview(
    session: SessionWithState,
    providers: TelegramModelProviderOption[]
  ): string {
    return [
      `Current model: ${session.providerId || 'none'} ${session.modelId || ''}`.trim(),
      'Available models:',
      ...providers.flatMap((provider) => [
        `${provider.providerId} (${provider.providerName})`,
        ...provider.models.map((model) => `  ${provider.providerId} ${model.modelId}`)
      ])
    ].join('\n')
  }
}
