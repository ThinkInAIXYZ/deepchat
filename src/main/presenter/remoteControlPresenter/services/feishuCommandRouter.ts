import type { SessionWithState } from '@shared/types/agent-interface'
import {
  FEISHU_REMOTE_COMMANDS,
  buildFeishuBindingMeta,
  buildFeishuEndpointKey,
  type FeishuInboundMessage,
  type FeishuRuntimeStatusSnapshot,
  type TelegramModelProviderOption
} from '../types'
import type { RemoteConversationExecution } from './remoteConversationRunner'
import { FeishuAuthGuard } from './feishuAuthGuard'
import { RemoteBindingStore } from './remoteBindingStore'
import { RemoteConversationRunner } from './remoteConversationRunner'

export interface FeishuCommandRouteResult {
  replies: string[]
  conversation?: RemoteConversationExecution
}

type FeishuCommandRouterDeps = {
  authGuard: FeishuAuthGuard
  runner: RemoteConversationRunner
  bindingStore: RemoteBindingStore
  getRuntimeStatus: () => FeishuRuntimeStatusSnapshot
}

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
          const session = await this.deps.runner.open(endpointKey)
          return {
            replies: [
              session
                ? `Opened on desktop: ${this.formatSessionLabel(session)}`
                : 'No bound session. Send a message, /new, or /use first.'
            ]
          }
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
      ...FEISHU_REMOTE_COMMANDS.map((item) => `/${item.command} - ${item.description}`)
    ].join('\n')
  }

  private formatSessionLabel(session: Pick<SessionWithState, 'id' | 'title'>): string {
    return `${session.title} [${session.id}]`
  }

  private formatSessionLine(session: SessionWithState, index: number): string {
    return `${index}. ${session.title} [${session.id}]`
  }
}
