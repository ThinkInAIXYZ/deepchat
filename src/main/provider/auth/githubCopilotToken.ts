import { z } from 'zod'
import { createProviderHttpErrorFromResponse, type ProviderHttpError } from '../providerFailure'

const GITHUB_TOKEN_PATTERN = /^[\x21-\x7e]+$/

export interface CopilotTokenResponse {
  token: string
  expires_at: number
  refresh_in?: number
}

// Copilot chat uses VS Code integration metadata independently of the DeepChat app version.
export const GITHUB_COPILOT_CHAT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.44.0',
  'Editor-Version': 'vscode/1.115.0',
  'Editor-Plugin-Version': 'copilot-chat/0.44.0',
  'Copilot-Integration-Id': 'vscode-chat',
  'X-GitHub-Api-Version': '2026-08-01'
}

const CopilotTokenSchema = z.object({
  token: z.string().regex(GITHUB_TOKEN_PATTERN),
  expires_at: z.number().positive().finite(),
  refresh_in: z.number().nonnegative().finite().optional()
})

export async function createGitHubCopilotHttpError(
  response: Response,
  phase: 'token' | 'chat',
  secrets: string[]
): Promise<ProviderHttpError> {
  const body = await response.json().catch(() => null)
  const sanitize = (value: unknown): string => {
    if (typeof value !== 'string') return ''
    let text = value
    for (const secret of secrets) {
      if (secret) text = text.replaceAll(secret, '[redacted]')
    }
    return text
      .replace(/(?:gh[opusr]_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]')
      .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
      .replace(/(?:access_token|refresh_token|api_key)["\s:=]+[^"'\s,}]+/gi, '[redacted]')
      .replace(/[\r\n\0]/g, ' ')
      .slice(0, 500)
  }
  const serverMessage = sanitize(
    body?.error?.message ?? body?.error_details?.message ?? body?.message
  )
  const serverCode = sanitize(body?.error?.code ?? body?.error_details?.code ?? body?.code)
  const requestId = sanitize(
    response.headers.get('x-github-request-id') ?? response.headers.get('x-request-id')
  )
  const details = [
    serverMessage,
    /^[A-Za-z0-9._:-]{1,128}$/.test(serverCode) ? `code=${serverCode}` : '',
    /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? `request_id=${requestId}` : ''
  ].filter(Boolean)
  const description = phase === 'token' ? 'token exchange failed' : 'API error'
  return createProviderHttpErrorFromResponse(
    `GitHub Copilot ${description}: ${response.status} ${sanitize(response.statusText)}` +
      (details.length ? ` - ${details.join('; ')}` : ''),
    response,
    `github_copilot_${phase}_http_error`
  )
}

export async function getGitHubCopilotToken(
  oauthToken: string,
  signal?: AbortSignal
): Promise<CopilotTokenResponse> {
  signal?.throwIfAborted()
  if (typeof oauthToken !== 'string' || !GITHUB_TOKEN_PATTERN.test(oauthToken)) {
    throw new Error('No GitHub OAuth token available. Please sign in to GitHub Copilot.')
  }
  try {
    const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        Authorization: `token ${oauthToken}`,
        Accept: 'application/json',
        'User-Agent': GITHUB_COPILOT_CHAT_HEADERS['User-Agent'],
        'X-GitHub-Api-Version': '2025-04-01'
      },
      ...(signal ? { signal } : {})
    })
    if (!response.ok) {
      throw await createGitHubCopilotHttpError(response, 'token', [oauthToken])
    }
    const result = CopilotTokenSchema.safeParse(await response.json().catch(() => null))
    if (!result.success) {
      throw new Error('Invalid GitHub Copilot token response')
    }
    return result.data
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
}
