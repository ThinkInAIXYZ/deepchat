/**
 * ACP Input Formatter - 只处理当前用户输入
 *
 * 核心原则：
 * 1. 只格式化当前用户输入，不涉及历史消息
 * 2. 支持多模态输入（文本、图片、文件）
 * 3. 符合 ACP 协议规范
 */

import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { AcpPromptInput } from '../types'
import * as fs from 'fs'
import * as path from 'path'

/**
 * ACP Input Formatter
 *
 * 将用户的多模态输入格式化为 ACP 协议的 ContentBlock[]
 */
export class AcpInputFormatter {
  /**
   * 格式化用户输入为 ContentBlock[]
   *
   * @param input 用户输入（多模态）
   * @returns ContentBlock[] 符合 ACP 协议的内容块数组
   */
  format(input: AcpPromptInput): schema.ContentBlock[] {
    const blocks: schema.ContentBlock[] = []

    // 1. 添加文本内容
    if (input.text && input.text.trim()) {
      blocks.push({
        type: 'text',
        text: input.text.trim()
      })
    }

    // 2. 添加图片
    if (input.images && input.images.length > 0) {
      for (const image of input.images) {
        blocks.push(this.formatImage(image))
      }
    }

    // 3. 添加文件
    if (input.files && input.files.length > 0) {
      for (const file of input.files) {
        blocks.push(this.formatFile(file))
      }
    }

    return blocks
  }

  /**
   * 格式化图片为 ContentBlock
   */
  private formatImage(image: {
    type: 'url' | 'base64' | 'file'
    data: string
  }): schema.ContentBlock {
    switch (image.type) {
      case 'url':
        // URL 类型：直接使用 resource_link
        return {
          type: 'resource_link',
          uri: image.data,
          name: 'image'
        }

      case 'file':
        // 文件路径类型：转换为 file:// URI
        return {
          type: 'resource_link',
          uri: `file://${image.data}`,
          name: path.basename(image.data)
        }

      case 'base64':
        // Base64 类型：需要先保存为临时文件
        // 注意：这里简化处理，实际应该保存到临时目录
        console.warn('[ACP] Base64 images not fully supported yet, consider saving to file first')
        return {
          type: 'text',
          text: '[Image: base64 data]'
        }

      default:
        console.warn(`[ACP] Unknown image type: ${(image as any).type}`)
        return {
          type: 'text',
          text: '[Image: unknown type]'
        }
    }
  }

  /**
   * 格式化文件为 ContentBlock
   */
  private formatFile(file: { path: string; name: string }): schema.ContentBlock {
    // 验证文件是否存在
    if (!fs.existsSync(file.path)) {
      console.warn(`[ACP] File not found: ${file.path}`)
      return {
        type: 'text',
        text: `[File not found: ${file.name}]`
      }
    }

    // 使用 resource_link 类型
    return {
      type: 'resource_link',
      uri: `file://${file.path}`,
      name: file.name || path.basename(file.path)
    }
  }

  /**
   * 验证输入是否有效
   */
  validate(input: AcpPromptInput): { valid: boolean; error?: string } {
    // 至少需要有一种类型的输入
    const hasText = input.text && input.text.trim().length > 0
    const hasImages = input.images && input.images.length > 0
    const hasFiles = input.files && input.files.length > 0

    if (!hasText && !hasImages && !hasFiles) {
      return {
        valid: false,
        error: 'Input must contain at least text, images, or files'
      }
    }

    // 验证文件路径
    if (input.files) {
      for (const file of input.files) {
        if (!file.path || !file.name) {
          return {
            valid: false,
            error: 'File must have both path and name'
          }
        }
      }
    }

    return { valid: true }
  }
}
