/**
 * PGlite Configuration Management
 */
import path from 'path'
import { app } from 'electron'
import { PGliteConfig, IndexOptions } from './index'

export interface PGliteConnectionConfig {
  // Database configuration
  dataDir: string
  dbName: string

  // Vector configuration
  vectorDimensions: number

  // Index configuration
  indexOptions: IndexOptions

  // Performance configuration
  maxConnections?: number
  connectionTimeout?: number
  queryTimeout?: number
}

export class PGliteConfigManager {
  private static readonly DEFAULT_DB_NAME = 'deepchat.db'
  private static readonly DEFAULT_VECTOR_DIMENSIONS = 1536
  private static readonly DEFAULT_DATA_DIR = 'pglite'

  /**
   * Get the default PGlite configuration
   */
  static getDefaultConfig(): PGliteConnectionConfig {
    const userDataPath = app.getPath('userData')
    const dataDir = path.join(userDataPath, this.DEFAULT_DATA_DIR)

    return {
      dataDir,
      dbName: this.DEFAULT_DB_NAME,
      vectorDimensions: this.DEFAULT_VECTOR_DIMENSIONS,
      indexOptions: {
        metric: 'cosine',
        M: 16,
        efConstruction: 200
      },
      maxConnections: 10,
      connectionTimeout: 30000,
      queryTimeout: 60000
    }
  }

  /**
   * Create PGlite configuration from connection config
   */
  static createPGliteConfig(connectionConfig: PGliteConnectionConfig): PGliteConfig {
    const dbPath = path.join(connectionConfig.dataDir, connectionConfig.dbName)

    return {
      dbPath,
      extensions: ['vector'],
      vectorDimensions: connectionConfig.vectorDimensions,
      indexOptions: connectionConfig.indexOptions
    }
  }

  /**
   * Validate configuration parameters
   */
  static validateConfig(config: PGliteConnectionConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    // Validate data directory
    if (!config.dataDir || typeof config.dataDir !== 'string') {
      errors.push('Data directory must be a valid string path')
    }

    // Validate database name
    if (!config.dbName || typeof config.dbName !== 'string') {
      errors.push('Database name must be a valid string')
    }

    // Validate vector dimensions
    if (
      !config.vectorDimensions ||
      config.vectorDimensions <= 0 ||
      config.vectorDimensions > 10000
    ) {
      errors.push('Vector dimensions must be a positive number between 1 and 10000')
    }

    // Validate index options
    if (config.indexOptions) {
      const validMetrics = ['cosine', 'l2', 'ip']
      if (config.indexOptions.metric && !validMetrics.includes(config.indexOptions.metric)) {
        errors.push(`Index metric must be one of: ${validMetrics.join(', ')}`)
      }

      if (config.indexOptions.M && (config.indexOptions.M < 4 || config.indexOptions.M > 64)) {
        errors.push('Index M parameter must be between 4 and 64')
      }

      if (
        config.indexOptions.efConstruction &&
        (config.indexOptions.efConstruction < 16 || config.indexOptions.efConstruction > 1000)
      ) {
        errors.push('Index efConstruction parameter must be between 16 and 1000')
      }
    }

    // Validate connection settings
    if (config.maxConnections && (config.maxConnections < 1 || config.maxConnections > 100)) {
      errors.push('Max connections must be between 1 and 100')
    }

    if (
      config.connectionTimeout &&
      (config.connectionTimeout < 1000 || config.connectionTimeout > 300000)
    ) {
      errors.push('Connection timeout must be between 1000ms and 300000ms')
    }

    if (config.queryTimeout && (config.queryTimeout < 1000 || config.queryTimeout > 600000)) {
      errors.push('Query timeout must be between 1000ms and 600000ms')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Get configuration for development environment
   */
  static getDevConfig(): PGliteConnectionConfig {
    const config = this.getDefaultConfig()
    return {
      ...config,
      dbName: 'deepchat-dev.db',
      dataDir: path.join(config.dataDir, 'dev')
    }
  }

  /**
   * Get configuration for testing environment
   */
  static getTestConfig(): PGliteConnectionConfig {
    const config = this.getDefaultConfig()
    return {
      ...config,
      dbName: 'deepchat-test.db',
      dataDir: path.join(config.dataDir, 'test')
    }
  }

  /**
   * Create configuration with custom vector dimensions
   */
  static createConfigWithDimensions(dimensions: number): PGliteConnectionConfig {
    const config = this.getDefaultConfig()
    return {
      ...config,
      vectorDimensions: dimensions
    }
  }

  /**
   * Create configuration with custom index options
   */
  static createConfigWithIndexOptions(indexOptions: IndexOptions): PGliteConnectionConfig {
    const config = this.getDefaultConfig()
    return {
      ...config,
      indexOptions: {
        ...config.indexOptions,
        ...indexOptions
      }
    }
  }
}

/**
 * Environment-specific configuration helpers
 */
export class PGliteEnvironment {
  /**
   * Determine if we're in development mode
   */
  static isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development'
  }

  /**
   * Determine if we're in test mode
   */
  static isTest(): boolean {
    return process.env.NODE_ENV === 'test'
  }

  /**
   * Get appropriate configuration for current environment
   */
  static getEnvironmentConfig(): PGliteConnectionConfig {
    if (this.isTest()) {
      return PGliteConfigManager.getTestConfig()
    } else if (this.isDevelopment()) {
      return PGliteConfigManager.getDevConfig()
    } else {
      return PGliteConfigManager.getDefaultConfig()
    }
  }
}
