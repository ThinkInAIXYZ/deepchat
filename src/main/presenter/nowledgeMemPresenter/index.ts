import { IConfigPresenter } from '@shared/presenter'
import { NowledgeMemThread } from '@shared/types/nowledgeMem'
import logger from '../../../shared/logger'

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

export class NowledgeMemPresenter {
  private config: NowledgeMemConfig
  private configPresenter: IConfigPresenter
  private configLoaded = false

  constructor(configPresenter: IConfigPresenter) {
    this.configPresenter = configPresenter
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
    await this.configPresenter.setNowledgeMemConfig(this.config)
  }

  /**
   * Load nowledge-mem configuration
   */
  async loadConfig(): Promise<NowledgeMemConfig> {
    const savedConfig = await this.configPresenter.getNowledgeMemConfig()
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
  async testConnection(): Promise<NowledgeMemApiResponse<{ message: string }>> {
    try {
      await this.ensureConfigLoaded()
      const response = await fetch(`${this.config.baseUrl}/api/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` })
        },
        signal: AbortSignal.timeout(this.config.timeout)
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

  /**
   * Submit thread to nowledge-mem API
   */
  async submitThread(
    thread: NowledgeMemThread
  ): Promise<NowledgeMemApiResponse<NowledgeMemThread>> {
    try {
      await this.ensureConfigLoaded()
      // Log thread data being sent for debugging
      logger.info('Submitting thread to nowledge-mem', {
        threadId: thread.thread_id,
        messageCount: thread.messages.length,
        source: thread.source
      })

      const response = await fetch(`${this.config.baseUrl}/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` })
        },
        body: JSON.stringify(thread),
        signal: AbortSignal.timeout(this.config.timeout)
      })

      let responseData
      let rawText = ''

      if (!response.ok) {
        // Try to get raw response text first for debugging
        try {
          rawText = await response.text()
          logger.info(`HTTP ${response.status} Response:`, rawText)
        } catch (textError) {
          logger.error('Failed to read response text:', textError)
        }

        // Then try to parse JSON
        try {
          responseData = JSON.parse(rawText)
        } catch (jsonError) {
          logger.error('Failed to parse response as JSON:', jsonError)
          responseData = { error: rawText || `HTTP ${response.status}: ${response.statusText}` }
        }
      } else {
        responseData = await response.json().catch(() => ({}))
        logger.info('Success response:', responseData)
      }

      return {
        success: response.ok,
        status: response.status,
        data: response.ok ? responseData : undefined,
        error: response.ok
          ? undefined
          : responseData.error ||
            responseData.message ||
            rawText ||
            `HTTP ${response.status}: ${response.statusText}`
      }
    } catch (error) {
      logger.error('Error submitting thread to nowledge-mem:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
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
