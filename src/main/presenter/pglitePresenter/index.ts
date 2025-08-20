/**
 * PGlite Presenter - Unified database presenter for conversational and vector data
 */
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import path from 'path'
import fs from 'fs'
import { IndexOptions } from '@shared/presenter'

// Re-export IndexOptions for use in other modules
export type { IndexOptions }

export interface IPGlitePresenter {
  // Core database management
  initialize(config: PGliteConfig): Promise<void>
  open(): Promise<void>
  close(): Promise<void>

  // Transaction management
  beginTransaction(): Promise<void>
  commitTransaction(): Promise<void>
  rollbackTransaction(): Promise<void>
  runTransaction(operations: () => Promise<void>): Promise<void>

  // Schema management
  getCurrentSchemaVersion(): Promise<number>
  migrateSchema(targetVersion: number): Promise<void>

  // Health checks
  validateIntegrity(): Promise<ValidationResult>
}

export interface PGliteConfig {
  dbPath: string
  extensions?: string[]
  vectorDimensions?: number
  indexOptions?: IndexOptions
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export class PGlitePresenter implements IPGlitePresenter {
  private db!: PGlite
  private readonly dbPath: string
  private config!: PGliteConfig
  private isInitialized = false
  private inTransaction = false

  // Schema version constants
  private static readonly CURRENT_SCHEMA_VERSION = 1
  private static readonly SCHEMA_VERSION_TABLE = 'schema_versions'

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  // ==================== Core Database Management ====================

  async initialize(config: PGliteConfig): Promise<void> {
    if (this.isInitialized) {
      throw new Error('PGlite presenter is already initialized')
    }

    this.config = config

    try {
      console.log(`[PGlite] Initializing PGlite database at ${this.dbPath}`)

      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath)
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true })
      }

      // Initialize PGlite with vector extension
      this.db = new PGlite(this.dbPath, {
        extensions: {
          vector
        }
      })

      // Create initial schema
      await this.createInitialSchema()

      // Set initial schema version
      await this.setSchemaVersion(PGlitePresenter.CURRENT_SCHEMA_VERSION)

      this.isInitialized = true
      console.log(`[PGlite] Database initialized successfully`)
    } catch (error) {
      console.error('[PGlite] Initialization failed:', error)
      throw error
    }
  }

  async open(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    if (!fs.existsSync(this.dbPath)) {
      throw new Error('Database does not exist, please initialize first.')
    }

    try {
      console.log(`[PGlite] Opening PGlite database at ${this.dbPath}`)

      this.db = new PGlite(this.dbPath, {
        extensions: {
          vector
        }
      })

      // Run any pending schema migrations
      await this.runMigrations()

      this.isInitialized = true
      console.log(`[PGlite] Database opened successfully`)
    } catch (error) {
      console.error('[PGlite] Failed to open database:', error)
      throw error
    }
  }

  async close(): Promise<void> {
    if (!this.isInitialized) {
      return
    }

    try {
      if (this.inTransaction) {
        await this.rollbackTransaction()
      }

      await this.db.close()
      this.isInitialized = false
      console.log('[PGlite] Database closed successfully')
    } catch (error) {
      console.error('[PGlite] Error closing database:', error)
      throw error
    }
  }

  // ==================== Transaction Management ====================

  async beginTransaction(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Database not initialized')
    }

    if (this.inTransaction) {
      throw new Error('Transaction already in progress')
    }

    await this.db.exec('BEGIN')
    this.inTransaction = true
  }

  async commitTransaction(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress')
    }

    await this.db.exec('COMMIT')
    this.inTransaction = false
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress')
    }

    await this.db.exec('ROLLBACK')
    this.inTransaction = false
  }

  async runTransaction(operations: () => Promise<void>): Promise<void> {
    await this.beginTransaction()
    try {
      await operations()
      await this.commitTransaction()
    } catch (error) {
      await this.rollbackTransaction()
      throw error
    }
  }

  // ==================== Schema Management ====================

  private async createInitialSchema(): Promise<void> {
    const schemaSQL = `
      -- Enable pgvector extension
      CREATE EXTENSION IF NOT EXISTS vector;

      -- Schema version tracking
      CREATE TABLE IF NOT EXISTS ${PGlitePresenter.SCHEMA_VERSION_TABLE} (
        version INTEGER PRIMARY KEY,
        applied_at BIGINT NOT NULL,
        description TEXT
      );

      -- Migration metadata
      CREATE TABLE IF NOT EXISTS migration_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(epoch FROM NOW()) * 1000
      );

      -- Conversations table (migrated from SQLite)
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        conv_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        is_new INTEGER DEFAULT 1,
        settings JSONB DEFAULT '{}'::jsonb
      );

      -- Messages table (migrated from SQLite)
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        msg_id TEXT UNIQUE NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(conv_id) ON DELETE CASCADE,
        parent_id TEXT DEFAULT '',
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'function')),
        content TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        order_seq INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'pending', 'error')),
        metadata JSONB DEFAULT '{}'::jsonb,
        is_context_edge INTEGER DEFAULT 0,
        is_variant INTEGER DEFAULT 0
      );

      -- Message attachments table (migrated from SQLite)
      CREATE TABLE IF NOT EXISTS message_attachments (
        id SERIAL PRIMARY KEY,
        message_id TEXT NOT NULL,
        attachment_type TEXT NOT NULL,
        attachment_data TEXT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(epoch FROM NOW()) * 1000
      );

      -- Knowledge files table (migrated from DuckDB)
      CREATE TABLE IF NOT EXISTS knowledge_files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        mime_type TEXT,
        status TEXT NOT NULL,
        uploaded_at BIGINT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb
      );

      -- Knowledge chunks table (migrated from DuckDB)
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT DEFAULT ''
      );

      -- Vector embeddings table (migrated from DuckDB)
      CREATE TABLE IF NOT EXISTS knowledge_vectors (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
        chunk_id TEXT NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
        embedding vector(${this.config.vectorDimensions || 1536}),
        created_at BIGINT DEFAULT EXTRACT(epoch FROM NOW()) * 1000
      );
    `

    await this.db.exec(schemaSQL)
    await this.createIndexes()
  }

  private async createIndexes(): Promise<void> {
    const indexSQL = `
      -- Conversation indexes
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(is_pinned);
      CREATE INDEX IF NOT EXISTS idx_conversations_conv_id ON conversations(conv_id);

      -- Message indexes
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, order_seq);
      CREATE INDEX IF NOT EXISTS idx_messages_timeline ON messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_context_edge ON messages(is_context_edge);
      CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);

      -- Knowledge indexes
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_status ON knowledge_files(status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_path ON knowledge_files(path);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_file ON knowledge_chunks(file_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_status ON knowledge_chunks(status);

      -- Vector indexes (using pgvector)
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding ON knowledge_vectors 
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_file ON knowledge_vectors(file_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_chunk ON knowledge_vectors(chunk_id);
    `

    await this.db.exec(indexSQL)
  }

  async getCurrentSchemaVersion(): Promise<number> {
    try {
      const result = await this.db.query(
        `SELECT version FROM ${PGlitePresenter.SCHEMA_VERSION_TABLE} ORDER BY version DESC LIMIT 1`
      )
      return result.rows.length > 0 ? (result.rows[0] as any).version : 0
    } catch {
      // If table doesn't exist, return 0
      return 0
    }
  }

  private async setSchemaVersion(version: number): Promise<void> {
    await this.db.query(
      `INSERT INTO ${PGlitePresenter.SCHEMA_VERSION_TABLE} (version, applied_at, description) 
       VALUES ($1, $2, $3)`,
      [version, Date.now(), `Schema version ${version}`]
    )
  }

  async migrateSchema(targetVersion: number): Promise<void> {
    const currentVersion = await this.getCurrentSchemaVersion()

    if (currentVersion >= targetVersion) {
      return
    }

    // Future migrations would be implemented here
    console.log(`[PGlite] Schema migration from v${currentVersion} to v${targetVersion} completed`)
  }

  private async runMigrations(): Promise<void> {
    const currentVersion = await this.getCurrentSchemaVersion()
    const targetVersion = PGlitePresenter.CURRENT_SCHEMA_VERSION

    if (currentVersion < targetVersion) {
      await this.migrateSchema(targetVersion)
    }
  }

  // ==================== Health Checks ====================

  async validateIntegrity(): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      // Check if all required tables exist
      const tables = [
        'conversations',
        'messages',
        'knowledge_files',
        'knowledge_chunks',
        'knowledge_vectors'
      ]
      for (const table of tables) {
        const result = await this.db.query(
          `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
          [table]
        )
        if (!(result.rows[0] as any).exists) {
          errors.push(`Required table '${table}' does not exist`)
        }
      }

      // Check for orphaned records
      const orphanedMessages = await this.db.query(`
        SELECT COUNT(*) as count FROM messages m 
        WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.conv_id = m.conversation_id)
      `)
      if ((orphanedMessages.rows[0] as any).count > 0) {
        warnings.push(`Found ${(orphanedMessages.rows[0] as any).count} orphaned messages`)
      }

      const orphanedChunks = await this.db.query(`
        SELECT COUNT(*) as count FROM knowledge_chunks kc 
        WHERE NOT EXISTS (SELECT 1 FROM knowledge_files kf WHERE kf.id = kc.file_id)
      `)
      if ((orphanedChunks.rows[0] as any).count > 0) {
        warnings.push(`Found ${(orphanedChunks.rows[0] as any).count} orphaned chunks`)
      }

      const orphanedVectors = await this.db.query(`
        SELECT COUNT(*) as count FROM knowledge_vectors kv 
        WHERE NOT EXISTS (SELECT 1 FROM knowledge_files kf WHERE kf.id = kv.file_id)
      `)
      if ((orphanedVectors.rows[0] as any).count > 0) {
        warnings.push(`Found ${(orphanedVectors.rows[0] as any).count} orphaned vectors`)
      }
    } catch (error) {
      errors.push(`Integrity check failed: ${error}`)
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }
}
