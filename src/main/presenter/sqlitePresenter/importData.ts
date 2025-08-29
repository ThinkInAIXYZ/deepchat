import Database from 'better-sqlite3-multiple-ciphers'
import { nanoid } from 'nanoid'
import path from 'path'

/**
 * 数据导入类
 * 用于从外部SQLite数据库导入数据到当前数据库
 */
export class DataImporter {
  private sourceDb: Database.Database
  private targetDb: Database.Database
  private idMappings: {
    conversations: Map<string, string>
    messages: Map<string, string>
    attachments: Map<string, string>
  }

  /**
   * 构造函数
   * @param sourcePath 源数据库路径
   * @param targetDbOrPath 目标数据库实例或路径
   * @param sourcePassword 源数据库密码（如果有）
   * @param targetPassword 目标数据库密码（如果有）
   */
  constructor(
    sourcePath: string,
    targetDbOrPath: Database.Database | string,
    sourcePassword?: string,
    targetPassword?: string
  ) {
    // 初始化源数据库连接
    this.sourceDb = new Database(sourcePath)
    this.sourceDb.pragma('journal_mode = WAL')

    // 如果有密码，设置加密
    if (sourcePassword) {
      this.sourceDb.pragma(`cipher='sqlcipher'`)
      this.sourceDb.pragma(`key='${sourcePassword}'`)
    }

    // 设置目标数据库
    if (typeof targetDbOrPath === 'string') {
      // 如果传入的是路径字符串，创建新的数据库连接
      this.targetDb = new Database(targetDbOrPath)
      this.targetDb.pragma('journal_mode = WAL')

      // 如果有目标数据库密码，设置加密
      if (targetPassword) {
        this.targetDb.pragma(`cipher='sqlcipher'`)
        this.targetDb.pragma(`key='${targetPassword}'`)
      }
    } else {
      // 如果传入的是数据库实例，直接使用
      this.targetDb = targetDbOrPath
    }

    // 初始化ID映射
    this.idMappings = {
      conversations: new Map<string, string>(),
      messages: new Map<string, string>(),
      attachments: new Map<string, string>()
    }
  }

