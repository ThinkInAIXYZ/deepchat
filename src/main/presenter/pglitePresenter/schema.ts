/**
 * PGlite Schema Management
 * Handles unified database schema creation, migration, and versioning
 * Supports requirements 4.1, 4.2, 5.1, 5.2, 5.3, 5.4
 */

export interface SchemaMigration {
  version: number
  description: string
  upScript: string
  downScript?: string
  dependencies?: number[]
  appliedAt?: number
  checksum?: string
}

export interface MigrationResult {
  success: boolean
  version: number
  description: string
  executionTime: number
  errors: string[]
  warnings: string[]
  rollbackAvailable: boolean
}

export interface SchemaValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  missingTables: string[]
  missingIndexes: string[]
  schemaVersion: number
}

/**
 * Schema Manager for PGlite database
 * Handles schema creation, versioning, and migration operations
 */
export class PGliteSchemaManager {
  private static readonly CURRENT_SCHEMA_VERSION = 1
  private static readonly SCHEMA_VERSION_TABLE = 'schema_versions'
  private static readonly MIGRATION_METADATA_TABLE = 'migration_metadata'

  // Vector dimensions configuration
  private readonly vectorDimensions: number

  constructor(vectorDimensions: number = 1536) {
    this.vectorDimensions = vectorDimensions
  }

  /**
   * Get the unified schema creation SQL
   * Combines conversations, messages, knowledge files, chunks, and vectors
   * Supports requirements 4.1, 4.2, 5.1, 5.2
   */
  getUnifiedSchemaSQL(): string {
    return `
      -- Enable pgvector extension for vector operations
      CREATE EXTENSION IF NOT EXISTS vector;

      -- Schema version tracking table
      CREATE TABLE IF NOT EXISTS ${PGliteSchemaManager.SCHEMA_VERSION_TABLE} (
        version INTEGER PRIMARY KEY,
        applied_at BIGINT NOT NULL,
        description TEXT,
        checksum TEXT
      );

      -- Migration metadata table for tracking migration history
      CREATE TABLE IF NOT EXISTS ${PGliteSchemaManager.MIGRATION_METADATA_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(epoch FROM NOW()) * 1000
      );

      -- Conversations table (migrated from SQLite)
      -- Stores conversation metadata and settings
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        conv_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        is_pinned INTEGER DEFAULT 0 CHECK(is_pinned IN (0, 1)),
        is_new INTEGER DEFAULT 1 CHECK(is_new IN (0, 1)),
        settings JSONB DEFAULT '{}'::jsonb
      );

      -- Messages table (migrated from SQLite)
      -- Stores individual messages within conversations
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        msg_id TEXT UNIQUE NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(conv_id) ON DELETE CASCADE,
        parent_id TEXT DEFAULT '',
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'function')),
        content TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        order_seq INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER DEFAULT 0 CHECK(token_count >= 0),
        status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'pending', 'error')),
        metadata JSONB DEFAULT '{}'::jsonb,
        is_context_edge INTEGER DEFAULT 0 CHECK(is_context_edge IN (0, 1)),
        is_variant INTEGER DEFAULT 0 CHECK(is_variant IN (0, 1))
      );

      -- Message attachments table (migrated from SQLite)
      -- Stores file attachments and other media associated with messages
      CREATE TABLE IF NOT EXISTS message_attachments (
        id SERIAL PRIMARY KEY,
        message_id TEXT NOT NULL,
        attachment_type TEXT NOT NULL,
        attachment_data TEXT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(epoch FROM NOW()) * 1000,
        metadata JSONB DEFAULT '{}'::jsonb
      );

      -- Knowledge files table (migrated from DuckDB)
      -- Stores metadata about uploaded knowledge base files
      CREATE TABLE IF NOT EXISTS knowledge_files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        mime_type TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'error')),
        uploaded_at BIGINT NOT NULL,
        file_size BIGINT DEFAULT 0 CHECK(file_size >= 0),
        metadata JSONB DEFAULT '{}'::jsonb
      );

      -- Knowledge chunks table (migrated from DuckDB)
      -- Stores text chunks extracted from knowledge files
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'error')),
        error TEXT DEFAULT '',
        chunk_size INTEGER DEFAULT 0 CHECK(chunk_size >= 0),
        metadata JSONB DEFAULT '{}'::jsonb
      );

      -- Vector embeddings table (migrated from DuckDB)
      -- Stores vector embeddings for semantic search
      CREATE TABLE IF NOT EXISTS knowledge_vectors (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
        chunk_id TEXT NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
        embedding vector(${this.vectorDimensions}),
        created_at BIGINT DEFAULT EXTRACT(epoch FROM NOW()) * 1000,
        model_name TEXT DEFAULT 'unknown',
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `
  }

