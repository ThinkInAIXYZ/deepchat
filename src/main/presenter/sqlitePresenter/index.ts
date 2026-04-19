import Database from 'better-sqlite3-multiple-ciphers'
import path from 'path'
import fs from 'fs'
import { ConversationsTable } from './tables/conversations'
import { MessagesTable } from './tables/messages'
import {
  DatabaseRepairReport,
  DatabaseSchemaDiagnosis,
  ISQLitePresenter,
  SQLITE_MESSAGE,
  CONVERSATION,
  CONVERSATION_SETTINGS,
  AcpSessionEntity,
  AgentSessionLifecycleStatus
} from '@shared/presenter'
import { MessageAttachmentsTable } from './tables/messageAttachments'
import { AcpSessionsTable, type AcpSessionUpsertData } from './tables/acpSessions'
import { NewEnvironmentsTable } from './tables/newEnvironments'
import { NewSessionsTable } from './tables/newSessions'
import { NewProjectsTable } from './tables/newProjects'
import { DeepChatSessionsTable } from './tables/deepchatSessions'
import { DeepChatMessagesTable } from './tables/deepchatMessages'
import { DeepChatMessageTracesTable } from './tables/deepchatMessageTraces'
import { DeepChatMessageSearchResultsTable } from './tables/deepchatMessageSearchResults'
import { DeepChatPendingInputsTable } from './tables/deepchatPendingInputs'
import { DeepChatUsageStatsTable } from './tables/deepchatUsageStats'
import { LegacyImportStatusTable } from './tables/legacyImportStatus'
import { AgentsTable } from './tables/agents'
import { DatabaseRepairService, SchemaInspector } from './schemaRepair'

const DESTRUCTIVE_DATABASE_ERROR_PATTERNS = [
  /database disk image is malformed/i,
  /file is not a database/i,
  /SQLITE_CORRUPT/i,
  /SQLITE_NOTADB/i
]

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }

  return String(error ?? '')
}

export function isDestructiveDatabaseError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return DESTRUCTIVE_DATABASE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

function ensureDatabaseDirectory(dbPath: string): void {
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
}

function configureDatabaseConnection(db: Database.Database, password?: string): void {
  if (password) {
    db.pragma(`cipher='sqlcipher'`)
    const hexPassword = Buffer.from(password, 'utf8').toString('hex')
    db.pragma(`key = "x'${hexPassword}'"`)
  }

  db.pragma('journal_mode = WAL')
}

export function openSQLiteDatabase(dbPath: string, password?: string): Database.Database {
  ensureDatabaseDirectory(dbPath)
  const db = new Database(dbPath)
  configureDatabaseConnection(db, password)
  return db
}

export function repairSQLiteDatabaseFile(dbPath: string, password?: string): DatabaseRepairReport {
  const db = openSQLiteDatabase(dbPath, password)

  try {
    return new DatabaseRepairService(db, dbPath).repair()
  } finally {
    db.close()
  }
}

function stripLeadingSqlComments(statement: string): string {
  return statement.replace(/^\s*(--[^\n]*(?:\r?\n|$))+/g, '').trim()
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') {
        while (index + 1 < sql.length && sql[index + 1] !== '\n' && sql[index + 1] !== '\r') {
          index += 1
        }
        continue
      }

      if (char === '/' && next === '*') {
        if (current.length > 0 && !/\s$/.test(current)) {
          current += ' '
        }

        index += 2
        while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
          index += 1
        }

        if (index >= sql.length) {
          break
        }

        index += 1
        continue
      }
    }

    if (char === "'" && !inDoubleQuote) {
      current += char
      if (inSingleQuote && next === "'") {
        current += next
        index += 1
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim()
      if (trimmed) {
        statements.push(trimmed)
      }
      current = ''
      continue
    }

    current += char
  }

  const trailing = current.trim()
  if (trailing) {
    statements.push(trailing)
  }

  return statements
}

function shouldIgnoreMigrationStatementError(statement: string, error: unknown): boolean {
  const normalizedStatement = stripLeadingSqlComments(statement).toUpperCase()
  const message = getErrorMessage(error)

  if (
    /^ALTER TABLE\b[\s\S]*\bADD COLUMN\b/.test(normalizedStatement) &&
    /duplicate column name/i.test(message)
  ) {
    return true
  }

  if (/^CREATE(?: UNIQUE)? INDEX\b/.test(normalizedStatement) && /already exists/i.test(message)) {
    return true
  }

  if (
    /^ALTER TABLE\b[\s\S]*\bDROP COLUMN\b/.test(normalizedStatement) &&
    /no such column/i.test(message)
  ) {
    return true
  }

  return false
}