  /**
   * 开始导入数据
   * @returns 导入的会话数量
   */
  public async importData(): Promise<number> {
    console.log('DataImporter: Starting data import...')

    // 获取所有会话 - 兼容不同版本的数据库schema
    let conversations: any[]

    try {
      console.log('DataImporter: Attempting to query conversations with all new fields...')
      // 尝试使用包含所有新字段的查询
      conversations = this.sourceDb
        .prepare(
          `SELECT
            conv_id, title, created_at, updated_at, system_prompt,
            temperature, context_length, max_tokens, provider_id,
            model_id,
            COALESCE(is_pinned, 0) as is_pinned,
            COALESCE(is_new, 0) as is_new,
            COALESCE(artifacts, 0) as artifacts,
            enabled_mcp_tools,
            thinking_budget,
            reasoning_effort,
            verbosity
          FROM conversations`
        )
        .all() as any[]
      console.log(
        `DataImporter: Successfully queried ${conversations.length} conversations with all fields`
      )
    } catch (error) {
      // 如果失败，使用基础字段查询（兼容旧版本数据库）
      console.warn(
        'DataImporter: Failed to query with new fields, falling back to basic query:',
        error
      )
      try {
        conversations = this.sourceDb
          .prepare(
            `SELECT
              conv_id, title, created_at, updated_at, system_prompt,
              temperature, context_length, max_tokens, provider_id,
              model_id,
              COALESCE(is_pinned, 0) as is_pinned,
              COALESCE(is_new, 0) as is_new,
              COALESCE(artifacts, 0) as artifacts
            FROM conversations`
          )
          .all() as any[]

        console.log(
          `DataImporter: Successfully queried ${conversations.length} conversations with basic fields`
        )

        // 为缺失的字段设置默认值
        conversations = conversations.map((conv) => ({
          ...conv,
          enabled_mcp_tools: null,
          thinking_budget: null,
          reasoning_effort: null,
          verbosity: null
        }))
      } catch (fallbackError) {
        console.error(
          'DataImporter: Failed to query conversations even with basic fields:',
          fallbackError
        )
        throw new Error(
          `Failed to query conversations: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
        )
      }
    }

    console.log(`DataImporter: Preparing to import ${conversations.length} conversations`)

    // 使用better-sqlite3的transaction API来处理事务
    const importTransaction = this.targetDb.transaction(() => {
      let importedCount = 0
      for (const conv of conversations) {
        console.log(`DataImporter: Processing conversation ${conv.conv_id}`)

        try {
          // 如果是增量导入模式，检查会话是否已存在
          const existingConv = this.targetDb
            .prepare('SELECT conv_id FROM conversations WHERE conv_id = ?')
            .get(conv.conv_id)
          if (existingConv) {
            console.log(`DataImporter: Conversation ${conv.conv_id} already exists, skipping`)
            continue // 跳过已存在的会话
          }

          this.importConversation(conv)
          importedCount++
          console.log(`DataImporter: Successfully imported conversation ${conv.conv_id}`)
        } catch (convError) {
          console.error(`DataImporter: Failed to import conversation ${conv.conv_id}:`, convError)
          throw convError
        }
      }
      return importedCount
    })

    try {
      console.log('DataImporter: Starting transaction...')
      // 执行事务并返回导入的会话数量
      const result = importTransaction()
      console.log(
        `DataImporter: Transaction completed successfully. Imported ${result} conversations`
      )
      return result
    } catch (transactionError) {
      console.error('DataImporter: Transaction failed:', transactionError)
      // 事务会自动回滚，抛出详细错误
      throw new Error(
        `Failed to import data: ${transactionError instanceof Error ? transactionError.message : String(transactionError)}`
      )
    }
  }

  /**
   * 导入单个会话及其相关数据
   * @param conv 会话数据
   */
  private importConversation(conv: any): void {
    console.log(`DataImporter: Importing conversation ${conv.conv_id} - ${conv.title}`)

    // 为会话生成新ID
    // const newConvId = nanoid()
    // this.idMappings.conversations.set(conv.conv_id, newConvId)

    try {
      console.log(`DataImporter: Attempting to insert conversation ${conv.conv_id} with all fields`)
      // 首先尝试使用包含所有新字段的INSERT语句
      this.targetDb
        .prepare(
          `INSERT INTO conversations (
            conv_id, title, created_at, updated_at, system_prompt,
            temperature, context_length, max_tokens, provider_id,
            model_id, is_pinned, is_new, artifacts, enabled_mcp_tools,
            thinking_budget, reasoning_effort, verbosity
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          conv.conv_id,
          conv.title,
          conv.created_at,
          conv.updated_at,
          conv.system_prompt,
          conv.temperature,
          conv.context_length,
          conv.max_tokens,
          conv.provider_id,
          conv.model_id,
          conv.is_pinned || 0,
          conv.is_new || 0,
          conv.artifacts || 0,
          conv.enabled_mcp_tools || null,
          conv.thinking_budget || null,
          conv.reasoning_effort || null,
          conv.verbosity || null
        )
      console.log(
        `DataImporter: Successfully inserted conversation ${conv.conv_id} with all fields`
      )
    } catch (error) {
      // 如果失败，使用基础字段的INSERT语句（兼容旧版本目标数据库）
      console.warn(
        `DataImporter: Failed to insert conversation ${conv.conv_id} with new fields, falling back to basic insert:`,
        error
      )
      try {
        this.targetDb
          .prepare(
            `INSERT INTO conversations (
              conv_id, title, created_at, updated_at, system_prompt,
              temperature, context_length, max_tokens, provider_id,
              model_id, is_pinned, is_new, artifacts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            conv.conv_id,
            conv.title,
            conv.created_at,
            conv.updated_at,
            conv.system_prompt,
            conv.temperature,
            conv.context_length,
            conv.max_tokens,
            conv.provider_id,
            conv.model_id,
            conv.is_pinned || 0,
            conv.is_new || 0,
            conv.artifacts || 0
          )
        console.log(
          `DataImporter: Successfully inserted conversation ${conv.conv_id} with basic fields`
        )
      } catch (fallbackError) {
        console.error(
          `DataImporter: Failed to insert conversation ${conv.conv_id} even with basic fields:`,
          fallbackError
        )
        throw new Error(
          `Failed to insert conversation ${conv.conv_id}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
        )
      }
    }

    // 导入该会话的所有消息
    console.log(`DataImporter: Starting to import messages for conversation ${conv.conv_id}`)
    try {
      this.importMessages(conv.conv_id)
      console.log(`DataImporter: Successfully imported messages for conversation ${conv.conv_id}`)
    } catch (messageError) {
      console.error(
        `DataImporter: Failed to import messages for conversation ${conv.conv_id}:`,
        messageError
      )
      throw new Error(
        `Failed to import messages for conversation ${conv.conv_id}: ${messageError instanceof Error ? messageError.message : String(messageError)}`
      )
    }
  }

  /**
   * 导入会话的所有消息
   * @param oldConvId 原会话ID
   */
  private importMessages(oldConvId: string): void {
    try {
      // 获取会话的所有消息
      const messages = this.sourceDb
        .prepare(
          `SELECT
            msg_id, parent_id, role, content, created_at,
            order_seq, token_count, status, metadata,
            is_context_edge, is_variant
          FROM messages
          WHERE conversation_id = ?
          ORDER BY order_seq`
        )
        .all(oldConvId) as any[]

      console.log(`DataImporter: Found ${messages.length} messages for conversation ${oldConvId}`)

      // 逐个导入消息
      for (const msg of messages) {
        console.log(`DataImporter: Importing message ${msg.msg_id} (role: ${msg.role})`)

        const newMsgId = nanoid()
        this.idMappings.messages.set(msg.msg_id, newMsgId)

        // 处理父消息ID映射
        let newParentId = ''
        if (msg.parent_id && msg.parent_id !== '') {
          newParentId = this.idMappings.messages.get(msg.parent_id) || ''
        }

        try {
          // 插入消息
          this.targetDb
            .prepare(
              `INSERT INTO messages (
                msg_id, conversation_id, parent_id, role, content,
                created_at, order_seq, token_count, status, metadata,
                is_context_edge, is_variant
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              newMsgId,
              oldConvId,
              newParentId,
              msg.role,
              msg.content,
              msg.created_at,
              msg.order_seq,
              msg.token_count || 0,
              msg.status || 'sent',
              msg.metadata || null,
              msg.is_context_edge || 0,
              msg.is_variant || 0
            )

          console.log(`DataImporter: Successfully inserted message ${msg.msg_id} -> ${newMsgId}`)

          // 导入消息的附件
          this.importAttachments(msg.msg_id, newMsgId)
          this.importMessageAttachments(msg.msg_id, newMsgId)
        } catch (msgError) {
          console.error(`DataImporter: Failed to insert message ${msg.msg_id}:`, msgError)
          throw new Error(
            `Failed to insert message ${msg.msg_id}: ${msgError instanceof Error ? msgError.message : String(msgError)}`
          )
        }
      }
    } catch (error) {
      console.error(`DataImporter: Failed to import messages for conversation ${oldConvId}:`, error)
      throw error
    }
  }

  /**
   * 导入消息的附件
   * @param oldMsgId 原消息ID
   * @param newMsgId 新消息ID
   */
  private importAttachments(oldMsgId: string, newMsgId: string): void {
    try {
      // 获取消息的所有附件
      const attachments = this.sourceDb
        .prepare(
          `SELECT
            attach_id, attachment_type, file_name, file_size,
            storage_type, storage_path, thumbnail, vectorized,
            data_summary, mime_type, created_at
          FROM attachments
          WHERE message_id = ?`
        )
        .all(oldMsgId) as any[]

      console.log(`DataImporter: Found ${attachments.length} attachments for message ${oldMsgId}`)

      // 逐个导入附件
      for (const attachment of attachments) {
        const newAttachId = nanoid()
        this.idMappings.attachments.set(attachment.attach_id, newAttachId)

        // 处理存储路径
        let storagePath = attachment.storage_path
        if (storagePath && attachment.storage_type === 'path') {
          // 如果是文件路径，可能需要复制文件或调整路径
          // 这里简单处理，实际应用中可能需要更复杂的逻辑
          storagePath = path.basename(storagePath)
        }

        // 插入附件
        this.targetDb
          .prepare(
            `INSERT INTO attachments (
              attach_id, message_id, attachment_type, file_name,
              file_size, storage_type, storage_path, thumbnail,
              vectorized, data_summary, mime_type, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            newAttachId,
            newMsgId,
            attachment.attachment_type,
            attachment.file_name,
            attachment.file_size || 0,
            attachment.storage_type,
            storagePath,
            attachment.thumbnail,
            attachment.vectorized || 0,
            attachment.data_summary,
            attachment.mime_type,
            attachment.created_at
          )
      }
    } catch (error) {
      console.error(`DataImporter: Failed to import attachments for message ${oldMsgId}:`, error)
      throw error
    }
  }

  /**
   * 导入消息的附件（message_attachments表）
   * @param oldMsgId 原消息ID
   * @param newMsgId 新消息ID
   */
  private importMessageAttachments(oldMsgId: string, newMsgId: string): void {
    try {
      // 获取消息的所有message_attachments - 兼容不同的schema版本
      let messageAttachments: any[]

      try {
        // 首先尝试包含metadata字段的查询
        messageAttachments = this.sourceDb
          .prepare(
            `SELECT
              attachment_id, type, content, created_at, metadata
            FROM message_attachments
            WHERE message_id = ?`
          )
          .all(oldMsgId) as any[]
      } catch (queryError) {
        // 如果失败，使用不包含metadata的查询（兼容新版本schema）
        console.warn(
          `DataImporter: Failed to query message_attachments with metadata field, trying without metadata:`,
          queryError
        )
        messageAttachments = this.sourceDb
          .prepare(
            `SELECT
              attachment_id, type, content, created_at
            FROM message_attachments
            WHERE message_id = ?`
          )
          .all(oldMsgId) as any[]

        // 为缺失的字段设置默认值
        messageAttachments = messageAttachments.map((attachment) => ({
          ...attachment,
          metadata: null
        }))
      }

      console.log(
        `DataImporter: Found ${messageAttachments.length} message attachments for message ${oldMsgId}`
      )

      // 逐个导入message_attachments
      for (const attachment of messageAttachments) {
        const newAttachmentId = nanoid()

        try {
          // 首先尝试包含metadata字段的INSERT
          this.targetDb
            .prepare(
              `INSERT INTO message_attachments (
                attachment_id, message_id, type, content, created_at, metadata
              ) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
              newAttachmentId,
              newMsgId,
              attachment.type,
              attachment.content,
              attachment.created_at,
              attachment.metadata
            )
        } catch (insertError) {
          // 如果失败，使用不包含metadata的INSERT（兼容新版本schema）
          console.warn(
            `DataImporter: Failed to insert message_attachment with metadata, trying without metadata:`,
            insertError
          )
          this.targetDb
            .prepare(
              `INSERT INTO message_attachments (
                attachment_id, message_id, type, content, created_at
              ) VALUES (?, ?, ?, ?, ?)`
            )
            .run(
              newAttachmentId,
              newMsgId,
              attachment.type,
              attachment.content,
              attachment.created_at
            )
        }
      }
    } catch (error) {
      console.error(
        `DataImporter: Failed to import message attachments for message ${oldMsgId}:`,
        error
      )
      throw error
    }
  }

  /**
   * 关闭数据库连接
   */
  public close(): void {
    if (this.sourceDb) {
      this.sourceDb.close()
    }
    if (this.targetDb) {
      this.targetDb.close()
    }
  }
}
