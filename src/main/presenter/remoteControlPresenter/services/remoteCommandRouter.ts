import type {
  TelegramCallbackAnswer,
  TelegramInboundCallbackQuery,
  TelegramInboundEvent,
  TelegramInboundMessage,
  TelegramInlineKeyboardMarkup,
  TelegramModelProviderOption,
  TelegramOutboundAction,
  TelegramPollerStatusSnapshot
} from '../types'
import {
  TELEGRAM_MODEL_MENU_TTL_MS,
  TELEGRAM_REMOTE_COMMANDS,
  buildModelMenuBackCallbackData,
  buildModelMenuCancelCallbackData,
  buildModelMenuChoiceCallbackData,
  buildModelMenuProviderCallbackData,
  parseModelMenuCallbackData
} from '../types'
import type { RemoteConversationExecution } from './remoteConversationRunner'
import { RemoteAuthGuard } from './remoteAuthGuard'
import { RemoteBindingStore } from './remoteBindingStore'
import { RemoteConversationRunner } from './remoteConversationRunner'

export interface RemoteCommandRouteResult {
  replies: string[]
  outboundActions?: TelegramOutboundAction[]
  conversation?: RemoteConversationExecution
  callbackAnswer?: TelegramCallbackAnswer
}

type RemoteCommandRouterDeps = {
  authGuard: RemoteAuthGuard
  runner: RemoteConversationRunner
  bindingStore: RemoteBindingStore
  getPollerStatus: () => TelegramPollerStatusSnapshot
}

export class RemoteCommandRouter {
  constructor(private readonly deps: RemoteCommandRouterDeps) {}

  async handleMessage(event: TelegramInboundEvent): Promise<RemoteCommandRouteResult> {
    if (event.kind === 'callback_query') {
      return await this.handleCallbackQuery(event)
    }

    return await this.handleTextMessage(event)
  }

  private async handleTextMessage(
    message: TelegramInboundMessage
  ): Promise<RemoteCommandRouteResult> {
    const endpointKey = this.deps.bindingStore.getEndpointKey(message)
    const command = message.command?.name

    if (command === 'start') {
      const auth = this.deps.authGuard.ensureAuthorized(message)
      return {
        replies: [this.formatStartMessage(auth.ok)]
      }
    }

    if (command === 'help') {
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
        replies: [auth.message]
      }
    }

