import fs from 'fs'
import { PGlite } from '@electric-sql/pglite'
import { nanoid } from 'nanoid'
import {
  IDatabasePresenter,
  SQLITE_MESSAGE,
  CONVERSATION,
  CONVERSATION_SETTINGS
} from '@shared/presenter'

export class PglitePresenter implements IDatabasePresenter {
  private pgLite!: PGlite
  private dbPath: string
  private currentVersion: number = 0
  private isConnected: boolean = false

  constructor(dbPath: string, password?: string) {
    this.dbPath = dbPath
    // 在构造函数中启动初始化，但不等待完成
    // 实际使用中可能需要调整为等待初始化完成
    this.initialize(password).catch((error) => {
      console.error('Failed to initialize PGLite database:', error)
    })
  }

  private async initialize(password?: string): Promise<void> {
    try {
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true })
      }
      // 初始化PGlite实例
      this.pgLite = await PGlite.create(this.dbPath)
      this.isConnected = true

      // 如果有密码，设置加密（PGLite可能需要额外配置）
      if (password) {
        // TODO: 根据PGLite的实际加密支持实现
        console.log('Password encryption not yet implemented for PGLite')
      }

      // 初始化表结构
      await this.initTables()
      await this.initVersionTable()
      await this.migrate()
    } catch (error) {
      console.error('PGLite database initialization failed:', error)

      if (this.pgLite) {
        try {
          await this.pgLite.close()
        } catch (closeError) {
          console.error('Error closing PGLite database:', closeError)
        }
      }

      // 备份现有的损坏数据库
      this.backupDatabase()

      // 删除现有的数据库文件
      this.cleanupDatabaseFiles()

      // 重新创建数据库
      this.pgLite = await PGlite.create(this.dbPath)
      this.isConnected = true

      if (password) {
        console.log('Password encryption not yet implemented for PGLite')
      }

      await this.initTables()
      await this.initVersionTable()
      await this.migrate()
    }
  }

  private backupDatabase(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = `${this.dbPath}.${timestamp}.bak`

    try {
      if (fs.existsSync(this.dbPath)) {
        fs.copyFileSync(this.dbPath, backupPath)
        console.log(`Database backed up to: ${backupPath}`)
      }
    } catch (error) {
      console.error('Error creating database backup:', error)
    }
  }

  private cleanupDatabaseFiles(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        fs.unlinkSync(this.dbPath)
        console.log(`Deleted file: ${this.dbPath}`)
      }
    } catch (error) {
      console.error(`Error deleting file ${this.dbPath}:`, error)
    }
  }

  private async initTables(): Promise<void> {
    // 创建对话表
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        conv_id VARCHAR PRIMARY KEY,
        title VARCHAR,
        created_at BIGINT,
        updated_at BIGINT,
        system_prompt TEXT,
        temperature REAL,
        context_length INTEGER,
        max_tokens INTEGER,
        provider_id VARCHAR,
        model_id VARCHAR,
        is_new INTEGER,
        artifacts INTEGER,
        is_pinned INTEGER,
        enabled_mcp_tools JSONB,
        thinking_budget INTEGER,
        reasoning_effort VARCHAR,
        verbosity VARCHAR
      )
    `)

    // 创建消息表
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        message_id VARCHAR PRIMARY KEY,
        conv_id VARCHAR,
        content TEXT,
        role VARCHAR,
        parent_id VARCHAR,
        created_at BIGINT,
        metadata JSONB,
        order_seq INTEGER,
        token_count INTEGER,
        status VARCHAR,
        is_context_edge INTEGER,
        is_variant INTEGER,
        FOREIGN KEY (conv_id) REFERENCES conversations(conv_id)
      )
    `)

    // 创建附件表
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id VARCHAR PRIMARY KEY,
        message_id VARCHAR,
        type VARCHAR,
        data TEXT,
        created_at BIGINT,
        FOREIGN KEY (message_id) REFERENCES messages(message_id)
      )
    `)

    // 创建消息附件关联表
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id VARCHAR PRIMARY KEY,
        message_id VARCHAR,
        attachment_type VARCHAR,
        attachment_data TEXT,
        created_at BIGINT,
        FOREIGN KEY (message_id) REFERENCES messages(message_id)
      )
    `)

    // 创建索引
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conv_id);
      CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
      CREATE INDEX IF NOT EXISTS idx_messages_order_seq ON messages(order_seq);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);
    `)
  }

  private async initVersionTable(): Promise<void> {
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `)

    const result = await this.pgLite.query('SELECT MAX(version) as version FROM schema_versions')
    const row = result.rows[0] as { version: number | null }
    this.currentVersion = row?.version || 0
  }

  private async migrate(): Promise<void> {
    // 基础迁移逻辑，可以根据需要扩展
    console.log(`Current database version: ${this.currentVersion}`)
    // TODO: 实现具体的迁移逻辑
  }

  // 关闭数据库连接
  public async close(): Promise<void> {
    if (this.pgLite && this.isConnected) {
      await this.pgLite.close()
      this.isConnected = false
    }
  }

  // 创建新对话
  public async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {}
  ): Promise<string> {
    const convId = nanoid()
    const now = Date.now()

    await this.pgLite.query(
      `
      INSERT INTO conversations (
        conv_id, title, created_at, updated_at,
        system_prompt, temperature, context_length, max_tokens,
        provider_id, model_id, is_new, artifacts, is_pinned,
        enabled_mcp_tools, thinking_budget, reasoning_effort, verbosity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `,
      [
        convId,
        title,
        now,
        now,
        settings.systemPrompt || '',
        settings.temperature || 0.7,
        settings.contextLength || 4000,
        settings.maxTokens || 2000,
        settings.providerId || 'openai',
        settings.modelId || 'gpt-4',
        1,
        settings.artifacts || 0,
        0,
        JSON.stringify(settings.enabledMcpTools || []),
        settings.thinkingBudget,
        settings.reasoningEffort,
        settings.verbosity
      ]
    )

    return convId
  }

  // 获取对话信息
  public async getConversation(conversationId: string): Promise<CONVERSATION> {
    const result = await this.pgLite.query('SELECT * FROM conversations WHERE conv_id = $1', [
      conversationId
    ])

    if (result.rows.length === 0) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    return this.rowToConversation(result.rows[0])
  }

  private rowToConversation(row: any): CONVERSATION {
    return {
      id: row.conv_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      is_new: row.is_new,
      artifacts: row.artifacts,
      is_pinned: row.is_pinned,
      settings: {
        systemPrompt: row.system_prompt,
        temperature: row.temperature,
        contextLength: row.context_length,
        maxTokens: row.max_tokens,
        providerId: row.provider_id,
        modelId: row.model_id,
        artifacts: row.artifacts as 0 | 1,
        enabledMcpTools:
          typeof row.enabled_mcp_tools === 'string'
            ? JSON.parse(row.enabled_mcp_tools)
            : row.enabled_mcp_tools,
        thinkingBudget: row.thinking_budget,
        reasoningEffort: row.reasoning_effort,
        verbosity: row.verbosity
      }
    }
  }

  // 更新对话信息
  public async updateConversation(
    conversationId: string,
    data: Partial<CONVERSATION>
  ): Promise<void> {
    const updates: string[] = []
    const values: any[] = []
    let paramIndex = 1
    let shouldUpdateTime = true

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        if (key === 'settings') {
          // 处理settings对象的各个字段
          const settings = value as Partial<CONVERSATION_SETTINGS>
          Object.entries(settings).forEach(([settingKey, settingValue]) => {
            if (settingValue !== undefined) {
              const dbKey = this.camelToSnake(settingKey)
              if (settingKey === 'enabledMcpTools') {
                updates.push(`${dbKey} = $${paramIndex}`)
                values.push(JSON.stringify(settingValue))
              } else {
                updates.push(`${dbKey} = $${paramIndex}`)
                values.push(settingValue)
              }
              paramIndex++
            }
          })
        } else if (key === 'updatedAt') {
          // 如果明确指定了updatedAt，则使用指定的值，不自动设置
          updates.push('updated_at = $' + paramIndex)
          values.push(value)
          paramIndex++
          shouldUpdateTime = false
        } else {
          const dbKey = this.camelToSnake(key)
          updates.push(`${dbKey} = $${paramIndex}`)
          values.push(value)
          paramIndex++
        }
      }
    })

    if (updates.length > 0) {
      // 只有在没有明确指定updatedAt时才自动设置
      if (shouldUpdateTime) {
        updates.push(`updated_at = $${paramIndex}`)
        values.push(Date.now())
        paramIndex++
      }

      values.push(conversationId)
      const sql = `UPDATE conversations SET ${updates.join(', ')} WHERE conv_id = $${paramIndex}`
      await this.pgLite.query(sql, values)
    }
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
  }

  // 获取对话列表
  public async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    const offset = (page - 1) * pageSize

    // 获取总数
    const countResult = await this.pgLite.query('SELECT COUNT(*) as total FROM conversations')
    const total = (countResult.rows[0] as { total: number }).total

    // 获取列表
    const listResult = await this.pgLite.query(
      'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT $1 OFFSET $2',
      [pageSize, offset]
    )

    const list = listResult.rows.map((row) => this.rowToConversation(row))

    return { total, list }
  }

  // 获取对话总数
  public async getConversationCount(): Promise<number> {
    const result = await this.pgLite.query('SELECT COUNT(*) as total FROM conversations')
    return (result.rows[0] as { total: number }).total
  }

  // 删除对话
  public async deleteConversation(conversationId: string): Promise<void> {
    await this.runTransaction(async () => {
      // 删除相关的消息附件
      await this.pgLite.query(
        'DELETE FROM message_attachments WHERE message_id IN (SELECT message_id FROM messages WHERE conv_id = $1)',
        [conversationId]
      )

      // 删除相关的附件
      await this.pgLite.query(
        'DELETE FROM attachments WHERE message_id IN (SELECT message_id FROM messages WHERE conv_id = $1)',
        [conversationId]
      )

      // 删除相关的消息
      await this.pgLite.query('DELETE FROM messages WHERE conv_id = $1', [conversationId])

      // 删除对话
      await this.pgLite.query('DELETE FROM conversations WHERE conv_id = $1', [conversationId])
    })
  }

  // 重命名对话
  public async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    await this.updateConversation(conversationId, { title })
    return this.getConversation(conversationId)
  }

  // 插入消息
  public async insertMessage(
    conversationId: string,
    content: string,
    role: string,
    parentId: string,
    metadata: string = '{}',
    orderSeq: number = 0,
    tokenCount: number = 0,
    status: string = 'pending',
    isContextEdge: number = 0,
    isVariant: number = 0
  ): Promise<string> {
    const messageId = nanoid()
    const now = Date.now()

    await this.pgLite.query(
      `
      INSERT INTO messages (
        message_id, conv_id, content, role, parent_id, created_at,
        metadata, order_seq, token_count, status, is_context_edge, is_variant
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
      [
        messageId,
        conversationId,
        content,
        role,
        parentId,
        now,
        metadata,
        orderSeq,
        tokenCount,
        status,
        isContextEdge,
        isVariant
      ]
    )

    return messageId
  }

  // 查询消息
  public async queryMessages(conversationId: string): Promise<SQLITE_MESSAGE[]> {
    const result = await this.pgLite.query(
      'SELECT * FROM messages WHERE conv_id = $1 ORDER BY order_seq ASC',
      [conversationId]
    )

    return result.rows.map((row) => this.rowToSQLiteMessage(row))
  }

  private rowToSQLiteMessage(row: any): SQLITE_MESSAGE {
    return {
      id: row.message_id,
      conversation_id: row.conv_id,
      parent_id: row.parent_id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      order_seq: row.order_seq,
      token_count: row.token_count,
      status: row.status,
      metadata: typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata),
      is_context_edge: row.is_context_edge,
      is_variant: row.is_variant
    }
  }

  // 更新消息
  public async updateMessage(
    messageId: string,
    data: {
      content?: string
      status?: string
      metadata?: string
      isContextEdge?: number
      tokenCount?: number
    }
  ): Promise<void> {
    const updates: string[] = []
    const values: any[] = []
    let paramIndex = 1

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbKey = this.camelToSnake(key)
        updates.push(`${dbKey} = $${paramIndex}`)
        values.push(value)
        paramIndex++
      }
    })

    if (updates.length > 0) {
      values.push(messageId)
      const sql = `UPDATE messages SET ${updates.join(', ')} WHERE message_id = $${paramIndex}`
      await this.pgLite.query(sql, values)
    }
  }

  // 删除消息
  public async deleteMessage(messageId: string): Promise<void> {
    await this.runTransaction(async () => {
      await this.pgLite.query('DELETE FROM message_attachments WHERE message_id = $1', [messageId])
      await this.pgLite.query('DELETE FROM attachments WHERE message_id = $1', [messageId])
      await this.pgLite.query('DELETE FROM messages WHERE message_id = $1', [messageId])
    })
  }

  // 获取单条消息
  public async getMessage(messageId: string): Promise<SQLITE_MESSAGE | null> {
    const result = await this.pgLite.query('SELECT * FROM messages WHERE message_id = $1', [
      messageId
    ])

    if (result.rows.length === 0) {
      return null
    }

    return this.rowToSQLiteMessage(result.rows[0])
  }

  // 获取消息变体
  public async getMessageVariants(messageId: string): Promise<SQLITE_MESSAGE[]> {
    const message = await this.getMessage(messageId)
    if (!message) {
      return []
    }

    const result = await this.pgLite.query(
      'SELECT * FROM messages WHERE parent_id = $1 AND conv_id = $2 AND is_variant = 1',
      [message.parent_id, message.conversation_id]
    )

    return result.rows.map((row) => this.rowToSQLiteMessage(row))
  }

  // 获取会话的最大消息序号
  public async getMaxOrderSeq(conversationId: string): Promise<number> {
    const result = await this.pgLite.query(
      'SELECT MAX(order_seq) as max_seq FROM messages WHERE conv_id = $1',
      [conversationId]
    )

    const row = result.rows[0] as { max_seq: number | null }
    return row?.max_seq || 0
  }

  // 删除所有消息
  public async deleteAllMessages(): Promise<void> {
    await this.runTransaction(async () => {
      await this.pgLite.query('DELETE FROM message_attachments')
      await this.pgLite.query('DELETE FROM attachments')
      await this.pgLite.query('DELETE FROM messages')
    })
  }

  // 执行事务
  public async runTransaction(operations: () => void): Promise<void> {
    await this.pgLite.transaction(async () => {
      await (operations as any)()
    })
  }

  // 获取最后一条用户消息
  public async getLastUserMessage(conversationId: string): Promise<SQLITE_MESSAGE | null> {
    const result = await this.pgLite.query(
      'SELECT * FROM messages WHERE conv_id = $1 AND role = $2 ORDER BY order_seq DESC LIMIT 1',
      [conversationId, 'user']
    )

    if (result.rows.length === 0) {
      return null
    }

    return this.rowToSQLiteMessage(result.rows[0])
  }

  // 根据父ID获取主消息
  public async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<SQLITE_MESSAGE | null> {
    const result = await this.pgLite.query(
      'SELECT * FROM messages WHERE conv_id = $1 AND parent_id = $2 AND is_variant = 0 ORDER BY order_seq ASC LIMIT 1',
      [conversationId, parentId]
    )

    if (result.rows.length === 0) {
      return null
    }

    return this.rowToSQLiteMessage(result.rows[0])
  }

  // 删除对话中的所有消息
  public async deleteAllMessagesInConversation(conversationId: string): Promise<void> {
    await this.runTransaction(async () => {
      await this.pgLite.query(
        'DELETE FROM message_attachments WHERE message_id IN (SELECT message_id FROM messages WHERE conv_id = $1)',
        [conversationId]
      )
      await this.pgLite.query(
        'DELETE FROM attachments WHERE message_id IN (SELECT message_id FROM messages WHERE conv_id = $1)',
        [conversationId]
      )
      await this.pgLite.query('DELETE FROM messages WHERE conv_id = $1', [conversationId])
    })
  }

  // 添加消息附件
  public async addMessageAttachment(
    messageId: string,
    attachmentType: string,
    attachmentData: string
  ): Promise<void> {
    const id = nanoid()
    const now = Date.now()

    await this.pgLite.query(
      `
      INSERT INTO message_attachments (id, message_id, attachment_type, attachment_data, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [id, messageId, attachmentType, attachmentData, now]
    )
  }

  // 获取消息附件
  public async getMessageAttachments(
    messageId: string,
    type: string
  ): Promise<{ content: string }[]> {
    const result = await this.pgLite.query(
      'SELECT attachment_data FROM message_attachments WHERE message_id = $1 AND attachment_type = $2',
      [messageId, type]
    )

    return result.rows.map((row) => ({ content: (row as any).attachment_data }))
  }
}