  /**
   * Get the database indexes creation SQL
   * Creates optimized indexes for performance
   * Supports requirements 4.1, 4.2
   */
  getIndexesSQL(): string {
    return `
      -- Conversation indexes for efficient querying
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(is_pinned) WHERE is_pinned = 1;
      CREATE INDEX IF NOT EXISTS idx_conversations_conv_id ON conversations(conv_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC);

      -- Message indexes for conversation and timeline queries
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, order_seq);
      CREATE INDEX IF NOT EXISTS idx_messages_timeline ON messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_context_edge ON messages(is_context_edge) WHERE is_context_edge = 1;
      CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id) WHERE parent_id != '';
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status) WHERE status != 'sent';

      -- Message attachment indexes
      CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_type ON message_attachments(attachment_type);

      -- Knowledge file indexes for file management
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_status ON knowledge_files(status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_path ON knowledge_files(path);
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_uploaded ON knowledge_files(uploaded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_mime_type ON knowledge_files(mime_type);

      -- Knowledge chunk indexes for file relationships
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_file ON knowledge_chunks(file_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_status ON knowledge_chunks(status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_file_index ON knowledge_chunks(file_id, chunk_index);

      -- Vector indexes using pgvector for similarity search
      -- Cosine distance index (most common for embeddings)
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding_cosine ON knowledge_vectors 
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

      -- L2 distance index for Euclidean distance
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding_l2 ON knowledge_vectors 
      USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);

      -- Inner product index for dot product similarity
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding_ip ON knowledge_vectors 
      USING ivfflat (embedding vector_ip_ops) WITH (lists = 100);

      -- Vector relationship indexes
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_file ON knowledge_vectors(file_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_chunk ON knowledge_vectors(chunk_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_created ON knowledge_vectors(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_model ON knowledge_vectors(model_name);
    `
  }

  /**
   * Get the complete initial schema with indexes
   * Supports requirements 4.1, 4.2, 5.1, 5.2
   */
  getCompleteInitialSchema(): string {
    return this.getUnifiedSchemaSQL() + '\n\n' + this.getIndexesSQL()
  }

  /**
   * Get all available migrations
   * Supports requirement 5.3 for schema versioning
   */
  static getMigrations(): SchemaMigration[] {
    return [
      {
        version: 1,
        description:
          'Initial unified schema with conversations, messages, knowledge files, chunks, and vectors',
        upScript: '', // Will be populated dynamically
        downScript: `
          -- Drop all tables in reverse dependency order
          DROP TABLE IF EXISTS knowledge_vectors CASCADE;
          DROP TABLE IF EXISTS knowledge_chunks CASCADE;
          DROP TABLE IF EXISTS knowledge_files CASCADE;
          DROP TABLE IF EXISTS message_attachments CASCADE;
          DROP TABLE IF EXISTS messages CASCADE;
          DROP TABLE IF EXISTS conversations CASCADE;
          DROP TABLE IF EXISTS migration_metadata CASCADE;
          DROP TABLE IF EXISTS schema_versions CASCADE;
          
          -- Drop extension
          DROP EXTENSION IF EXISTS vector CASCADE;
        `,
        dependencies: [],
        checksum: 'initial_schema_v1'
      }
    ]
  }

  /**
   * Validate the current schema against expected structure
   * Supports requirements 2.4, 9.1, 9.2 for data validation
   */
  async validateSchema(db: any): Promise<SchemaValidationResult> {
    const result: SchemaValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      missingTables: [],
      missingIndexes: [],
      schemaVersion: 0
    }

