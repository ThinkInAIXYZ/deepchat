import type { ToolInteractionResponse } from '@shared/types/agent-interface'
import type {
  RemotePendingInteraction,
  TelegramCallbackAnswer,
  TelegramInboundCallbackQuery,
  TelegramInboundEvent,
  TelegramInboundMessage,
  TelegramInlineKeyboardMarkup,
  TelegramModelProviderOption,
  TelegramOutboundAction,
  TelegramPendingInteractionCallback,
  TelegramPollerStatusSnapshot
} from '../types'
import {
  TELEGRAM_INTERACTION_CALLBACK_TTL_MS,
  TELEGRAM_MODEL_MENU_TTL_MS,
  TELEGRAM_REMOTE_COMMANDS,
  buildModelMenuBackCallbackData,
  buildModelMenuCancelCallbackData,
  buildModelMenuChoiceCallbackData,
  buildModelMenuProviderCallbackData,
  parseModelMenuCallbackData,
  parsePendingInteractionCallbackData
} from '../types'
import {
  buildTelegramInteractionResolvedText,
  buildTelegramPendingInteractionPrompt
} from '../telegram/telegramInteractionPrompt'
import type { RemoteConversationExecution } from './remoteConversationRunner'
import { RemoteAuthGuard } from './remoteAuthGuard'
import { RemoteBindingStore } from './remoteBindingStore'
import { RemoteConversationRunner } from './remoteConversationRunner'

export interface RemoteCommandRouteResult {
  replies: string[]
  outboundActions?: TelegramOutboundAction[]
  conversation?: RemoteConversationExecution
  callbackAnswer?: TelegramCallbackAnswer
  deferred?: Promise<RemoteCommandRouteContinuation>
}

export interface RemoteCommandRouteContinuation {
  replies?: string[]
  outboundActions?: TelegramOutboundAction[]
  conversation?: RemoteConversationExecution
}

type RemoteCommandRouterDeps = {
  authGuard: RemoteAuthGuard
  runner: RemoteConversationRunner
  bindingStore: RemoteBindingStore
  getPollerStatus: () => TelegramPollerStatusSnapshot
}