/**
 * 导入模式枚举
 */
export enum ImportMode {
  INCREMENT = 'increment', // 增量导入
  OVERWRITE = 'overwrite' // 覆盖导入
}

export class SQLitePresenter implements ISQLitePresenter {
  private db!: Database.Database
  private conversationsTable!: ConversationsTable
  private messagesTable!: MessagesTable
  private messageAttachmentsTable!: MessageAttachmentsTable
  private acpSessionsTable!: AcpSessionsTable
  public newEnvironmentsTable!: NewEnvironmentsTable
  public newSessionsTable!: NewSessionsTable
  public newProjectsTable!: NewProjectsTable
  public deepchatSessionsTable!: DeepChatSessionsTable
  public deepchatMessagesTable!: DeepChatMessagesTable
  public deepchatMessageTracesTable!: DeepChatMessageTracesTable
  public deepchatMessageSearchResultsTable!: DeepChatMessageSearchResultsTable
  public deepchatPendingInputsTable!: DeepChatPendingInputsTable
  public deepchatUsageStatsTable!: DeepChatUsageStatsTable
  public legacyImportStatusTable!: LegacyImportStatusTable
  public agentsTable!: AgentsTable
  private currentVersion: number = 0
  private dbPath: string
  private password?: string
  private destructiveInitializationRetryCount = 0

  constructor(dbPath: string, password?: string) {
    this.dbPath = dbPath
    this.password = password
    try {
      this.initializeDatabase()
    } catch (error) {
      this.handleInitializationError(error)
    }
  }

  async deleteAllMessagesInConversation(conversationId: string): Promise<void> {
    return this.messagesTable.deleteAllInConversation(conversationId)
  }

  public getDatabase(): Database.Database {
    return this.db
  }

  public async diagnoseSchema(): Promise<DatabaseSchemaDiagnosis> {
    return new SchemaInspector(this.db).diagnose()
  }

  public async repairSchema(): Promise<DatabaseRepairReport> {
    return new DatabaseRepairService(this.db, this.dbPath).repair()
  }

  private initializeDatabase(): void {
    this.db = openSQLiteDatabase(this.dbPath, this.password)
    this.db.prepare('SELECT 1').get()
    this.initTables()
    this.initVersionTable()
    this.migrate()
  }

  private handleInitializationError(error: unknown): void {
    console.error('Database initialization failed:', error)

    if (isDestructiveDatabaseError(error)) {
      if (this.destructiveInitializationRetryCount > 0) {
        console.error('Destructive database recovery was already attempted once; aborting retry.')
        this.closeDatabaseSilently()
        throw error
      }

      this.destructiveInitializationRetryCount += 1
      this.backupDatabase()
      this.closeDatabaseSilently()
      this.cleanupDatabaseFiles()
      try {
        this.initializeDatabase()
      } catch (retryError) {
        this.handleInitializationError(retryError)
      }
      return
    }

    this.closeDatabaseSilently()
    throw error
  }

  private closeDatabaseSilently(): void {
    if (!this.db) {
      return
    }

    try {
      this.db.close()
    } catch (error) {
      console.error('Error closing database:', error)
    }
  }

  private backupDatabase(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = `${this.dbPath}.${timestamp}.bak`

    try {
      if (fs.existsSync(this.dbPath)) {
        if (this.db?.open) {
          this.db.pragma('wal_checkpoint(TRUNCATE)')
        }
        fs.copyFileSync(this.dbPath, backupPath)
        console.log(`Database backed up to: ${backupPath}`)
      }
    } catch (error) {
      console.error('Error creating database backup:', error)
    }
  }

