import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'

import { finalizeAssistantMessageBlocks } from '@shared/chat/messageBlocks'

import type { MessageManager } from './messageManager'
import type { GeneratingMessageState } from './types'

interface ContentBufferDependencies {
  messageManager: MessageManager
  generatingMessages: Map<string, GeneratingMessageState>
}

export class ContentBufferManager {
  private messageManager: MessageManager
  private generatingMessages: Map<string, GeneratingMessageState>

  constructor({ messageManager, generatingMessages }: ContentBufferDependencies) {
    this.messageManager = messageManager
    this.generatingMessages = generatingMessages
  }

  cleanupContentBuffer(state: GeneratingMessageState): void {
    if (state.flushTimeout) {
      clearTimeout(state.flushTimeout)
      state.flushTimeout = undefined
    }
    if (state.throttleTimeout) {
      clearTimeout(state.throttleTimeout)
      state.throttleTimeout = undefined
    }
    state.adaptiveBuffer = undefined
    state.lastRendererUpdateTime = undefined
  }

  async flushAdaptiveBuffer(eventId: string): Promise<void> {
    const state = this.generatingMessages.get(eventId)
    if (!state?.adaptiveBuffer) return

    const buffer = state.adaptiveBuffer
    const now = Date.now()

    if (state.flushTimeout) {
      clearTimeout(state.flushTimeout)
      state.flushTimeout = undefined
    }

    try {
      if (buffer.content && buffer.sentPosition < buffer.content.length) {
        const newContent = buffer.content.slice(buffer.sentPosition)
        if (newContent) {
          await this.processBufferedContent(state, eventId, newContent, now)
          buffer.sentPosition = buffer.content.length
        }
      }
    } catch (error) {
      console.error('[ContentBuffer] ERROR flushing adaptive buffer', {
        eventId,
        err: error
      })
      throw error
    } finally {
      state.adaptiveBuffer = undefined
    }
  }

  finalizeLastBlock(state: GeneratingMessageState): void {
    finalizeAssistantMessageBlocks(state.message.content)
  }

  async processContentDirectly(
    eventId: string,
    content: string,
    currentTime: number
  ): Promise<void> {
    const state = this.generatingMessages.get(eventId)
    if (!state) return

    try {
      if (this.shouldSplitContent(content)) {
        await this.processLargeContentInChunks(state, eventId, content, currentTime)
      } else {
        await this.processNormalContent(state, eventId, content, currentTime)
      }
    } catch (error) {
      console.error('[ContentBuffer] ERROR processing content', {
        eventId,
        size: content.length,
        err: error
      })
      throw error
    }
  }

  private async processBufferedContent(
    state: GeneratingMessageState,
    eventId: string,
    content: string,
    currentTime: number
  ): Promise<void> {
    const buffer = state.adaptiveBuffer

    if (buffer?.isLargeContent) {
      await this.processLargeContentAsynchronously(state, eventId, content, currentTime)
      return
    }

    await this.processNormalContent(state, eventId, content, currentTime)
  }

  private async processLargeContentAsynchronously(
    state: GeneratingMessageState,
    eventId: string,
    content: string,
    currentTime: number
  ): Promise<void> {
    const buffer = state.adaptiveBuffer
    if (!buffer) return

    buffer.isProcessing = true

    try {
      const chunks = this.splitLargeContent(content)
      const totalChunks = chunks.length

      console.log(
        `[ThreadPresenter] Processing ${totalChunks} chunks asynchronously for ${content.length} bytes`
      )

      const lastBlock = state.message.content[state.message.content.length - 1]
      let contentBlock: any

      if (lastBlock && lastBlock.type === 'content') {
        contentBlock = lastBlock
      } else {
        this.finalizeLastBlock(state)
        contentBlock = {
          type: 'content',
          content: '',
          status: 'loading',
          timestamp: currentTime
        }
        state.message.content.push(contentBlock)
      }

      const batchSize = 5
      for (let batchStart = 0; batchStart < chunks.length; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, chunks.length)
        const batch = chunks.slice(batchStart, batchEnd)

        const batchContent = batch.join('')
        contentBlock.content += batchContent

        await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))

        const eventData: any = {
          eventId,
          content: batchContent,
          chunkInfo: {
            current: batchEnd,
            total: totalChunks,
            isLargeContent: true,
            batchSize: batch.length
          }
        }

        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, eventData)

        if (batchEnd < chunks.length) {
          await new Promise((resolve) => setImmediate(resolve))
        }
      }

      console.log(`[ThreadPresenter] Completed processing ${totalChunks} chunks`)
    } catch (error) {
      console.error('[ThreadPresenter] Error in processLargeContentAsynchronously:', error)
    } finally {
      buffer.isProcessing = false
    }
  }

  private async processNormalContent(
    state: GeneratingMessageState,
    eventId: string,
    content: string,
    currentTime: number
  ): Promise<void> {
    const lastBlock = state.message.content[state.message.content.length - 1]

    if (lastBlock && lastBlock.type === 'content') {
      lastBlock.content += content
    } else {
      this.finalizeLastBlock(state)
      state.message.content.push({
        type: 'content',
        content: content,
        status: 'loading',
        timestamp: currentTime
      })
    }

    await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
  }

  private async processLargeContentInChunks(
    state: GeneratingMessageState,
    eventId: string,
    content: string,
    currentTime: number
  ): Promise<void> {
    console.log(`[ThreadPresenter] Processing large content in chunks: ${content.length} bytes`)

    const lastBlock = state.message.content[state.message.content.length - 1]
    let contentBlock: any

    if (lastBlock && lastBlock.type === 'content') {
      contentBlock = lastBlock
    } else {
      this.finalizeLastBlock(state)
      contentBlock = {
        type: 'content',
        content: '',
        status: 'loading',
        timestamp: currentTime
      }
      state.message.content.push(contentBlock)
    }

    contentBlock.content += content

    await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
  }

  private splitLargeContent(content: string): string[] {
    const chunks: string[] = []
    let maxChunkSize = 4096

    if (content.includes('data:image/')) {
      maxChunkSize = 512
    }

    if (content.length > 50000) {
      maxChunkSize = Math.min(maxChunkSize, 256)
    }

    for (let i = 0; i < content.length; i += maxChunkSize) {
      chunks.push(content.slice(i, i + maxChunkSize))
    }

    return chunks
  }

  private shouldSplitContent(content: string): boolean {
    const sizeThreshold = 8192
    const hasBase64Image = content.includes('data:image/') && content.includes('base64,')
    const hasLargeBase64 = hasBase64Image && content.length > 5120

    return content.length > sizeThreshold || hasLargeBase64
  }
}
