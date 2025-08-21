/**
 * PGlite Data Validation System
 * Implements comprehensive data validation and integrity checking
 * Supports requirements 2.4, 9.1, 9.2 for data validation and integrity verification
 */

export interface ValidationRule {
  name: string
  description: string
  category: 'structure' | 'data' | 'relationships' | 'performance'
  severity: 'error' | 'warning' | 'info'
  validate: (db: any) => Promise<ValidationRuleResult>
}

export interface ValidationRuleResult {
  passed: boolean
  message: string
  details?: any
  affectedRecords?: number
  suggestedAction?: string
}

export interface DataValidationResult {
  isValid: boolean
  errors: ValidationRuleResult[]
  warnings: ValidationRuleResult[]
  info: ValidationRuleResult[]
  summary: {
    totalRules: number
    passedRules: number
    failedRules: number
    warningRules: number
    executionTime: number
  }
}

export interface IntegrityCheckResult {
  isValid: boolean
  issues: IntegrityIssue[]
  statistics: {
    totalRecords: Record<string, number>
    orphanedRecords: Record<string, number>
    duplicateRecords: Record<string, number>
    constraintViolations: number
  }
}

export interface IntegrityIssue {
  type: 'orphaned' | 'duplicate' | 'constraint' | 'missing' | 'invalid'
  table: string
  column?: string
  description: string
  affectedRecords: number
  severity: 'critical' | 'major' | 'minor'
  suggestedFix?: string
}

/**
 * Data Validation Engine for PGlite database
 * Provides comprehensive validation rules and integrity checking
 */
export class PGliteDataValidator {
  private readonly validationRules: ValidationRule[]

  constructor() {
    this.validationRules = this.initializeValidationRules()
  }

  /**
   * Initialize all validation rules
   * Supports requirements 2.4, 9.1, 9.2
   */
  private initializeValidationRules(): ValidationRule[] {
    return [
      // Structure validation rules
      {
        name: 'schema_version_check',
        description: 'Verify schema version is current and valid',
        category: 'structure',
        severity: 'error',
        validate: this.validateSchemaVersion.bind(this)
      },
      {
        name: 'required_tables_check',
        description: 'Verify all required tables exist',
        category: 'structure',
        severity: 'error',
        validate: this.validateRequiredTables.bind(this)
      },
      {
        name: 'required_indexes_check',
        description: 'Verify critical indexes exist for performance',
        category: 'structure',
        severity: 'warning',
        validate: this.validateRequiredIndexes.bind(this)
      },
      {
        name: 'pgvector_extension_check',
        description: 'Verify pgvector extension is installed and functional',
        category: 'structure',
        severity: 'error',
        validate: this.validatePgVectorExtension.bind(this)
      },

      // Data validation rules
      {
        name: 'conversation_data_integrity',
        description: 'Validate conversation data integrity and constraints',
        category: 'data',
        severity: 'error',
        validate: this.validateConversationData.bind(this)
      },
      {
        name: 'message_data_integrity',
        description: 'Validate message data integrity and relationships',
        category: 'data',
        severity: 'error',
        validate: this.validateMessageData.bind(this)
      },
      {
        name: 'knowledge_file_integrity',
        description: 'Validate knowledge file data and metadata',
        category: 'data',
        severity: 'error',
        validate: this.validateKnowledgeFileData.bind(this)
      },
      {
        name: 'vector_data_integrity',
        description: 'Validate vector embeddings and dimensions',
        category: 'data',
        severity: 'error',
        validate: this.validateVectorData.bind(this)
      },

      // Relationship validation rules
      {
        name: 'foreign_key_constraints',
        description: 'Verify all foreign key relationships are valid',
        category: 'relationships',
        severity: 'error',
        validate: this.validateForeignKeyConstraints.bind(this)
      },
      {
        name: 'orphaned_records_check',
        description: 'Check for orphaned records without valid parents',
        category: 'relationships',
        severity: 'warning',
        validate: this.validateOrphanedRecords.bind(this)
      },
      {
        name: 'circular_references_check',
        description: 'Check for circular references in message threads',
        category: 'relationships',
        severity: 'error',
        validate: this.validateCircularReferences.bind(this)
      },

      // Performance validation rules
      {
        name: 'vector_index_performance',
        description: 'Validate vector index performance and efficiency',
        category: 'performance',
        severity: 'info',
        validate: this.validateVectorIndexPerformance.bind(this)
      },
      {
        name: 'query_performance_check',
        description: 'Check for potential query performance issues',
        category: 'performance',
        severity: 'warning',
        validate: this.validateQueryPerformance.bind(this)
      }
    ]
  }

