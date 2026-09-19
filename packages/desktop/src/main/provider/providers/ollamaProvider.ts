import { OllamaProvider as OllamaCore } from '@deepchat/provider/providers/ollamaProvider'
import { normalizeOllamaSdkHost } from '@deepchat/provider/aiSdk/providerFactory'
import type { LLM_PROVIDER, OllamaModel } from '@deepchat/shared/types/provider'
import type { ProviderSettingsPort } from '../settings'
import type { ProviderLocalePort } from '@deepchat/shared/provider/locale'
import { execFile } from 'node:child_process'
import { isInsecureTlsAllowed } from '@/lib/insecureTls'
import { createDesktopProviderHost } from '../desktopHost'
const OLLAMA_LIST_TIMEOUT_MS = 5000
export class OllamaProvider extends OllamaCore {
  constructor(provider: LLM_PROVIDER, settings: ProviderSettingsPort, locale: ProviderLocalePort) {
    super(provider, settings, createDesktopProviderHost(locale))
  }
  protected override isInsecureTlsAllowed(): boolean {
    return isInsecureTlsAllowed()
  }
  private isLocalOllamaHost(): boolean {
    try {
      const url = new URL(normalizeOllamaSdkHost(this.provider.baseUrl))
      return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)
    } catch {
      return false
    }
  }

  private getOllamaCliCandidates(): string[] {
    switch (process.platform) {
      case 'darwin':
        return ['ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama']
      case 'win32':
        return ['ollama.exe', 'ollama']
      default:
        return ['ollama', '/usr/local/bin/ollama', '/usr/bin/ollama']
    }
  }

  private createCliModel(name: string, digest: string): OllamaModel {
    return {
      name,
      model: name,
      size: 0,
      digest,
      modified_at: new Date(),
      details: {
        format: '',
        family: 'default',
        families: ['default'],
        parameter_size: '',
        quantization_level: ''
      }
    }
  }

  private parseOllamaListOutput(output: string): OllamaModel[] {
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('NAME '))
      .map((line) => {
        const match = line.match(/^(\S+)\s+([0-9a-fA-F]+)\s+/)
        return match ? this.createCliModel(match[1], match[2]) : null
      })
      .filter((model): model is OllamaModel => Boolean(model))
  }

  protected override async listModelsFromCli(): Promise<OllamaModel[]> {
    if (!this.isLocalOllamaHost()) {
      return []
    }

    let lastError: unknown = null
    try {
      const sdkHost = normalizeOllamaSdkHost(this.provider.baseUrl)
      for (const command of this.getOllamaCliCandidates()) {
        try {
          const stdout = await new Promise<string>((resolve, reject) => {
            execFile(
              command,
              ['list'],
              {
                timeout: OLLAMA_LIST_TIMEOUT_MS,
                maxBuffer: 1024 * 1024,
                env: {
                  ...process.env,
                  OLLAMA_HOST: sdkHost
                }
              },
              (error, output) => {
                if (error) {
                  reject(error)
                  return
                }

                resolve(output)
              }
            )
          })
          return this.parseOllamaListOutput(stdout)
        } catch (error) {
          lastError = error
        }
      }

      throw lastError
    } catch {
      return []
    }
  }
}
