import { createHash } from 'node:crypto'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import type { AWS_BEDROCK_PROVIDER, LLM_PROVIDER } from '@shared/types/provider'
import {
  getGitHubCopilotToken,
  type CopilotTokenResponse
} from '@/provider/auth/githubCopilotDeviceFlow'
import type { DimCredential } from './modelCatalog'

interface CredentialOptions {
  copilotToken?: typeof getGitHubCopilotToken
  awsChain?: typeof fromNodeProviderChain
  now?: () => number
}

/** Authentication only. Native ProviderSecretHost owns each model connection. */
export class DimProviderCredentials {
  private readonly copilot = new Map<string, { identity: string; value: CopilotTokenResponse }>()
  private readonly aws = new Map<
    string,
    { identity: string; resolve: ReturnType<typeof fromNodeProviderChain> }
  >()

  constructor(private readonly options: CredentialOptions = {}) {}

  async resolve(provider: LLM_PROVIDER, signal: AbortSignal): Promise<DimCredential> {
    signal.throwIfAborted()
    try {
      let credential: DimCredential
      if (provider.apiType === 'aws-bedrock' || provider.id === 'aws-bedrock') {
        credential = await this.bedrock(provider as AWS_BEDROCK_PROVIDER)
      } else if (provider.apiType === 'github-copilot' || provider.id === 'github-copilot') {
        credential = await this.copilotToken(provider, signal)
      } else {
        if (!provider.apiKey) throw new Error('Missing provider credential')
        credential = provider.apiKey
      }
      signal.throwIfAborted()
      return credential
    } catch {
      signal.throwIfAborted()
      throw new Error('Provider credential is unavailable')
    }
  }

  private async copilotToken(provider: LLM_PROVIDER, signal: AbortSignal): Promise<string> {
    if (!provider.apiKey) throw new Error('Missing GitHub credential')
    const identity = createHash('sha256').update(provider.apiKey).digest('hex')
    const cached = this.copilot.get(provider.id)
    const now = (this.options.now ?? Date.now)()
    if (cached?.identity === identity && cached.value.expires_at * 1000 > now + 30_000)
      return cached.value.token
    const value = await (this.options.copilotToken ?? getGitHubCopilotToken)(
      provider.apiKey,
      signal
    )
    signal.throwIfAborted()
    if (
      !value.token ||
      !Number.isFinite(value.expires_at) ||
      value.expires_at * 1000 <= (this.options.now ?? Date.now)()
    )
      throw new Error('Invalid GitHub credential')
    this.copilot.set(provider.id, { identity, value })
    return value.token
  }

  private async bedrock(provider: AWS_BEDROCK_PROVIDER): Promise<DimCredential> {
    const configured = provider.credential
    if (configured?.authMode !== 'profile') {
      if (configured?.accessKeyId || configured?.secretAccessKey) {
        if (!configured.accessKeyId || !configured.secretAccessKey)
          throw new Error('Incomplete AWS credential')
        return {
          accessKeyId: configured.accessKeyId,
          secretAccessKey: configured.secretAccessKey,
          ...(configured.sessionToken ? { sessionToken: configured.sessionToken } : {})
        }
      }
      if (provider.apiKey) return provider.apiKey
    } else if (!configured.profile?.trim()) {
      throw new Error('Missing AWS profile')
    }
    const profile = configured?.authMode === 'profile' ? configured.profile : undefined
    const region = configured?.region || process.env.AWS_REGION || 'us-east-1'
    const identity = JSON.stringify([profile, region])
    let cached = this.aws.get(provider.id)
    if (!cached || cached.identity !== identity) {
      cached = {
        identity,
        resolve: (this.options.awsChain ?? fromNodeProviderChain)({
          ...(profile ? { profile } : {}),
          clientConfig: { region }
        })
      }
      this.aws.set(provider.id, cached)
    }
    // Await the credential owner itself; no detached timeout race or inference runs in Node.
    const value = await cached.resolve()
    if (!value.accessKeyId || !value.secretAccessKey) throw new Error('Invalid AWS credential')
    return {
      accessKeyId: value.accessKeyId,
      secretAccessKey: value.secretAccessKey,
      ...(value.sessionToken ? { sessionToken: value.sessionToken } : {})
    }
  }
}