    try {
      switch (command) {
        case 'new': {
          const title = message.command?.args?.trim()
          const session = await this.deps.runner.createNewSession(endpointKey, title)
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

          const session = await this.deps.runner.useSessionByIndex(endpointKey, index - 1)
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

        case 'model': {
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

          const token = this.deps.bindingStore.createModelMenuState(
            endpointKey,
            session.id,
            providers
          )

          return {
            replies: [],
            outboundActions: [
              {
                type: 'sendMessage',
                text: this.formatProviderMenuText(session),
                replyMarkup: this.buildProviderMenuKeyboard(token, providers)
              }
            ]
          }
        }

        case 'status': {
          const runtime = this.deps.getPollerStatus()
          const status = await this.deps.runner.getStatus(endpointKey)
          const defaultAgentId = await this.deps.runner.getDefaultAgentId()
          const telegramConfig = this.deps.bindingStore.getTelegramConfig()
          return {
            replies: [
              [
                'DeepChat Telegram Remote',
                `Runtime: ${runtime.state}`,
                `Stream mode: ${telegramConfig.streamMode}`,
                `Default agent: ${defaultAgentId}`,
                `Current session: ${status.session ? this.formatSessionLabel(status.session) : 'none'}`,
                `Current agent: ${status.session?.agentId ?? 'none'}`,
                `Current model: ${status.session?.modelId ?? 'none'}`,
                `Generating: ${status.isGenerating ? 'yes' : 'no'}`,
                `Allowed users: ${telegramConfig.allowlist.length}`,
                `Bindings: ${Object.keys(telegramConfig.bindings).length}`,
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
        conversation: await this.deps.runner.sendText(endpointKey, message.text)
      }
    } catch (error) {
      return {
        replies: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  private async handleCallbackQuery(
    event: TelegramInboundCallbackQuery
  ): Promise<RemoteCommandRouteResult> {
    const endpointKey = this.deps.bindingStore.getEndpointKey(event)
    const auth = this.deps.authGuard.ensureAuthorized(event)
    if (!auth.ok) {
      return {
        replies: [],
        callbackAnswer: {
          text: auth.message,
          showAlert: true
        }
      }
    }

    const callback = parseModelMenuCallbackData(event.data)
    if (!callback) {
      return {
        replies: [],
        callbackAnswer: {
          text: 'Unsupported Telegram remote action.',
          showAlert: false
        }
      }
    }

    const state = this.deps.bindingStore.getModelMenuState(
      callback.token,
      TELEGRAM_MODEL_MENU_TTL_MS
    )
    const expiredResult = this.buildExpiredMenuResult(event.messageId)
    if (!state || state.endpointKey !== endpointKey) {
      return expiredResult
    }

    const session = await this.deps.runner.getCurrentSession(endpointKey)
    if (!session || session.id !== state.sessionId) {
      this.deps.bindingStore.clearModelMenuState(callback.token)
      return expiredResult
    }

    try {
      switch (callback.action) {
        case 'provider': {
          const provider = state.providers[callback.providerIndex]
          if (!provider) {
            return expiredResult
          }

          return {
            replies: [],
            outboundActions: [
              {
                type: 'editMessageText',
                messageId: event.messageId,
                text: this.formatModelMenuText(session, provider),
                replyMarkup: this.buildModelMenuKeyboard(
                  callback.token,
                  callback.providerIndex,
                  provider
                )
              }
            ]
          }
        }

        case 'model': {
          const provider = state.providers[callback.providerIndex]
          const model = provider?.models[callback.modelIndex]
          if (!provider || !model) {
            return expiredResult
          }

          const updatedSession = await this.deps.runner.setSessionModel(
            endpointKey,
            provider.providerId,
            model.modelId
          )
          this.deps.bindingStore.clearModelMenuState(callback.token)

          return {
            replies: [],
            outboundActions: [
              {
                type: 'editMessageText',
                messageId: event.messageId,
                text: [
                  'Model updated.',
                  `Session: ${this.formatSessionLabel(updatedSession)}`,
                  `Provider: ${provider.providerName}`,
                  `Model: ${model.modelName}`
                ].join('\n'),
                replyMarkup: null
              }
            ],
            callbackAnswer: {
              text: 'Model switched.'
            }
          }
        }

        case 'back':
          return {
            replies: [],
            outboundActions: [
              {
                type: 'editMessageText',
                messageId: event.messageId,
                text: this.formatProviderMenuText(session),
                replyMarkup: this.buildProviderMenuKeyboard(callback.token, state.providers)
              }
            ]
          }

        case 'cancel':
          this.deps.bindingStore.clearModelMenuState(callback.token)
          return {
            replies: [],
            outboundActions: [
              {
                type: 'editMessageText',
                messageId: event.messageId,
                text: 'Model selection cancelled.',
                replyMarkup: null
              }
            ],
            callbackAnswer: {
              text: 'Cancelled.'
            }
          }
      }
    } catch (error) {
      return {
        replies: [],
        callbackAnswer: {
          text: error instanceof Error ? error.message : String(error),
          showAlert: true
        }
      }
    }
  }

  private buildExpiredMenuResult(messageId: number): RemoteCommandRouteResult {
    return {
      replies: [],
      outboundActions: [
        {
          type: 'editMessageText',
          messageId,
          text: 'Model menu expired. Run /model again.',
          replyMarkup: null
        }
      ],
      callbackAnswer: {
        text: 'Model menu expired. Run /model again.',
        showAlert: true
      }
    }
  }

  private buildProviderMenuKeyboard(
    token: string,
    providers: TelegramModelProviderOption[]
  ): TelegramInlineKeyboardMarkup {
    return {
      inline_keyboard: [
        ...providers.map((provider, index) => [
          {
            text: provider.providerName,
            callback_data: buildModelMenuProviderCallbackData(token, index)
          }
        ]),
        [
          {
            text: 'Cancel',
            callback_data: buildModelMenuCancelCallbackData(token)
          }
        ]
      ]
    }
  }

  private buildModelMenuKeyboard(
    token: string,
    providerIndex: number,
    provider: TelegramModelProviderOption
  ): TelegramInlineKeyboardMarkup {
    return {
      inline_keyboard: [
        ...provider.models.map((model, modelIndex) => [
          {
            text: model.modelName,
            callback_data: buildModelMenuChoiceCallbackData(token, providerIndex, modelIndex)
          }
        ]),
        [
          {
            text: 'Back',
            callback_data: buildModelMenuBackCallbackData(token)
          },
          {
            text: 'Cancel',
            callback_data: buildModelMenuCancelCallbackData(token)
          }
        ]
      ]
    }
  }

  private formatStartMessage(isAuthorized: boolean): string {
    const statusLine = isAuthorized
      ? 'Status: paired'
      : 'Status: not paired. Use /pair <code> from DeepChat Remote settings.'

    return [
      'DeepChat Telegram remote control is ready.',
      statusLine,
      'Use /help to see the available commands.'
    ].join('\n')
  }

  private formatHelpMessage(): string {
    return [
      'Commands:',
      ...TELEGRAM_REMOTE_COMMANDS.map((item) =>
        item.command === 'pair'
          ? '/pair <code> - Authorize this Telegram account'
          : item.command === 'new'
            ? '/new [title] - Start a new DeepChat session'
            : item.command === 'use'
              ? '/use <index> - Bind a listed session'
              : `/${item.command} - ${item.description}`
      ),
      'Plain text sends to the current bound session.'
    ].join('\n')
  }

  private formatProviderMenuText(session: {
    title: string
    id: string
    providerId: string
    modelId: string
  }): string {
    return [
      `Session: ${this.formatSessionLabel(session)}`,
      `Current: ${session.providerId || 'none'} / ${session.modelId || 'none'}`,
      'Choose a provider:'
    ].join('\n')
  }

  private formatModelMenuText(
    session: { title: string; id: string; providerId: string; modelId: string },
    provider: TelegramModelProviderOption
  ): string {
    return [
      `Session: ${this.formatSessionLabel(session)}`,
      `Current: ${session.providerId || 'none'} / ${session.modelId || 'none'}`,
      `Provider: ${provider.providerName}`,
      'Choose a model:'
    ].join('\n')
  }

  private formatSessionLine(
    session: { title: string; id: string; status: string },
    index: number
  ): string {
    return `${index}. ${session.title || 'Untitled'} (${session.status})`
  }

  private formatSessionLabel(session: { title: string; id: string }): string {
    const title = session.title?.trim() || 'Untitled'
    return `${title} [${session.id}]`
  }
}
