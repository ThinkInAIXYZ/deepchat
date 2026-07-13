import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { McpOAuthCredentialStore } from '../../../../src/main/presenter/mcpPresenter/oauthCredentialStore'

describe('McpOAuthCredentialStore', () => {
  let savedContent = ''

  beforeEach(() => {
    savedContent = ''
    vi.mocked(fs.existsSync).mockImplementation(() => Boolean(savedContent))
    vi.mocked(fs.readFileSync).mockImplementation(() => savedContent)
    vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
      savedContent = String(data)
    })
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as unknown as string)
  })

  it('removes only the requested credential scope', () => {
    const store = new McpOAuthCredentialStore('/tmp/deepchat-mcp-oauth/credentials.json')

    store.saveEntry('linear', {
      tokens: {
        access_token: 'access-token'
      },
      clientInformation: {
        client_id: 'client-id'
      },
      codeVerifier: 'verifier',
      discoveryState: {
        authorizationServerUrl: 'https://mcp.linear.app'
      }
    })

    store.clearEntryScope('linear', 'tokens')

    const entry = store.load('linear')
    expect(entry?.tokens).toBeUndefined()
    expect(entry?.clientInformation?.client_id).toBe('client-id')
    expect(entry?.codeVerifier).toBe('verifier')
    expect(entry?.discoveryState?.authorizationServerUrl).toBe('https://mcp.linear.app')
  })
})
