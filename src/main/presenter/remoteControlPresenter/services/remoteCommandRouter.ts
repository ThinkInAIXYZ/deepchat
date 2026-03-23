import type { TelegramPollerStatusSnapshot, TelegramInboundMessage } from '../types'
import type { RemoteConversationExecution } from './remoteConversationRunner'
import { RemoteAuthGuard } from './remoteAuthGuard'
import { RemoteBindingStore } from './remoteBindingStore'
import { RemoteConversationRunner } from './remoteConversationRunner'

export interface RemoteCommandRouteResult {
  replies: string[]
  conversation?: RemoteConversationExecution
}

type RemoteCommandRouterDeps = {
  authGuard: RemoteAuthGuard
  runner: RemoteConversationRunner
  bindingStore: RemoteBindingStore
  getPollerStatus: () => TelegramPollerStatusSnapshot
}

export class RemoteCommandRouter {
  constructor(private readonly deps: RemoteCommandRouterDeps) {}

  async handleMessage(message: TelegramInboundMessage): Promise<RemoteCommandRouteResult> {
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
                ? `Opened desktop session: ${this.formatSessionLabel(session)}`
                : 'No bound session to open. Send a message or use /new first.'
            ]
          }
        }

        case 'status': {
          const runtime = this.deps.getPollerStatus()
          const status = await this.deps.runner.getStatus(endpointKey)
          const telegramConfig = this.deps.bindingStore.getTelegramConfig()
          return {
            replies: [
              [
                'DeepChat Telegram Remote',
                `Runtime: ${runtime.state}`,
                `Stream mode: ${telegramConfig.streamMode}`,
                `Current session: ${status.session ? this.formatSessionLabel(status.session) : 'none'}`,
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
      '/start',
      '/help',
      '/pair <code>',
      '/new [title]',
      '/sessions',
      '/use <index>',
      '/stop',
      '/open',
      '/status',
      'Plain text sends to the current bound session.'
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