  private cleanupDatabaseFiles(): void {
    const filesToDelete = [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]

    for (const file of filesToDelete) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file)
          console.log(`Deleted file: ${file}`)
        }
      } catch (error) {
        console.error(`Error deleting file ${file}:`, error)
      }
    }
  }

  renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    this.conversationsTable.rename(conversationId, title)
    return this.getConversation(conversationId)
  }

  private initTables() {
    this.conversationsTable = new ConversationsTable(this.db)
    this.messagesTable = new MessagesTable(this.db)
    this.messageAttachmentsTable = new MessageAttachmentsTable(this.db)
    this.acpSessionsTable = new AcpSessionsTable(this.db)
    this.newEnvironmentsTable = new NewEnvironmentsTable(this.db)
    this.newSessionsTable = new NewSessionsTable(this.db)
    this.newProjectsTable = new NewProjectsTable(this.db)
    this.deepchatSessionsTable = new DeepChatSessionsTable(this.db)
    this.deepchatMessagesTable = new DeepChatMessagesTable(this.db)
    this.deepchatMessageTracesTable = new DeepChatMessageTracesTable(this.db)
    this.deepchatMessageSearchResultsTable = new DeepChatMessageSearchResultsTable(this.db)
    this.deepchatPendingInputsTable = new DeepChatPendingInputsTable(this.db)
    this.deepchatUsageStatsTable = new DeepChatUsageStatsTable(this.db)
    this.legacyImportStatusTable = new LegacyImportStatusTable(this.db)
    this.agentsTable = new AgentsTable(this.db)

    // Create only active tables for the new stack.
    this.acpSessionsTable.createTable()
    this.newEnvironmentsTable.createTable()
    this.newSessionsTable.createTable()
    this.newProjectsTable.createTable()
    this.deepchatSessionsTable.createTable()
    this.deepchatMessagesTable.createTable()
    this.deepchatMessageTracesTable.createTable()
    this.deepchatMessageSearchResultsTable.createTable()
    this.deepchatPendingInputsTable.createTable()
    this.deepchatUsageStatsTable.createTable()
    this.legacyImportStatusTable.createTable()
    this.agentsTable.createTable()
  }

  private initVersionTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)

    const result = this.db.prepare('SELECT MAX(version) as version FROM schema_versions').get() as {
      version: number
      applied_at: number
    }
    this.currentVersion = result?.version || 0
  }

  private migrate() {
    // 获取所有表的迁移脚本
    const migrations = new Map<number, string[]>()
    const tables = [
      this.acpSessionsTable,
      this.newEnvironmentsTable,
      this.newSessionsTable,
      this.newProjectsTable,
      this.deepchatSessionsTable,
      this.deepchatMessagesTable,
      this.deepchatMessageTracesTable,
      this.deepchatMessageSearchResultsTable,
      this.deepchatPendingInputsTable,
      this.deepchatUsageStatsTable,
      this.legacyImportStatusTable,
      this.agentsTable
    ]

    // 获取最新的迁移版本
    const latestVersion = tables.reduce((maxVersion, table) => {
      const tableMaxVersion = table.getLatestVersion?.() || 0
      return Math.max(maxVersion, tableMaxVersion)
    }, 0)

    // 只迁移未执行的版本
    tables.forEach((table) => {
      for (let version = this.currentVersion + 1; version <= latestVersion; version++) {
        const sql = table.getMigrationSQL?.(version)
        if (sql) {
          if (!migrations.has(version)) {
            migrations.set(version, [])
          }
          migrations.get(version)?.push(sql)
        }
      }
    })

    // 按版本号顺序执行迁移
    const versions = Array.from(migrations.keys()).sort((a, b) => a - b)

    for (const version of versions) {
      const migrationSQLs = migrations.get(version) || []
      if (migrationSQLs.length > 0) {
        console.log(`Executing migration version ${version}`)
        this.db.transaction(() => {
          migrationSQLs.forEach((sqlBlock) => {
            for (const statement of splitSqlStatements(sqlBlock)) {
              console.log(`Executing SQL: ${statement}`)
              try {
                this.db.exec(statement)
              } catch (error) {
                if (shouldIgnoreMigrationStatementError(statement, error)) {
                  console.warn(`Ignoring migration statement error for: ${statement}`, error)
                  continue
                }

                throw error
              }
            }
          })
          this.db
            .prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)')
            .run(version, Date.now())
        })()
      }
    }
  }

  // 关闭数据库连接
  public close() {
    try {
      this.db.close()
    } catch (error) {
      console.warn('Failed to close database:', error)
    }
  }

  public reopen() {
    try {
      this.close()
      this.initializeDatabase()
    } catch (error) {
      console.error('Failed to reopen database:', error)
      throw error
    }
  }

  public async clearNewAgentData(): Promise<void> {
    await this.runTransaction(() => {
      // Keep project metadata and legacy import status; clear session/message domain data only.
      this.db.exec(`
        DELETE FROM deepchat_message_search_results;
        DELETE FROM deepchat_message_traces;
        DELETE FROM deepchat_messages;
        DELETE FROM deepchat_usage_stats;
        DELETE FROM deepchat_sessions;
        DELETE FROM new_environments;
        DELETE FROM new_sessions;
      `)
    })
  }

  public async importLegacyChatDb(
    sourceDbPath: string,
    mode: 'increment' | 'overwrite'
  ): Promise<{
    importedSessions: number
    importedMessages: number
    importedSearchResults: number
  }> {
    const { LegacyChatImportService } = await import('../agentSessionPresenter/legacyImportService')
    const service = new LegacyChatImportService(this)
    return await service.importFromSourceDb(sourceDbPath, mode)
  }

  // 创建新对话
  public async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {}
  ): Promise<string> {
    return this.conversationsTable.create(title, settings)
  }

  // 获取对话信息
  public async getConversation(conversationId: string): Promise<CONVERSATION> {
    return this.conversationsTable.get(conversationId)
  }

  // 更新对话信息
  public async updateConversation(
    conversationId: string,
    data: Partial<CONVERSATION>
  ): Promise<void> {
    return this.conversationsTable.update(conversationId, data)
  }

  // 获取对话列表
  public async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return this.conversationsTable.list(page, pageSize)
  }

  public async listChildConversationsByParent(
    parentConversationId: string
  ): Promise<CONVERSATION[]> {
    return this.conversationsTable.listByParentConversationId(parentConversationId)
  }

  public async listChildConversationsByMessageIds(
    parentMessageIds: string[]
  ): Promise<CONVERSATION[]> {
    return this.conversationsTable.listByParentMessageIds(parentMessageIds)
  }

  // 获取对话总数
  public async getConversationCount(): Promise<number> {
    return this.conversationsTable.count()
  }

  // 删除对话
  public async deleteConversation(conversationId: string): Promise<void> {
    await this.conversationsTable.delete(conversationId)
    await this.acpSessionsTable.deleteByConversation(conversationId)
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
    return this.messagesTable.insert(
      conversationId,
      content,
      role,
      parentId,
      metadata,
      orderSeq,
      tokenCount,
      status,
      isContextEdge,
      isVariant
    )
  }

  // 查询消息
  public async queryMessages(conversationId: string): Promise<SQLITE_MESSAGE[]> {
    return this.messagesTable.query(conversationId)
  }

  public async queryMessageIds(conversationId: string): Promise<string[]> {
    return this.messagesTable.queryIds(conversationId)
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
    return this.messagesTable.update(messageId, data)
  }

  // 更新消息父ID
  public async updateMessageParentId(messageId: string, parentId: string): Promise<void> {
    return this.messagesTable.updateParentId(messageId, parentId)
  }

  // 删除消息
  public async deleteMessage(messageId: string): Promise<void> {
    return this.messagesTable.delete(messageId)
  }

  // 获取单条消息
  public async getMessage(messageId: string): Promise<SQLITE_MESSAGE | null> {
    return this.messagesTable.get(messageId)
  }

  public async getMessagesByIds(messageIds: string[]): Promise<SQLITE_MESSAGE[]> {
    return this.messagesTable.getByIds(messageIds)
  }

  // 获取消息变体
  public async getMessageVariants(messageId: string): Promise<SQLITE_MESSAGE[]> {
    return this.messagesTable.getVariants(messageId)
  }

  // 获取会话的最大消息序号
  public async getMaxOrderSeq(conversationId: string): Promise<number> {
    return this.messagesTable.getMaxOrderSeq(conversationId)
  }

  // 删除所有消息
  public async deleteAllMessages(): Promise<void> {
    return this.messagesTable.deleteAll()
  }

  // 执行事务
  public async runTransaction(operations: () => void): Promise<void> {
    await this.db.transaction(operations)()
  }

  public async getLastUserMessage(conversationId: string): Promise<SQLITE_MESSAGE | null> {
    return this.messagesTable.getLastUserMessage(conversationId)
  }

  public async getLastAssistantMessage(conversationId: string): Promise<SQLITE_MESSAGE | null> {
    return this.messagesTable.getLastAssistantMessage(conversationId)
  }

  public async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<SQLITE_MESSAGE | null> {
    return this.messagesTable.getMainMessageByParentId(conversationId, parentId)
  }

  // 添加消息附件
  public async addMessageAttachment(
    messageId: string,
    attachmentType: string,
    attachmentData: string
  ): Promise<void> {
    return this.messageAttachmentsTable.add(messageId, attachmentType, attachmentData)
  }

  // 获取消息附件
  public async getMessageAttachments(
    messageId: string,
    type: string
  ): Promise<{ content: string }[]> {
    return this.messageAttachmentsTable.get(messageId, type)
  }

  // ACP session helpers
  public async getAcpSession(
    conversationId: string,
    agentId: string
  ): Promise<AcpSessionEntity | null> {
    const row = await this.acpSessionsTable.getByConversationAndAgent(conversationId, agentId)
    return row ? (row as AcpSessionEntity) : null
  }

  public async upsertAcpSession(
    conversationId: string,
    agentId: string,
    data: AcpSessionUpsertData
  ): Promise<void> {
    const affectedPaths = new Set(this.newEnvironmentsTable.listPathsForSession(conversationId))
    await this.acpSessionsTable.upsert(conversationId, agentId, data)
    for (const path of this.newEnvironmentsTable.listPathsForSession(conversationId)) {
      affectedPaths.add(path)
    }
    for (const path of affectedPaths) {
      this.newEnvironmentsTable.syncPath(path)
    }
  }

  public async updateAcpSessionId(
    conversationId: string,
    agentId: string,
    sessionId: string | null
  ): Promise<void> {
    await this.acpSessionsTable.updateSessionId(conversationId, agentId, sessionId)
  }

  public async updateAcpWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    const affectedPaths = new Set(this.newEnvironmentsTable.listPathsForSession(conversationId))
    await this.acpSessionsTable.updateWorkdir(conversationId, agentId, workdir)
    for (const path of this.newEnvironmentsTable.listPathsForSession(conversationId)) {
      affectedPaths.add(path)
    }
    for (const path of affectedPaths) {
      this.newEnvironmentsTable.syncPath(path)
    }
  }

  public async updateAcpSessionStatus(
    conversationId: string,
    agentId: string,
    status: AgentSessionLifecycleStatus
  ): Promise<void> {
    await this.acpSessionsTable.updateStatus(conversationId, agentId, status)
  }

  public async deleteAcpSessions(conversationId: string): Promise<void> {
    const affectedPaths = this.newEnvironmentsTable.listPathsForSession(conversationId)
    await this.acpSessionsTable.deleteByConversation(conversationId)
    for (const path of affectedPaths) {
      this.newEnvironmentsTable.syncPath(path)
    }
  }

  public async deleteAcpSession(conversationId: string, agentId: string): Promise<void> {
    const affectedPaths = this.newEnvironmentsTable.listPathsForSession(conversationId)
    await this.acpSessionsTable.deleteByConversationAndAgent(conversationId, agentId)
    for (const path of affectedPaths) {
      this.newEnvironmentsTable.syncPath(path)
    }
  }

  private hasTable(tableName: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(tableName) as { 1: number } | undefined

    return Boolean(row)
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    if (!this.hasTable(tableName)) {
      return false
    }

    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
    return rows.some((row) => row.name === columnName)
  }

  public async migrateAcpAgentReferences(aliasMap: Record<string, string>): Promise<void> {
    const entries = Object.entries(aliasMap).filter(([from, to]) => from && to && from !== to)
    if (!entries.length) {
      return
    }

    await this.runTransaction(() => {
      const hasNewSessions = this.hasTable('new_sessions')
      const hasAcpSessions = this.hasTable('acp_sessions')
      const hasDeepchatSessionModelRef =
        this.hasTable('deepchat_sessions') &&
        this.hasColumn('deepchat_sessions', 'provider_id') &&
        this.hasColumn('deepchat_sessions', 'model_id')

      for (const [from, to] of entries) {
        if (hasNewSessions) {
          this.db.prepare('UPDATE new_sessions SET agent_id = ? WHERE agent_id = ?').run(to, from)
        }

        if (hasAcpSessions) {
          this.db
            .prepare(
              `DELETE FROM acp_sessions
               WHERE agent_id = ?
                 AND EXISTS (
                   SELECT 1
                   FROM acp_sessions AS existing
                   WHERE existing.conversation_id = acp_sessions.conversation_id
                     AND existing.agent_id = ?
                 )`
            )
            .run(from, to)
          this.db.prepare('UPDATE acp_sessions SET agent_id = ? WHERE agent_id = ?').run(to, from)
        }

        if (hasDeepchatSessionModelRef) {
          this.db
            .prepare(
              `UPDATE deepchat_sessions
               SET model_id = ?
               WHERE provider_id = 'acp' AND model_id = ?`
            )
            .run(to, from)
        }
      }
    })
  }
}
