type DiscordGatewayResponse = {
  url?: string
}

type DiscordUserResponse = {
  id?: string | number
  username?: string
  global_name?: string | null
}

type DiscordMessageResponse = {
  id?: string | number
}

export interface DiscordBotIdentity {
  id: string
  username?: string
  displayName?: string
}

export interface DiscordSlashCommandOption {
  type: 3
  name: string
  description: string
  required?: boolean
}

export interface DiscordSlashCommandDefinition {
  name: string
  description: string
  options?: DiscordSlashCommandOption[]
}

export class DiscordApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'DiscordApiRequestError'
  }
}

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10'

const normalizeResponseError = async (response: Response): Promise<string> => {
  const fallback = `${response.status} ${response.statusText}`.trim()

  try {
    const data = (await response.json()) as {
      message?: string
      error?: string
    }
    const message = data.message?.trim() || data.error?.trim()
    if (message) {
      return message
    }
  } catch {
    // Fall through to the fallback status text.
  }

  return fallback || 'Discord API request failed.'
}

const createTextPayload = (content: string) => ({
  content,
  allowed_mentions: {
    parse: []
  }
})

export class DiscordClient {
  constructor(
    private readonly credentials: {
      botToken: string
    }
  ) {}

  getBotToken(): string {
    return this.credentials.botToken
  }

  async probeBot(): Promise<DiscordBotIdentity> {
    const response = await this.request('/users/@me', {
      method: 'GET'
    })

    const data = (await response.json()) as DiscordUserResponse
    const id = data.id === undefined ? '' : String(data.id).trim()
    if (!id) {
      throw new Error('Discord bot ID is missing from the users/@me response.')
    }

    return {
      id,
      username: data.username?.trim() || undefined,
      displayName: data.global_name?.trim() || undefined
    }
  }

  async getGatewayUrl(): Promise<string> {
    const response = await this.request('/gateway/bot', {
      method: 'GET'
    })

    const data = (await response.json()) as DiscordGatewayResponse
    const url = data.url?.trim()
    if (!url) {
      throw new Error('Discord gateway URL is missing from the response.')
    }

    return url
  }

  async registerCommands(
    applicationId: string,
    commands: DiscordSlashCommandDefinition[]
  ): Promise<void> {
    await this.request(`/applications/${encodeURIComponent(applicationId)}/commands`, {
      method: 'PUT',
      body: JSON.stringify(commands)
    })
  }

  async sendMessage(channelId: string, content: string): Promise<string | null> {
    const response = await this.request(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(createTextPayload(content))
    })

    const data = (await response.json()) as DiscordMessageResponse
    const messageId = data.id === undefined ? '' : String(data.id).trim()
    return messageId || null
  }

  async updateMessage(channelId: string, messageId: string, content: string): Promise<void> {
    await this.request(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(createTextPayload(content))
      }
    )
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.request(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'DELETE'
      }
    )
  }

  async sendTypingIndicator(channelId: string): Promise<void> {
    await this.request(`/channels/${encodeURIComponent(channelId)}/typing`, {
      method: 'POST'
    })
  }

  async deferInteractionResponse(interactionId: string, interactionToken: string): Promise<void> {
    await this.request(
      `/interactions/${encodeURIComponent(interactionId)}/${encodeURIComponent(interactionToken)}/callback`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 5
        })
      },
      'none'
    )
  }

  async editOriginalInteractionResponse(
    applicationId: string,
    interactionToken: string,
    content: string
  ): Promise<void> {
    await this.request(
      `/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`,
      {
        method: 'PATCH',
        body: JSON.stringify(createTextPayload(content))
      },
      'none'
    )
  }

  async sendInteractionFollowup(
    applicationId: string,
    interactionToken: string,
    content: string
  ): Promise<void> {
    await this.request(
      `/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}`,
      {
        method: 'POST',
        body: JSON.stringify(createTextPayload(content))
      },
      'none'
    )
  }

  private async request(
    path: string,
    init: RequestInit,
    auth: 'bot' | 'none' = 'bot'
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (auth === 'bot') {
      headers.Authorization = `Bot ${this.credentials.botToken}`
    }

    const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers as Record<string, string> | undefined)
      }
    })

    if (!response.ok) {
      throw new DiscordApiRequestError(response.status, await normalizeResponseError(response))
    }

    return response
  }
}