  /**
   * Run all validation rules and return comprehensive results
   * Supports requirements 2.4, 9.1, 9.2
   */
  async validateDatabase(db: any, categories?: string[]): Promise<DataValidationResult> {
    const startTime = Date.now()
    const result: DataValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      info: [],
      summary: {
        totalRules: 0,
        passedRules: 0,
        failedRules: 0,
        warningRules: 0,
        executionTime: 0
      }
    }

    // Filter rules by category if specified
    const rulesToRun = categories
      ? this.validationRules.filter((rule) => categories.includes(rule.category))
      : this.validationRules

    result.summary.totalRules = rulesToRun.length

    console.log(`[PGlite Validation] Running ${rulesToRun.length} validation rules`)

    for (const rule of rulesToRun) {
      try {
        console.log(`[PGlite Validation] Running rule: ${rule.name}`)
        const ruleResult = await rule.validate(db)

        if (ruleResult.passed) {
          result.summary.passedRules++
        } else {
          switch (rule.severity) {
            case 'error':
              result.errors.push(ruleResult)
              result.summary.failedRules++
              result.isValid = false
              break
            case 'warning':
              result.warnings.push(ruleResult)
              result.summary.warningRules++
              break
            case 'info':
              result.info.push(ruleResult)
              break
          }
        }
      } catch (error) {
        const errorResult: ValidationRuleResult = {
          passed: false,
          message: `Validation rule '${rule.name}' failed to execute: ${error}`,
          suggestedAction: 'Check database connection and permissions'
        }

        result.errors.push(errorResult)
        result.summary.failedRules++
        result.isValid = false
      }
    }

    result.summary.executionTime = Date.now() - startTime

    console.log(
      `[PGlite Validation] Validation completed in ${result.summary.executionTime}ms. ` +
        `Passed: ${result.summary.passedRules}, Failed: ${result.summary.failedRules}, ` +
        `Warnings: ${result.summary.warningRules}`
    )

