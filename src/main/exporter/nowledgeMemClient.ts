import { NowledgeMemThread } from '@shared/types/nowledgeMem'
import logger from '@shared/logger'
export const memHeaders = (apiKey: string): Record<string, string> => ({
  APP: 'DeepChat',
  ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-NMEM-API-Key': apiKey } : {})
})
import type { SettingsStore } from '@/config/settingsStore'

export interface NowledgeMemConfig {
  baseUrl: string
  apiKey?: string
  timeout: number
}

export interface NowledgeMemApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  status?: number
}

// Use same interface as NowledgeMemThread for consistency
export type NowledgeMemThreadSubmission = NowledgeMemThread

export class NowledgeMemClient {
  private config: NowledgeMemConfig
  private configLoaded = false

  constructor(private readonly settings: SettingsStore) {
    this.config = {
      baseUrl: 'http://127.0.0.1:14242',
      timeout: 30000 // 30 seconds
    }
    // Best-effort async load; do not block constructor
    void this.loadConfig()
      .then(() => {
        this.configLoaded = true
      })
      .catch((err) => {
        logger.error('Failed to load persisted nowledge-mem config on init:', err)
      })
  }

  /**
   * Update nowledge-mem configuration
   */
  async updateConfig(config: Partial<NowledgeMemConfig>): Promise<void> {
    this.config = { ...this.config, ...config }

    // Save configuration
    this.settings.set('nowledgeMemConfig', this.config)
  }

  /**
   * Load nowledge-mem configuration
   */
  async loadConfig(): Promise<NowledgeMemConfig> {
    const savedConfig = this.settings.get<NowledgeMemConfig>('nowledgeMemConfig')
    if (savedConfig) {
      this.config = { ...this.config, ...savedConfig }
    }
    return this.config
  }

  private async ensureConfigLoaded() {
    if (!this.configLoaded) {
      await this.loadConfig().catch((err) => {
        logger.error('Failed to load nowledge-mem config:', err)
      })
      this.configLoaded = true
    }
  }

  /**
   * Test connection to nowledge-mem API
   */
  async testConnection(
    configOverride?: NowledgeMemConfig
  ): Promise<NowledgeMemApiResponse<{ message: string }>> {
    try {
      if (!configOverride) {
        await this.ensureConfigLoaded()
      }
      const config = configOverride ?? this.config
      const response = await fetch(this.resolveHealthUrl(config.baseUrl), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` })
        },
        signal: AbortSignal.timeout(config.timeout)
      })

      return {
        success: response.ok,
        status: response.status,
        data: response.ok ? { message: 'Connection successful' } : undefined,
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  private resolveHealthUrl(baseUrl: string): string {
    const url = new URL(baseUrl)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      throw new TypeError('Nowledge Mem URL must use HTTP or HTTPS without embedded credentials')
    }
    url.search = ''
    url.hash = ''
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/health`
    return url.toString()
  }

  /**
   * Submit thread to nowledge-mem API
   */
  async submitThread(
    thread: NowledgeMemThread,
    configOverride?: NowledgeMemConfig
  ): Promise<NowledgeMemApiResponse<NowledgeMemThread>> {
    try {
      if (!configOverride) await this.ensureConfigLoaded()
      const config = configOverride ?? { ...this.config }
      return await submitNowledgeThread(thread, config)
    } catch {
      return { success: false, error: 'Thread export failed or timed out' }
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): NowledgeMemConfig {
    // Return current snapshot (constructor defaults or loaded values)
    return { ...this.config }
  }

  /**
   * Validate thread before submission
   */
  validateThreadForSubmission(thread: NowledgeMemThread): {
    valid: boolean
    errors: string[]
    warnings: string[]
  } {
    const errors: string[] = []
    const warnings: string[] = []

    // Required fields
    if (!thread.thread_id || thread.thread_id.trim().length === 0) {
      errors.push('Thread ID is required')
    }

    if (!thread.messages || thread.messages.length === 0) {
      errors.push('Thread must have at least one message')
    }

    // Message validation
    if (thread.messages) {
      thread.messages.forEach((message, index) => {
        if (!message.role || !['user', 'assistant', 'system'].includes(message.role)) {
          errors.push(`Message ${index + 1} has invalid role: ${message.role}`)
        }

        if (!message.content || message.content.trim().length === 0) {
          errors.push(`Message ${index + 1} has empty content`)
        }

        // Check content size (warn if too large)
        if (message.content && message.content.length > 50000) {
          warnings.push(
            `Message ${index + 1} content is very large (${message.content.length} characters)`
          )
        }
      })
    }

    // Size warnings
    const jsonSize = JSON.stringify(thread).length
    if (jsonSize > 10000000) {
      // 10MB
      errors.push(
        `Thread data is too large (${Math.round(jsonSize / 1024 / 1024)}MB). Maximum size is 10MB`
      )
    } else if (jsonSize > 5000000) {
      // 5MB
      warnings.push(
        `Thread data is large (${Math.round(jsonSize / 1024 / 1024)}MB). Upload may take some time`
      )
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }
}

export async function submitNowledgeThread(
  thread: NowledgeMemThread,
  config: NowledgeMemConfig
): Promise<NowledgeMemApiResponse<NowledgeMemThread>> {
  try {
    // Log thread data being sent for debugging
    logger.info('Submitting thread to nowledge-mem', {
      threadId: thread.thread_id,
      messageCount: thread.messages.length,
      source: thread.source
    })

    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...memHeaders(config.apiKey ?? '')
      },
      body: JSON.stringify(thread),
      signal: AbortSignal.timeout(config.timeout),
      redirect: 'error'
    })

    if (!response.ok)
      return {
        success: false,
        status: response.status,
        error: `Thread export: HTTP ${response.status}`
      }
    const data = await response.json().catch(() => null)
    const ack = data?.thread ?? data
    const acknowledgedId = ack?.thread_id
    const messageCount = ack?.message_count ?? ack?.total_messages
    if (
      acknowledgedId !== thread.thread_id ||
      !Number.isInteger(messageCount) ||
      messageCount < thread.messages.length
    ) {
      return {
        success: false,
        error: 'Thread export returned no matching persistence acknowledgement'
      }
    }
    return { success: true, status: response.status, data: thread }
  } catch {
    logger.error('Error submitting thread to nowledge-mem')
    return {
      success: false,
      error: 'Thread export failed or timed out'
    }
  }
}