const TELEGRAM_PENDING_ALLOWED_COMMANDS = new Set(['start', 'help', 'status', 'open', 'pending'])

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
      const pendingInteraction = await this.deps.runner.getPendingInteraction(endpointKey)
      if (pendingInteraction) {
        if (!command) {
          return await this.handlePendingTextResponse(endpointKey, message.text, pendingInteraction)
        }

        if (command === 'pending') {
          return this.buildPendingPromptResult(endpointKey, pendingInteraction)
        }

        if (!TELEGRAM_PENDING_ALLOWED_COMMANDS.has(command)) {
          return {
            replies: [this.formatPendingCommandBlockedMessage(pendingInteraction)]
          }
        }
      }

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

        case 'pending': {
          return {
            replies: ['No pending interaction is waiting.']
          }
        }

        case 'model': {
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
          const defaultWorkdir = await this.deps.runner.getDefaultWorkdir(endpointKey)
          const telegramConfig = this.deps.bindingStore.getTelegramConfig()
          return {
            replies: [
              [
                'DeepChat Telegram Remote',
                `Runtime: ${runtime.state}`,
                `Stream mode: ${telegramConfig.streamMode}`,
                `Default agent: ${defaultAgentId}`,
                `Default workdir: ${defaultWorkdir ?? 'none'}`,
                `Current session: ${status.session ? this.formatSessionLabel(status.session) : 'none'}`,
                `Current agent: ${status.session?.agentId ?? 'none'}`,
                `Current model: ${status.session?.modelId ?? 'none'}`,
                `Current workdir: ${status.session?.projectDir?.trim() || 'none'}`,
                `Generating: ${status.isGenerating ? 'yes' : 'no'}`,
                `Waiting: ${status.pendingInteraction ? this.formatPendingStatus(status.pendingInteraction) : 'none'}`,
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

    const pendingCallback = parsePendingInteractionCallbackData(event.data)
    if (pendingCallback) {
      return await this.handlePendingCallbackQuery(event, endpointKey, pendingCallback)
    }

    const pendingInteraction = await this.deps.runner.getPendingInteraction(endpointKey)
    if (pendingInteraction) {
      return {
        replies: [],
        callbackAnswer: {
          text: this.formatPendingCommandBlockedMessage(pendingInteraction),
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

  private async handlePendingCallbackQuery(
    event: TelegramInboundCallbackQuery,
    endpointKey: string,
    callback: TelegramPendingInteractionCallback
  ): Promise<RemoteCommandRouteResult> {
    const interaction = await this.deps.runner.getPendingInteraction(endpointKey)
    const state = this.deps.bindingStore.getPendingInteractionState(
      callback.token,
      TELEGRAM_INTERACTION_CALLBACK_TTL_MS
    )

    if (
      !interaction ||
      !state ||
      state.endpointKey !== endpointKey ||
      state.messageId !== interaction.messageId ||
      state.toolCallId !== interaction.toolCallId
    ) {
      return await this.buildExpiredPendingInteractionResult(event.messageId, endpointKey)
    }

    const response = this.resolvePendingCallbackResponse(interaction, callback)
    if (!response) {
      return await this.buildExpiredPendingInteractionResult(event.messageId, endpointKey)
    }

    this.deps.bindingStore.clearPendingInteractionState(callback.token)

    const waitingForUserMessage = response.kind === 'question_other'
    return {
      replies: [],
      outboundActions: [
        {
          type: 'editMessageText',
          messageId: event.messageId,
          text: buildTelegramInteractionResolvedText({
            interaction,
            responseText: this.describeInteractionResponse(interaction, response),
            waitingForUserMessage
          }),
          replyMarkup: null
        }
      ],
      callbackAnswer: {
        text: waitingForUserMessage ? 'Reply with your answer.' : 'Continuing...'
      },
      deferred: this.buildPendingCallbackContinuation(
        endpointKey,
        event.messageId,
        interaction,
        response
      )
    }
  }

  private async handlePendingTextResponse(
    endpointKey: string,
    text: string,
    interaction: RemotePendingInteraction
  ): Promise<RemoteCommandRouteResult> {
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

  private async buildExpiredPendingInteractionResult(
    messageId: number,
    endpointKey: string
  ): Promise<RemoteCommandRouteResult> {
    const interaction = await this.deps.runner.getPendingInteraction(endpointKey)
    if (!interaction) {
      return {
        replies: [],
        outboundActions: [
          {
            type: 'editMessageText',
            messageId,
            text: 'Pending interaction expired. Run /pending if another action is waiting.',
            replyMarkup: null
          }
        ],
        callbackAnswer: {
          text: 'Pending interaction expired.',
          showAlert: true
        }
      }
    }

    const prompt = this.createPendingPromptAction(
      endpointKey,
      interaction,
      'editMessageText',
      messageId
    )
    return {
      replies: [],
      outboundActions: [prompt],
      callbackAnswer: {
        text: 'Prompt refreshed.'
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

  private buildPendingPromptResult(
    endpointKey: string,
    interaction: RemotePendingInteraction
  ): RemoteCommandRouteResult {
    return {
      replies: [],
      outboundActions: [this.createPendingPromptAction(endpointKey, interaction, 'sendMessage')]
    }
  }

  private createPendingPromptAction(
    endpointKey: string,
    interaction: RemotePendingInteraction,
    mode: 'sendMessage' | 'editMessageText',
    messageId?: number
  ): TelegramOutboundAction {
    const token = this.deps.bindingStore.createPendingInteractionState(endpointKey, interaction)
    const prompt = buildTelegramPendingInteractionPrompt(interaction, token)
    if (mode === 'editMessageText' && typeof messageId === 'number') {
      return {
        type: 'editMessageText',
        messageId,
        text: prompt.text,
        replyMarkup: prompt.replyMarkup ?? null
      }
    }

    return {
      type: 'sendMessage',
      text: prompt.text,
      ...(prompt.replyMarkup ? { replyMarkup: prompt.replyMarkup } : {})
    }
  }

  private async buildPendingCallbackContinuation(
    endpointKey: string,
    messageId: number,
    interaction: RemotePendingInteraction,
    response: ToolInteractionResponse
  ): Promise<RemoteCommandRouteContinuation> {
    try {
      const result = await this.deps.runner.respondToPendingInteraction(endpointKey, response)

      if (result.waitingForUserMessage) {
        if (response.kind === 'question_other') {
          return {}
        }

        return {
          outboundActions: [
            {
              type: 'editMessageText',
              messageId,
              text: buildTelegramInteractionResolvedText({
                interaction,
                responseText: this.describeInteractionResponse(interaction, response),
                waitingForUserMessage: true
              }),
              replyMarkup: null
            }
          ]
        }
      }

      return result.execution ? { conversation: result.execution } : {}
    } catch (error) {
      return {
        replies: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  private resolvePendingCallbackResponse(
    interaction: RemotePendingInteraction,
    callback: TelegramPendingInteractionCallback
  ): ToolInteractionResponse | null {
    if (interaction.type === 'permission') {
      if (callback.action === 'allow') {
        return { kind: 'permission', granted: true }
      }
      if (callback.action === 'deny') {
        return { kind: 'permission', granted: false }
      }
      return null
    }

    if (callback.action === 'other') {
      return { kind: 'question_other' }
    }

    if (callback.action !== 'option') {
      return null
    }

    const option = interaction.question?.options?.[callback.optionIndex]
    if (!option) {
      return null
    }

    return {
      kind: 'question_option',
      optionLabel: option.label
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
      const optionByIndex = Number.parseInt(normalized, 10)
      if (
        Number.isInteger(optionByIndex) &&
        optionByIndex > 0 &&
        optionByIndex <= question.options.length
      ) {
        return {
          kind: 'question_option',
          optionLabel: question.options[optionByIndex - 1].label
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

  private formatPendingTextReplyHint(interaction: RemotePendingInteraction): string {
    if (interaction.type === 'permission') {
      return 'Reply with ALLOW or DENY, or use /pending to show the buttons again.'
    }

    if (interaction.question?.multiple) {
      return 'Reply with your answer in plain text.'
    }

    if (interaction.question?.custom !== false) {
      return 'Reply with an option number, exact label, or your own answer.'
    }

    return 'Reply with an option number or exact label, or use /pending to show the buttons again.'
  }

  private formatPendingCommandBlockedMessage(interaction: RemotePendingInteraction): string {
    return `Resolve the pending ${interaction.type} first. Use /pending to review it again.`
  }

  private formatPendingStatus(interaction: RemotePendingInteraction): string {
    const toolLabel = interaction.toolName.trim() || 'unknown tool'
    return `${interaction.type} via ${toolLabel}`
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
      'Plain text sends to the current bound session unless a tool interaction is waiting.'
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