    try {
      // Check schema version
      try {
        const versionResult = await db.query(
          `SELECT version FROM ${PGliteSchemaManager.SCHEMA_VERSION_TABLE} ORDER BY version DESC LIMIT 1`
        )
        result.schemaVersion = versionResult.rows.length > 0 ? versionResult.rows[0].version : 0
      } catch {
        result.errors.push('Schema version table not found or inaccessible')
        result.isValid = false
      }

      // Check required tables
      const requiredTables = [
        'conversations',
        'messages',
        'message_attachments',
        'knowledge_files',
        'knowledge_chunks',
        'knowledge_vectors',
        'schema_versions',
        'migration_metadata'
      ]

      for (const table of requiredTables) {
        try {
          const tableResult = await db.query(
            `SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = $1
            )`,
            [table]
          )

          if (!tableResult.rows[0].exists) {
            result.missingTables.push(table)
            result.errors.push(`Required table '${table}' is missing`)
            result.isValid = false
          }
        } catch (error) {
          result.errors.push(`Failed to check table '${table}': ${error}`)
          result.isValid = false
        }
      }

      // Check pgvector extension
      try {
        const extensionResult = await db.query(
          `SELECT EXISTS (
            SELECT FROM pg_extension WHERE extname = 'vector'
          )`
        )

        if (!extensionResult.rows[0].exists) {
          result.errors.push('pgvector extension is not installed')
          result.isValid = false
        }
      } catch (error) {
        result.errors.push(`Failed to check pgvector extension: ${error}`)
        result.isValid = false
      }

      // Check critical indexes
      const criticalIndexes = [
        'idx_conversations_conv_id',
        'idx_messages_conversation',
        'idx_knowledge_vectors_embedding_cosine',
        'idx_knowledge_chunks_file',
        'idx_knowledge_files_status'
      ]

      for (const index of criticalIndexes) {
        try {
          const indexResult = await db.query(
            `SELECT EXISTS (
              SELECT FROM pg_indexes 
              WHERE schemaname = 'public' AND indexname = $1
            )`,
            [index]
          )

          if (!indexResult.rows[0].exists) {
            result.missingIndexes.push(index)
            result.warnings.push(`Critical index '${index}' is missing`)
          }
        } catch (error) {
          result.warnings.push(`Failed to check index '${index}': ${error}`)
        }
      }

      // Check foreign key constraints
      try {
        const constraintResult = await db.query(`
          SELECT COUNT(*) as constraint_count
          FROM information_schema.table_constraints 
          WHERE constraint_type = 'FOREIGN KEY' 
          AND table_schema = 'public'
        `)

        const expectedConstraints = 4 // messages->conversations, chunks->files, vectors->files, vectors->chunks
        const actualConstraints = constraintResult.rows[0].constraint_count

        if (actualConstraints < expectedConstraints) {
          result.warnings.push(
            `Expected ${expectedConstraints} foreign key constraints, found ${actualConstraints}`
          )
        }
      } catch (error) {
        result.warnings.push(`Failed to check foreign key constraints: ${error}`)
      }

      // Check vector column dimensions
      try {
        const vectorResult = await db.query(`
          SELECT column_name, data_type, character_maximum_length
          FROM information_schema.columns 
          WHERE table_name = 'knowledge_vectors' 
          AND column_name = 'embedding'
        `)

        if (vectorResult.rows.length === 0) {
          result.errors.push('Vector embedding column not found in knowledge_vectors table')
          result.isValid = false
        }
      } catch (error) {
        result.errors.push(`Failed to check vector column: ${error}`)
        result.isValid = false
      }
    } catch (error) {
      result.errors.push(`Schema validation failed: ${error}`)
      result.isValid = false
    }

    return result
  }

  /**
   * Get schema creation method with proper error handling
   * Supports requirements 4.1, 4.2, 5.1, 5.2
   */
  async createSchema(db: any): Promise<void> {
    try {
      console.log('[PGlite Schema] Creating unified database schema')

      // Execute schema creation
      await db.exec(this.getCompleteInitialSchema())

      // Set initial schema version
      await db.query(
        `INSERT INTO ${PGliteSchemaManager.SCHEMA_VERSION_TABLE} (version, applied_at, description, checksum) 
         VALUES ($1, $2, $3, $4)`,
        [
          PGliteSchemaManager.CURRENT_SCHEMA_VERSION,
          Date.now(),
          'Initial unified schema creation',
          'initial_schema_v1'
        ]
      )

      console.log('[PGlite Schema] Unified schema created successfully')
    } catch (error) {
      console.error('[PGlite Schema] Failed to create schema:', error)
      throw new Error(`Schema creation failed: ${error}`)
    }
  }

  /**
   * Get current schema version from database
   * Supports requirement 5.3 for schema versioning
   */
  async getCurrentVersion(db: any): Promise<number> {
    try {
      const result = await db.query(
        `SELECT version FROM ${PGliteSchemaManager.SCHEMA_VERSION_TABLE} ORDER BY version DESC LIMIT 1`
      )
      return result.rows.length > 0 ? result.rows[0].version : 0
    } catch {
      return 0
    }
  }

  /**
   * Check if schema needs migration
   * Supports requirement 5.4 for backward compatibility
   */
  async needsMigration(db: any): Promise<boolean> {
    const currentVersion = await this.getCurrentVersion(db)
    return currentVersion < PGliteSchemaManager.CURRENT_SCHEMA_VERSION
  }

  /**
   * Get pending migrations
   * Supports requirement 5.3 for schema versioning
   */
  async getPendingMigrations(db: any): Promise<SchemaMigration[]> {
    const currentVersion = await this.getCurrentVersion(db)
    return PGliteSchemaManager.getMigrations().filter(
      (migration) => migration.version > currentVersion
    )
  }
}