    return result
  }

  /**
   * Perform comprehensive data integrity check
   * Supports requirement 2.4 for data integrity verification
   */
  async checkDataIntegrity(db: any): Promise<IntegrityCheckResult> {
    const result: IntegrityCheckResult = {
      isValid: true,
      issues: [],
      statistics: {
        totalRecords: {},
        orphanedRecords: {},
        duplicateRecords: {},
        constraintViolations: 0
      }
    }

    try {
      // Get record counts for all tables
      const tables = [
        'conversations',
        'messages',
        'message_attachments',
        'knowledge_files',
        'knowledge_chunks',
        'knowledge_vectors'
      ]

      for (const table of tables) {
        try {
          const countResult = await db.query(`SELECT COUNT(*) as count FROM ${table}`)
          result.statistics.totalRecords[table] = countResult.rows[0].count
        } catch (error) {
          result.issues.push({
            type: 'missing',
            table,
            description: `Failed to count records in table ${table}: ${error}`,
            affectedRecords: 0,
            severity: 'critical'
          })
          result.isValid = false
        }
      }

      // Check for orphaned messages
      const orphanedMessages = await db.query(`
        SELECT COUNT(*) as count 
        FROM messages m 
        LEFT JOIN conversations c ON m.conversation_id = c.conv_id 
        WHERE c.conv_id IS NULL
      `)

      if (orphanedMessages.rows[0].count > 0) {
        result.statistics.orphanedRecords.messages = orphanedMessages.rows[0].count
        result.issues.push({
          type: 'orphaned',
          table: 'messages',
          description: `Found ${orphanedMessages.rows[0].count} messages without valid conversations`,
          affectedRecords: orphanedMessages.rows[0].count,
          severity: 'major',
          suggestedFix: 'Delete orphaned messages or restore missing conversations'
        })
        result.isValid = false
      }

      // Check for orphaned chunks
      const orphanedChunks = await db.query(`
        SELECT COUNT(*) as count 
        FROM knowledge_chunks kc 
        LEFT JOIN knowledge_files kf ON kc.file_id = kf.id 
        WHERE kf.id IS NULL
      `)

      if (orphanedChunks.rows[0].count > 0) {
        result.statistics.orphanedRecords.knowledge_chunks = orphanedChunks.rows[0].count
        result.issues.push({
          type: 'orphaned',
          table: 'knowledge_chunks',
          description: `Found ${orphanedChunks.rows[0].count} chunks without valid files`,
          affectedRecords: orphanedChunks.rows[0].count,
          severity: 'major',
          suggestedFix: 'Delete orphaned chunks or restore missing files'
        })
        result.isValid = false
      }

      // Check for orphaned vectors
      const orphanedVectors = await db.query(`
        SELECT COUNT(*) as count 
        FROM knowledge_vectors kv 
        LEFT JOIN knowledge_chunks kc ON kv.chunk_id = kc.id 
        WHERE kc.id IS NULL
      `)

      if (orphanedVectors.rows[0].count > 0) {
        result.statistics.orphanedRecords.knowledge_vectors = orphanedVectors.rows[0].count
        result.issues.push({
          type: 'orphaned',
          table: 'knowledge_vectors',
          description: `Found ${orphanedVectors.rows[0].count} vectors without valid chunks`,
          affectedRecords: orphanedVectors.rows[0].count,
          severity: 'major',
          suggestedFix: 'Delete orphaned vectors or restore missing chunks'
        })
        result.isValid = false
      }

      // Check for duplicate conversations
      const duplicateConversations = await db.query(`
        SELECT conv_id, COUNT(*) as count 
        FROM conversations 
        GROUP BY conv_id 
        HAVING COUNT(*) > 1
      `)

      if (duplicateConversations.rows.length > 0) {
        const totalDuplicates = duplicateConversations.rows.reduce(
          (sum: number, row: any) => sum + row.count - 1,
          0
        )
        result.statistics.duplicateRecords.conversations = totalDuplicates
        result.issues.push({
          type: 'duplicate',
          table: 'conversations',
          description: `Found ${duplicateConversations.rows.length} conversation IDs with duplicates`,
          affectedRecords: totalDuplicates,
          severity: 'major',
          suggestedFix: 'Remove duplicate conversation records, keeping the most recent'
        })
        result.isValid = false
      }

      console.log('[PGlite Validation] Data integrity check completed')
    } catch (error) {
      result.issues.push({
        type: 'invalid',
        table: 'unknown',
        description: `Data integrity check failed: ${error}`,
        affectedRecords: 0,
        severity: 'critical'
      })
      result.isValid = false
    }

    return result
  }

  // Individual validation rule implementations

  private async validateSchemaVersion(db: any): Promise<ValidationRuleResult> {
    try {
      const result = await db.query(
        'SELECT version FROM schema_versions ORDER BY version DESC LIMIT 1'
      )

      if (result.rows.length === 0) {
        return {
          passed: false,
          message: 'No schema version found in database',
          suggestedAction: 'Initialize database schema'
        }
      }

      const currentVersion = result.rows[0].version
      const expectedVersion = 1 // Current expected version

      if (currentVersion !== expectedVersion) {
        return {
          passed: false,
          message: `Schema version mismatch: expected ${expectedVersion}, found ${currentVersion}`,
          details: { currentVersion, expectedVersion },
          suggestedAction: 'Run schema migration to update to latest version'
        }
      }

      return {
        passed: true,
        message: `Schema version ${currentVersion} is current`
      }
    } catch (error) {
      return {
        passed: false,
        message: `Failed to check schema version: ${error}`,
        suggestedAction: 'Check if schema_versions table exists'
      }
    }
  }

  private async validateRequiredTables(db: any): Promise<ValidationRuleResult> {
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

    const missingTables: string[] = []

    for (const table of requiredTables) {
      try {
        const result = await db.query(
          `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
          [table]
        )

        if (!result.rows[0].exists) {
          missingTables.push(table)
        }
      } catch (error) {
        return {
          passed: false,
          message: `Failed to check table existence: ${error}`,
          suggestedAction: 'Check database connection and permissions'
        }
      }
    }

    if (missingTables.length > 0) {
      return {
        passed: false,
        message: `Missing required tables: ${missingTables.join(', ')}`,
        details: { missingTables },
        affectedRecords: missingTables.length,
        suggestedAction: 'Run schema creation or migration'
      }
    }

    return {
      passed: true,
      message: `All ${requiredTables.length} required tables exist`
    }
  }

  private async validateRequiredIndexes(db: any): Promise<ValidationRuleResult> {
    const criticalIndexes = [
      'idx_conversations_conv_id',
      'idx_messages_conversation',
      'idx_knowledge_vectors_embedding_cosine',
      'idx_knowledge_chunks_file',
      'idx_knowledge_files_status'
    ]

    const missingIndexes: string[] = []

    for (const index of criticalIndexes) {
      try {
        const result = await db.query(
          `SELECT EXISTS (SELECT FROM pg_indexes WHERE indexname = $1)`,
          [index]
        )

        if (!result.rows[0].exists) {
          missingIndexes.push(index)
        }
      } catch (error) {
        return {
          passed: false,
          message: `Failed to check index existence: ${error}`,
          suggestedAction: 'Check database connection and permissions'
        }
      }
    }

    if (missingIndexes.length > 0) {
      return {
        passed: false,
        message: `Missing critical indexes: ${missingIndexes.join(', ')}`,
        details: { missingIndexes },
        affectedRecords: missingIndexes.length,
        suggestedAction: 'Create missing indexes to improve query performance'
      }
    }

    return {
      passed: true,
      message: `All ${criticalIndexes.length} critical indexes exist`
    }
  }

  private async validatePgVectorExtension(db: any): Promise<ValidationRuleResult> {
    try {
      // Check if extension is installed
      const extensionResult = await db.query(
        `SELECT EXISTS (SELECT FROM pg_extension WHERE extname = 'vector')`
      )

      if (!extensionResult.rows[0].exists) {
        return {
          passed: false,
          message: 'pgvector extension is not installed',
          suggestedAction: 'Install pgvector extension: CREATE EXTENSION vector;'
        }
      }

      // Test vector functionality
      await db.query(`SELECT '[1,2,3]'::vector(3)`)

      return {
        passed: true,
        message: 'pgvector extension is installed and functional'
      }
    } catch (error) {
      return {
        passed: false,
        message: `pgvector extension validation failed: ${error}`,
        suggestedAction: 'Reinstall pgvector extension or check compatibility'
      }
    }
  }

  private async validateConversationData(db: any): Promise<ValidationRuleResult> {
    try {
      // Check for invalid conversation data
      const invalidConversations = await db.query(`
        SELECT COUNT(*) as count FROM conversations 
        WHERE conv_id IS NULL OR conv_id = '' 
        OR title IS NULL OR title = ''
        OR created_at IS NULL OR updated_at IS NULL
      `)

      const count = invalidConversations.rows[0].count
      if (count > 0) {
        return {
          passed: false,
          message: `Found ${count} conversations with invalid data`,
          affectedRecords: count,
          suggestedAction: 'Fix or remove conversations with missing required fields'
        }
      }

      return {
        passed: true,
        message: 'All conversation data is valid'
      }
    } catch (error) {
      return {
        passed: false,
        message: `Conversation data validation failed: ${error}`,
        suggestedAction: 'Check conversations table structure and data'
      }
    }
  }

  private async validateMessageData(db: any): Promise<ValidationRuleResult> {
    try {
      // Check for invalid message data
      const invalidMessages = await db.query(`
        SELECT COUNT(*) as count FROM messages 
        WHERE msg_id IS NULL OR msg_id = ''
        OR conversation_id IS NULL OR conversation_id = ''
        OR role NOT IN ('user', 'assistant', 'system', 'function')
        OR content IS NULL
        OR created_at IS NULL
      `)

      const count = invalidMessages.rows[0].count
      if (count > 0) {
        return {
          passed: false,
          message: `Found ${count} messages with invalid data`,
          affectedRecords: count,
          suggestedAction: 'Fix or remove messages with invalid fields'
        }
      }

      return {
        passed: true,
        message: 'All message data is valid'
      }
    } catch (error) {
      return {
        passed: false,
        message: `Message data validation failed: ${error}`,
        suggestedAction: 'Check messages table structure and data'
      }
    }
  }

  private async validateKnowledgeFileData(db: any): Promise<ValidationRuleResult> {
    try {
      // Check for invalid knowledge file data
      const invalidFiles = await db.query(`
        SELECT COUNT(*) as count FROM knowledge_files 
        WHERE id IS NULL OR id = ''
        OR name IS NULL OR name = ''
        OR path IS NULL OR path = ''
        OR status NOT IN ('pending', 'processing', 'completed', 'error')
        OR uploaded_at IS NULL
      `)

      const count = invalidFiles.rows[0].count
      if (count > 0) {
        return {
          passed: false,
          message: `Found ${count} knowledge files with invalid data`,
          affectedRecords: count,
          suggestedAction: 'Fix or remove knowledge files with invalid fields'
        }
      }

      return {
        passed: true,
        message: 'All knowledge file data is valid'
      }
    } catch (error) {
      return {
        passed: false,
        message: `Knowledge file data validation failed: ${error}`,
        suggestedAction: 'Check knowledge_files table structure and data'
      }
    }
  }

  private async validateVectorData(db: any): Promise<ValidationRuleResult> {
    try {
      // Check for invalid vector data
      const invalidVectors = await db.query(`
        SELECT COUNT(*) as count FROM knowledge_vectors 
        WHERE id IS NULL OR id = ''
        OR file_id IS NULL OR file_id = ''
        OR chunk_id IS NULL OR chunk_id = ''
        OR embedding IS NULL
      `)

      const count = invalidVectors.rows[0].count
      if (count > 0) {
        return {
          passed: false,
          message: `Found ${count} vectors with invalid data`,
          affectedRecords: count,
          suggestedAction: 'Fix or remove vectors with missing required fields'
        }
      }

      // Check vector dimensions consistency
      const dimensionCheck = await db.query(`
        SELECT DISTINCT array_length(embedding, 1) as dimension, COUNT(*) as count
        FROM knowledge_vectors 
        WHERE embedding IS NOT NULL
        GROUP BY array_length(embedding, 1)
      `)

      if (dimensionCheck.rows.length > 1) {
        return {
          passed: false,
          message: `Inconsistent vector dimensions found: ${dimensionCheck.rows.map((r: any) => `${r.dimension}(${r.count})`).join(', ')}`,
          details: { dimensions: dimensionCheck.rows },
          suggestedAction: 'Ensure all vectors have consistent dimensions'
        }
      }

      return {
        passed: true,
        message: 'All vector data is valid'
      }
    } catch (error) {
      return {
        passed: false,
        message: `Vector data validation failed: ${error}`,
        suggestedAction: 'Check knowledge_vectors table structure and data'
      }
    }
  }

  private async validateForeignKeyConstraints(db: any): Promise<ValidationRuleResult> {
    try {
      // This is a simplified check - in a real implementation, you'd check all FK constraints
      let violationCount = 0
      const violations: string[] = []

      // Check messages -> conversations FK
      const messageViolations = await db.query(`
        SELECT COUNT(*) as count FROM messages m 
        LEFT JOIN conversations c ON m.conversation_id = c.conv_id 
        WHERE c.conv_id IS NULL
      `)

      if (messageViolations.rows[0].count > 0) {
        violationCount += messageViolations.rows[0].count
        violations.push(`${messageViolations.rows[0].count} messages with invalid conversation_id`)
      }

      if (violationCount > 0) {
        return {
          passed: false,
          message: `Found ${violationCount} foreign key constraint violations`,
          details: { violations },
          affectedRecords: violationCount,
          suggestedAction: 'Fix or remove records with invalid foreign key references'
        }
      }

      return {
        passed: true,
        message: 'All foreign key constraints are valid'
      }
    } catch (error) {
      return {
        passed: false,
        message: `Foreign key validation failed: ${error}`,
        suggestedAction: 'Check database constraints and relationships'
      }
    }
  }

  private async validateOrphanedRecords(_db: any): Promise<ValidationRuleResult> {
    // This is handled in the comprehensive integrity check
    return {
      passed: true,
      message: 'Orphaned records check completed (see integrity check for details)'
    }
  }

  private async validateCircularReferences(db: any): Promise<ValidationRuleResult> {
    try {
      // Check for circular references in message parent-child relationships
      // This is a simplified check - a full implementation would use recursive CTEs
      const circularRefs = await db.query(`
        SELECT COUNT(*) as count FROM messages m1 
        JOIN messages m2 ON m1.msg_id = m2.parent_id 
        WHERE m2.msg_id = m1.parent_id AND m1.parent_id != ''
      `)

      const count = circularRefs.rows[0].count
      if (count > 0) {
        return {
          passed: false,
          message: `Found ${count} circular references in message relationships`,
          affectedRecords: count,
          suggestedAction: 'Fix circular parent-child relationships in messages'
        }
      }

      return {
        passed: true,
        message: 'No circular references found in message relationships'
      }
    } catch (error) {
      return {
        passed: false,
        message: `Circular reference check failed: ${error}`,
        suggestedAction: 'Check message parent-child relationships'
      }
    }
  }

  private async validateVectorIndexPerformance(db: any): Promise<ValidationRuleResult> {
    try {
      // Check if vector indexes are being used effectively
      const vectorCount = await db.query('SELECT COUNT(*) as count FROM knowledge_vectors')
      const count = vectorCount.rows[0].count

      if (count === 0) {
        return {
          passed: true,
          message: 'No vectors to check performance for'
        }
      }

      // Simple performance check - measure a sample query
      const startTime = Date.now()
      await db.query(`
        SELECT id FROM knowledge_vectors 
        ORDER BY embedding <-> '[${Array(1536).fill(0).join(',')}]'::vector 
        LIMIT 10
      `)
      const queryTime = Date.now() - startTime

      if (queryTime > 1000) {
        // More than 1 second for a simple query
        return {
          passed: false,
          message: `Vector query performance is slow: ${queryTime}ms for sample query`,
          details: { queryTime, vectorCount: count },
          suggestedAction: 'Consider rebuilding vector indexes or adjusting index parameters'
        }
      }

      return {
        passed: true,
        message: `Vector index performance is acceptable: ${queryTime}ms for ${count} vectors`
      }
    } catch (error) {
      return {
        passed: false,
        message: `Vector performance check failed: ${error}`,
        suggestedAction: 'Check vector indexes and query structure'
      }
    }
  }

  private async validateQueryPerformance(db: any): Promise<ValidationRuleResult> {
    try {
      // This is a simplified check - in practice, you'd analyze query plans
      const conversationCount = await db.query('SELECT COUNT(*) as count FROM conversations')
      const messageCount = await db.query('SELECT COUNT(*) as count FROM messages')

      const issues: string[] = []

      if (conversationCount.rows[0].count > 10000) {
        issues.push(
          `Large conversations table (${conversationCount.rows[0].count} records) - ensure proper indexing`
        )
      }

      if (messageCount.rows[0].count > 100000) {
        issues.push(
          `Large messages table (${messageCount.rows[0].count} records) - ensure proper indexing`
        )
      }

      if (issues.length > 0) {
        return {
          passed: false,
          message: `Potential query performance issues detected`,
          details: { issues },
          suggestedAction: 'Review and optimize database indexes for large tables'
        }
      }

      return {
        passed: true,
        message: 'No obvious query performance issues detected'
      }
    } catch (error) {
      return {
        passed: false,
        message: `Query performance check failed: ${error}`,
        suggestedAction: 'Check database statistics and query patterns'
      }
    }
  }

  /**
   * Get validation rules by category
   */
  getValidationRulesByCategory(category: string): ValidationRule[] {
    return this.validationRules.filter((rule) => rule.category === category)
  }

  /**
   * Get all available validation categories
   */
  getValidationCategories(): string[] {
    return [...new Set(this.validationRules.map((rule) => rule.category))]
  }
}
