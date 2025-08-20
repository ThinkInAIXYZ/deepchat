/**
 * PGlite Connection Utilities
 */
import fs from 'fs'
import path from 'path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { PGliteConfig } from './index'
import { PGliteConnectionConfig, PGliteConfigManager } from './config'

export interface ConnectionStatus {
  isConnected: boolean
  dbPath: string
  lastConnected?: Date
  lastError?: string
}

export class PGliteConnectionManager {
  private static instance: PGliteConnectionManager
  private connections: Map<string, PGlite> = new Map()
  private connectionStatus: Map<string, ConnectionStatus> = new Map()

  private constructor() {}

  static getInstance(): PGliteConnectionManager {
    if (!PGliteConnectionManager.instance) {
      PGliteConnectionManager.instance = new PGliteConnectionManager()
    }
    return PGliteConnectionManager.instance
  }

  /**
   * Create a new PGlite database connection
   */
  async createConnection(config: PGliteConfig): Promise<PGlite> {
    const connectionKey = this.getConnectionKey(config.dbPath)

    // Check if connection already exists
    if (this.connections.has(connectionKey)) {
      const existingConnection = this.connections.get(connectionKey)!
      if (await this.isConnectionHealthy(existingConnection)) {
        return existingConnection
      } else {
        // Close unhealthy connection
        await this.closeConnection(connectionKey)
      }
    }

    try {
      // Ensure database directory exists
      await this.ensureDirectoryExists(config.dbPath)

      // Create PGlite instance with vector extension
      const db = new PGlite(config.dbPath, {
        extensions: {
          vector
        }
      })

      // Test the connection
      await this.testConnection(db)

      // Store connection
      this.connections.set(connectionKey, db)
      this.connectionStatus.set(connectionKey, {
        isConnected: true,
        dbPath: config.dbPath,
        lastConnected: new Date()
      })

      console.log(`[PGlite] Connection created successfully: ${config.dbPath}`)
      return db
    } catch (error) {
      const errorMessage = `Failed to create connection to ${config.dbPath}: ${error}`
      console.error(`[PGlite] ${errorMessage}`)

      this.connectionStatus.set(connectionKey, {
        isConnected: false,
        dbPath: config.dbPath,
        lastError: errorMessage
      })

      throw new Error(errorMessage)
    }
  }

  /**
   * Get an existing connection or create a new one
   */
  async getConnection(config: PGliteConfig): Promise<PGlite> {
    const connectionKey = this.getConnectionKey(config.dbPath)

    if (this.connections.has(connectionKey)) {
      const connection = this.connections.get(connectionKey)!
      if (await this.isConnectionHealthy(connection)) {
        return connection
      }
    }

    return this.createConnection(config)
  }

  /**
   * Close a specific connection
   */
  async closeConnection(dbPath: string): Promise<void> {
    const connectionKey = this.getConnectionKey(dbPath)
    const connection = this.connections.get(connectionKey)

    if (connection) {
      try {
        await connection.close()
        console.log(`[PGlite] Connection closed: ${dbPath}`)
      } catch (error) {
        console.error(`[PGlite] Error closing connection ${dbPath}:`, error)
      }

      this.connections.delete(connectionKey)
      this.connectionStatus.set(connectionKey, {
        isConnected: false,
        dbPath
      })
    }
  }

  /**
   * Close all connections
   */
  async closeAllConnections(): Promise<void> {
    const closePromises = Array.from(this.connections.keys()).map((key) => {
      const dbPath = this.connectionStatus.get(key)?.dbPath || key
      return this.closeConnection(dbPath)
    })

    await Promise.all(closePromises)
    console.log('[PGlite] All connections closed')
  }

  /**
   * Get connection status
   */
  getConnectionStatus(dbPath: string): ConnectionStatus | null {
    const connectionKey = this.getConnectionKey(dbPath)
    return this.connectionStatus.get(connectionKey) || null
  }

  /**
   * Get all connection statuses
   */
  getAllConnectionStatuses(): ConnectionStatus[] {
    return Array.from(this.connectionStatus.values())
  }

  /**
   * Check if database file exists
   */
  async databaseExists(dbPath: string): Promise<boolean> {
    try {
      return fs.existsSync(dbPath)
    } catch {
      return false
    }
  }

  /**
   * Create database directory if it doesn't exist
   */
  private async ensureDirectoryExists(dbPath: string): Promise<void> {
    const dbDir = path.dirname(dbPath)

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
      console.log(`[PGlite] Created database directory: ${dbDir}`)
    }
  }

  /**
   * Test if a connection is working
   */
  private async testConnection(db: PGlite): Promise<void> {
    try {
      await db.query('SELECT 1 as test')
    } catch (error) {
      throw new Error(`Connection test failed: ${error}`)
    }
  }

  /**
   * Check if a connection is healthy
   */
  private async isConnectionHealthy(db: PGlite): Promise<boolean> {
    try {
      await this.testConnection(db)
      return true
    } catch (error) {
      console.warn('[PGlite] Connection health check failed:', error)
      return false
    }
  }

  /**
   * Generate a unique key for connection tracking
   */
  private getConnectionKey(dbPath: string): string {
    return path.resolve(dbPath)
  }

  /**
   * Get database size in bytes
   */
  async getDatabaseSize(dbPath: string): Promise<number> {
    try {
      if (!fs.existsSync(dbPath)) {
        return 0
      }
      const stats = fs.statSync(dbPath)
      return stats.size
    } catch (error) {
      console.error(`[PGlite] Error getting database size for ${dbPath}:`, error)
      return 0
    }
  }

  /**
   * Get database metadata
   */
  async getDatabaseInfo(dbPath: string): Promise<{
    exists: boolean
    size: number
    created?: Date
    modified?: Date
  }> {
    try {
      if (!fs.existsSync(dbPath)) {
        return { exists: false, size: 0 }
      }

      const stats = fs.statSync(dbPath)
      return {
        exists: true,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      }
    } catch (error) {
      console.error(`[PGlite] Error getting database info for ${dbPath}:`, error)
      return { exists: false, size: 0 }
    }
  }
}

/**
 * Utility functions for PGlite connections
 */
export class PGliteConnectionUtils {
  /**
   * Create a connection with default configuration
   */
  static async createDefaultConnection(): Promise<PGlite> {
    const config = PGliteConfigManager.getDefaultConfig()
    const pgliteConfig = PGliteConfigManager.createPGliteConfig(config)
    const manager = PGliteConnectionManager.getInstance()

    return manager.createConnection(pgliteConfig)
  }

  /**
   * Create a connection for testing
   */
  static async createTestConnection(): Promise<PGlite> {
    const config = PGliteConfigManager.getTestConfig()
    const pgliteConfig = PGliteConfigManager.createPGliteConfig(config)
    const manager = PGliteConnectionManager.getInstance()

    return manager.createConnection(pgliteConfig)
  }

  /**
   * Validate connection configuration
   */
  static validateConnectionConfig(config: PGliteConnectionConfig): {
    isValid: boolean
    errors: string[]
  } {
    return PGliteConfigManager.validateConfig(config)
  }

  /**
   * Get connection manager instance
   */
  static getConnectionManager(): PGliteConnectionManager {
    return PGliteConnectionManager.getInstance()
  }

  /**
   * Cleanup all connections (useful for application shutdown)
   */
  static async cleanup(): Promise<void> {
    const manager = PGliteConnectionManager.getInstance()
    await manager.closeAllConnections()
  }
}
