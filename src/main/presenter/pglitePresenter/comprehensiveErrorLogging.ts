/**
 * Comprehensive Error Logging and Diagnostic System
 * Implements requirements 8.4, 11.4 for comprehensive error logging and diagnostic capabilities
 * Provides advanced error tracking, analysis, and reporting for the migration system
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { getDiagnosticSystem } from './diagnosticSystem'

export interface ErrorContext {
  timestamp: number
  sessionId: string
  migrationId?: string
  phase: string
  operation: string
  userId?: string
  systemInfo: {
    platform: string
    arch: string
    nodeVersion: string
    electronVersion: string
    memoryUsage: NodeJS.MemoryUsage
    cpuUsage: NodeJS.CpuUsage
    diskSpace: {
      free: number
      total: number
    }
  }
  applicationState: {
    migrationInProgress: boolean
    currentPhase?: string
    progress?: number
    activeConnections: number
    pendingOperations: number
  }
}

export interface ErrorAnalysis {
  errorId: string
  classification: {
    type: 'system' | 'application' | 'user' | 'network' | 'database' | 'migration'
    severity: 'low' | 'medium' | 'high' | 'critical'
    category: string
    subcategory?: string
  }
  impact: {
    userImpact: 'none' | 'minor' | 'moderate' | 'severe' | 'critical'
    systemImpact: 'none' | 'minor' | 'moderate' | 'severe' | 'critical'
    dataImpact: 'none' | 'minor' | 'moderate' | 'severe' | 'critical'
    businessImpact: 'none' | 'minor' | 'moderate' | 'severe' | 'critical'
  }
  rootCause: {
    primary: string
    contributing: string[]
    environmental: string[]
  }
  resolution: {
    immediate: string[]
    shortTerm: string[]
    longTerm: string[]
    preventive: string[]
  }
  similar: {
    count: number
    patterns: string[]
    frequency: 'rare' | 'occasional' | 'frequent' | 'constant'
  }
}

export interface ErrorTrend {
  timeframe: 'hour' | 'day' | 'week' | 'month'
  errorCount: number
  errorRate: number
  topErrors: Array<{
    type: string
    count: number
    percentage: number
  }>
  severity: {
    critical: number
    high: number
    medium: number
    low: number
  }
  resolution: {
    resolved: number
    unresolved: number
    averageResolutionTime: number
  }
}

export interface ComprehensiveErrorLog {
  id: string
  timestamp: number
  error: {
    name: string
    message: string
    stack?: string
    code?: string | number
    errno?: number
    syscall?: string
    path?: string
  }
  context: ErrorContext
  analysis: ErrorAnalysis
  breadcrumbs: ErrorBreadcrumb[]
  attachments: ErrorAttachment[]
  tags: string[]
  fingerprint: string
  resolved: boolean
  resolutionTime?: number
  resolutionMethod?: string
  resolutionNotes?: string
}

export interface ErrorBreadcrumb {
  timestamp: number
  category: 'navigation' | 'user' | 'system' | 'network' | 'database' | 'migration'
  message: string
  level: 'debug' | 'info' | 'warning' | 'error'
  data?: any
}

export interface ErrorAttachment {
  id: string
  name: string
  type: 'log' | 'screenshot' | 'config' | 'database_dump' | 'memory_dump' | 'other'
  size: number
  path: string
  description?: string
}

/**
 * Comprehensive Error Logger
 * Provides advanced error logging, analysis, and reporting capabilities
 */
export class ComprehensiveErrorLogger {
  private static instance: ComprehensiveErrorLogger | null = null
  private diagnosticSystem = getDiagnosticSystem()
  private errorLogs: ComprehensiveErrorLog[] = []
  private breadcrumbs: ErrorBreadcrumb[] = []
  private sessionId: string
  private logFilePath: string = ''
  private analysisFilePath: string = ''
  private isInitialized: boolean = false

  // Error tracking
  private errorCounts: Map<string, number> = new Map()
  private errorPatterns: Map<string, string[]> = new Map()
  private resolutionTimes: Map<string, number[]> = new Map()

  private constructor() {
    this.sessionId = this.generateSessionId()
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ComprehensiveErrorLogger {
    if (!ComprehensiveErrorLogger.instance) {
      ComprehensiveErrorLogger.instance = new ComprehensiveErrorLogger()
    }
    return ComprehensiveErrorLogger.instance
  }

  /**
   * Initialize comprehensive error logging system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    console.log('[Comprehensive Error Logger] Initializing advanced error logging system')

    try {
      // Setup log files
      await this.setupLogFiles()

      // Setup global error handlers
      this.setupGlobalErrorHandlers()

      // Load historical error data
      await this.loadHistoricalData()

      // Start breadcrumb collection
      this.startBreadcrumbCollection()

      this.isInitialized = true
      console.log('[Comprehensive Error Logger] Initialization completed')
    } catch (error) {
      console.error('[Comprehensive Error Logger] Initialization failed:', error)
      throw error
    }
  }

  /**
   * Setup log files and directories
   */
  private async setupLogFiles(): Promise<void> {
    const appDataDir = app.getPath('userData')
    const errorLogsDir = path.join(appDataDir, 'error_logs')
    const analysisDir = path.join(appDataDir, 'error_analysis')

    // Create directories
    if (!fs.existsSync(errorLogsDir)) {
      fs.mkdirSync(errorLogsDir, { recursive: true })
    }

    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true })
    }

    // Setup log files with timestamps
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.logFilePath = path.join(errorLogsDir, `comprehensive-errors-${timestamp}.json`)
    this.analysisFilePath = path.join(analysisDir, `error-analysis-${timestamp}.json`)

    // Initialize log files
    fs.writeFileSync(this.logFilePath, JSON.stringify([], null, 2))
    fs.writeFileSync(
      this.analysisFilePath,
      JSON.stringify(
        {
          sessionId: this.sessionId,
          startTime: Date.now(),
          errorTrends: [],
          patterns: [],
          recommendations: []
        },
        null,
        2
      )
    )
  }

  /**
   * Setup global error handlers
   */
  private setupGlobalErrorHandlers(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logError(error, {
        phase: 'global',
        operation: 'uncaught_exception',
        severity: 'critical'
      })
    })

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.logError(error, {
        phase: 'global',
        operation: 'unhandled_rejection',
        severity: 'high',
        details: { promise: promise.toString() }
      })
    })

    // Handle warnings
    process.on('warning', (warning) => {
      this.addBreadcrumb({
        category: 'system',
        message: `Warning: ${warning.message}`,
        level: 'warning',
        data: {
          name: warning.name,
          stack: warning.stack
        }
      })
    })
  }

  /**
   * Load historical error data for pattern analysis
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      const appDataDir = app.getPath('userData')
      const errorLogsDir = path.join(appDataDir, 'error_logs')

      if (!fs.existsSync(errorLogsDir)) {
        return
      }

      const logFiles = fs
        .readdirSync(errorLogsDir)
        .filter((file) => file.startsWith('comprehensive-errors-') && file.endsWith('.json'))
        .sort()
        .slice(-5) // Load last 5 log files

      for (const logFile of logFiles) {
        try {
          const logPath = path.join(errorLogsDir, logFile)
          const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'))

          if (Array.isArray(logData)) {
            // Analyze historical patterns
            for (const errorLog of logData) {
              this.updateErrorPatterns(errorLog)
            }
          }
        } catch (error) {
          console.warn(
            `[Comprehensive Error Logger] Failed to load historical data from ${logFile}:`,
            error
          )
        }
      }

      console.log('[Comprehensive Error Logger] Historical data loaded for pattern analysis')
    } catch (error) {
      console.warn('[Comprehensive Error Logger] Failed to load historical data:', error)
    }
  }

  /**
   * Start breadcrumb collection
   */
  private startBreadcrumbCollection(): void {
    // Collect system breadcrumbs periodically
    setInterval(() => {
      this.addBreadcrumb({
        category: 'system',
        message: 'System health check',
        level: 'debug',
        data: {
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
          uptime: process.uptime()
        }
      })
    }, 60000) // Every minute
  }

  /**
   * Log comprehensive error with analysis
   */
  async logError(
    error: Error,
    context: {
      phase: string
      operation: string
      severity?: 'low' | 'medium' | 'high' | 'critical'
      migrationId?: string
      userId?: string
      details?: any
    }
  ): Promise<string> {
    const errorId = this.generateErrorId()
    const timestamp = Date.now()

    console.log(`[Comprehensive Error Logger] Logging error: ${error.message}`)

    try {
      // Create error context
      const errorContext = await this.createErrorContext(context)

      // Analyze error
      const analysis = await this.analyzeError(error, errorContext)

      // Create comprehensive error log
      const comprehensiveLog: ComprehensiveErrorLog = {
        id: errorId,
        timestamp,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: (error as any).code,
          errno: (error as any).errno,
          syscall: (error as any).syscall,
          path: (error as any).path
        },
        context: errorContext,
        analysis,
        breadcrumbs: this.getRecentBreadcrumbs(),
        attachments: await this.createErrorAttachments(errorId, error, errorContext),
        tags: this.generateErrorTags(error, errorContext),
        fingerprint: this.generateErrorFingerprint(error, errorContext),
        resolved: false
      }

      // Store error log
      this.errorLogs.push(comprehensiveLog)

      // Update error patterns
      this.updateErrorPatterns(comprehensiveLog)

      // Save to file
      await this.saveErrorLog(comprehensiveLog)

      // Log to diagnostic system
      this.diagnosticSystem.logEvent({
        level: context.severity === 'critical' ? 'critical' : 'error',
        category: 'migration',
        message: `Comprehensive error logged: ${error.message}`,
        details: {
          errorId,
          fingerprint: comprehensiveLog.fingerprint,
          phase: context.phase,
          operation: context.operation
        }
      })

      // Add breadcrumb for this error
      this.addBreadcrumb({
        category: 'system',
        message: `Error logged: ${error.message}`,
        level: 'error',
        data: {
          errorId,
          phase: context.phase,
          operation: context.operation
        }
      })

      console.log(`[Comprehensive Error Logger] Error logged with ID: ${errorId}`)
      return errorId
    } catch (loggingError) {
      console.error('[Comprehensive Error Logger] Failed to log error:', loggingError)

      // Fallback logging
      this.diagnosticSystem.logEvent({
        level: 'critical',
        category: 'system',
        message: `Error logging failed: ${loggingError}`,
        details: {
          originalError: error.message,
          phase: context.phase,
          operation: context.operation
        }
      })

      return errorId
    }
  }

  /**
   * Create comprehensive error context
   */
  private async createErrorContext(context: {
    phase: string
    operation: string
    migrationId?: string
    userId?: string
    details?: any
  }): Promise<ErrorContext> {
    // Get system information
    const memoryUsage = process.memoryUsage()
    const cpuUsage = process.cpuUsage()

    // Get disk space (simplified)
    const diskSpace = {
      free: 1024 * 1024 * 1024 * 10, // 10GB placeholder
      total: 1024 * 1024 * 1024 * 100 // 100GB placeholder
    }

    return {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      migrationId: context.migrationId,
      phase: context.phase,
      operation: context.operation,
      userId: context.userId,
      systemInfo: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron || 'unknown',
        memoryUsage,
        cpuUsage,
        diskSpace
      },
      applicationState: {
        migrationInProgress: false, // This would be determined from actual state
        activeConnections: 0, // This would be determined from actual state
        pendingOperations: 0 // This would be determined from actual state
      }
    }
  }

  /**
   * Analyze error for classification and resolution
   */
  private async analyzeError(error: Error, context: ErrorContext): Promise<ErrorAnalysis> {
    const errorMessage = error.message.toLowerCase()

    // Classify error type
    let type: ErrorAnalysis['classification']['type'] = 'application'
    let category = 'unknown'
    let severity: ErrorAnalysis['classification']['severity'] = 'medium'

    // System errors
    if (errorMessage.includes('enospc') || errorMessage.includes('disk space')) {
      type = 'system'
      category = 'disk_space'
      severity = 'high'
    } else if (errorMessage.includes('eacces') || errorMessage.includes('permission')) {
      type = 'system'
      category = 'permissions'
      severity = 'high'
    } else if (errorMessage.includes('econnrefused') || errorMessage.includes('network')) {
      type = 'network'
      category = 'connection'
      severity = 'medium'
    } else if (errorMessage.includes('database') || errorMessage.includes('sql')) {
      type = 'database'
      category = 'database_error'
      severity = 'high'
    } else if (context.phase.includes('migration')) {
      type = 'migration'
      category = 'migration_error'
      severity = 'high'
    }

    // Determine impact
    const impact = this.assessErrorImpact(error, context, severity)

    // Determine root cause
    const rootCause = this.analyzeRootCause(error, context)

    // Generate resolution strategies
    const resolution = this.generateResolutionStrategies(category)

    // Analyze similar errors
    const similar = this.analyzeSimilarErrors(error)

    return {
      errorId: this.generateErrorId(),
      classification: {
        type,
        severity,
        category,
        subcategory: this.determineSubcategory(error, category)
      },
      impact,
      rootCause,
      resolution,
      similar
    }
  }

  /**
   * Assess error impact
   */
  private assessErrorImpact(
    error: Error,
    context: ErrorContext,
    severity: ErrorAnalysis['classification']['severity']
  ): ErrorAnalysis['impact'] {
    let userImpact: ErrorAnalysis['impact']['userImpact'] = 'minor'
    let systemImpact: ErrorAnalysis['impact']['systemImpact'] = 'minor'
    let dataImpact: ErrorAnalysis['impact']['dataImpact'] = 'none'
    let businessImpact: ErrorAnalysis['impact']['businessImpact'] = 'minor'

    // Assess based on severity
    if (severity === 'critical') {
      userImpact = 'critical'
      systemImpact = 'severe'
      businessImpact = 'severe'
    } else if (severity === 'high') {
      userImpact = 'severe'
      systemImpact = 'moderate'
      businessImpact = 'moderate'
    }

    // Assess based on context
    if (context.phase.includes('migration')) {
      dataImpact = 'moderate'
      if (error.message.includes('corruption') || error.message.includes('lost')) {
        dataImpact = 'severe'
      }
    }

    if (context.applicationState.migrationInProgress) {
      userImpact = 'severe'
      businessImpact = 'moderate'
    }

    return {
      userImpact,
      systemImpact,
      dataImpact,
      businessImpact
    }
  }

  /**
   * Analyze root cause
   */
  private analyzeRootCause(error: Error, context: ErrorContext): ErrorAnalysis['rootCause'] {
    const primary = this.determinePrimaryRootCause(error)
    const contributing = this.identifyContributingFactors(context)
    const environmental = this.identifyEnvironmentalFactors(context)

    return {
      primary,
      contributing,
      environmental
    }
  }

  /**
   * Determine primary root cause
   */
  private determinePrimaryRootCause(error: Error): string {
    const errorMessage = error.message.toLowerCase()

    if (errorMessage.includes('enospc')) {
      return 'Insufficient disk space'
    } else if (errorMessage.includes('eacces')) {
      return 'Permission denied'
    } else if (errorMessage.includes('econnrefused')) {
      return 'Connection refused'
    } else if (errorMessage.includes('timeout')) {
      return 'Operation timeout'
    } else if (errorMessage.includes('corruption')) {
      return 'Data corruption'
    } else if (errorMessage.includes('not found')) {
      return 'Resource not found'
    } else {
      return 'Application logic error'
    }
  }

  /**
   * Identify contributing factors
   */
  private identifyContributingFactors(context: ErrorContext): string[] {
    const factors: string[] = []

    // Memory pressure
    if (context.systemInfo.memoryUsage.heapUsed > 500 * 1024 * 1024) {
      factors.push('High memory usage')
    }

    // Disk space pressure
    if (context.systemInfo.diskSpace.free < 1024 * 1024 * 1024) {
      factors.push('Low disk space')
    }

    // High system load
    if (context.applicationState.pendingOperations > 10) {
      factors.push('High system load')
    }

    // Migration in progress
    if (context.applicationState.migrationInProgress) {
      factors.push('Migration in progress')
    }

    return factors
  }

  /**
   * Identify environmental factors
   */
  private identifyEnvironmentalFactors(context: ErrorContext): string[] {
    const factors: string[] = []

    factors.push(`Platform: ${context.systemInfo.platform}`)
    factors.push(`Architecture: ${context.systemInfo.arch}`)
    factors.push(`Node version: ${context.systemInfo.nodeVersion}`)

    if (context.systemInfo.electronVersion) {
      factors.push(`Electron version: ${context.systemInfo.electronVersion}`)
    }

    return factors
  }

  /**
   * Generate resolution strategies
   */
  private generateResolutionStrategies(category: string): ErrorAnalysis['resolution'] {
    const immediate: string[] = []
    const shortTerm: string[] = []
    const longTerm: string[] = []
    const preventive: string[] = []

    // Category-specific resolutions
    switch (category) {
      case 'disk_space':
        immediate.push('Free up disk space')
        immediate.push('Check available storage')
        shortTerm.push('Implement disk space monitoring')
        longTerm.push('Upgrade storage capacity')
        preventive.push('Set up disk space alerts')
        break

      case 'permissions':
        immediate.push('Check file permissions')
        immediate.push('Run with appropriate privileges')
        shortTerm.push('Fix permission configuration')
        longTerm.push('Implement proper access control')
        preventive.push('Regular permission audits')
        break

      case 'connection':
        immediate.push('Check network connectivity')
        immediate.push('Retry connection')
        shortTerm.push('Implement connection retry logic')
        longTerm.push('Improve network reliability')
        preventive.push('Network monitoring and alerting')
        break

      case 'database_error':
        immediate.push('Check database integrity')
        immediate.push('Restart database connection')
        shortTerm.push('Implement database error handling')
        longTerm.push('Database optimization and maintenance')
        preventive.push('Regular database health checks')
        break

      case 'migration_error':
        immediate.push('Stop migration process')
        immediate.push('Check data integrity')
        shortTerm.push('Fix migration logic')
        longTerm.push('Improve migration robustness')
        preventive.push('Comprehensive migration testing')
        break

      default:
        immediate.push('Investigate error details')
        immediate.push('Check system logs')
        shortTerm.push('Implement error handling')
        longTerm.push('Code review and improvement')
        preventive.push('Enhanced testing and monitoring')
    }

    return {
      immediate,
      shortTerm,
      longTerm,
      preventive
    }
  }

  /**
   * Analyze similar errors
   */
  private analyzeSimilarErrors(error: Error): ErrorAnalysis['similar'] {
    const fingerprint = this.generateErrorFingerprint(error, {} as ErrorContext)
    const count = this.errorCounts.get(fingerprint) || 0
    const patterns = this.errorPatterns.get(fingerprint) || []

    let frequency: ErrorAnalysis['similar']['frequency'] = 'rare'
    if (count > 10) frequency = 'frequent'
    else if (count > 5) frequency = 'occasional'
    else if (count > 1) frequency = 'occasional'

    return {
      count,
      patterns,
      frequency
    }
  }

  /**
   * Determine error subcategory
   */
  private determineSubcategory(error: Error, category: string): string | undefined {
    const errorMessage = error.message.toLowerCase()

    switch (category) {
      case 'disk_space':
        if (errorMessage.includes('temp')) return 'temporary_files'
        if (errorMessage.includes('log')) return 'log_files'
        return 'general_storage'

      case 'permissions':
        if (errorMessage.includes('read')) return 'read_permission'
        if (errorMessage.includes('write')) return 'write_permission'
        return 'general_permission'

      case 'database_error':
        if (errorMessage.includes('lock')) return 'database_lock'
        if (errorMessage.includes('corrupt')) return 'database_corruption'
        if (errorMessage.includes('schema')) return 'schema_error'
        return 'general_database'

      default:
        return undefined
    }
  }

  /**
   * Create error attachments
   */
  private async createErrorAttachments(
    errorId: string,
    error: Error,
    context: ErrorContext
  ): Promise<ErrorAttachment[]> {
    const attachments: ErrorAttachment[] = []

    try {
      const appDataDir = app.getPath('userData')
      const attachmentsDir = path.join(appDataDir, 'error_attachments', errorId)

      if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true })
      }

      // Create system info attachment
      const systemInfoPath = path.join(attachmentsDir, 'system_info.json')
      const systemInfo = {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        },
        context,
        timestamp: Date.now(),
        breadcrumbs: this.getRecentBreadcrumbs()
      }

      fs.writeFileSync(systemInfoPath, JSON.stringify(systemInfo, null, 2))

      attachments.push({
        id: this.generateId(),
        name: 'system_info.json',
        type: 'config',
        size: fs.statSync(systemInfoPath).size,
        path: systemInfoPath,
        description: 'System information and error context'
      })

      // Create memory dump if available
      if (context.systemInfo.memoryUsage.heapUsed > 100 * 1024 * 1024) {
        const memoryDumpPath = path.join(attachmentsDir, 'memory_usage.json')
        const memoryInfo = {
          memoryUsage: context.systemInfo.memoryUsage,
          cpuUsage: context.systemInfo.cpuUsage,
          timestamp: Date.now()
        }

        fs.writeFileSync(memoryDumpPath, JSON.stringify(memoryInfo, null, 2))

        attachments.push({
          id: this.generateId(),
          name: 'memory_usage.json',
          type: 'memory_dump',
          size: fs.statSync(memoryDumpPath).size,
          path: memoryDumpPath,
          description: 'Memory usage information at time of error'
        })
      }
    } catch (attachmentError) {
      console.warn(
        '[Comprehensive Error Logger] Failed to create error attachments:',
        attachmentError
      )
    }

    return attachments
  }

  /**
   * Generate error tags
   */
  private generateErrorTags(error: Error, context: ErrorContext): string[] {
    const tags: string[] = []

    // Add phase tag
    tags.push(`phase:${context.phase}`)

    // Add operation tag
    tags.push(`operation:${context.operation}`)

    // Add platform tag
    tags.push(`platform:${context.systemInfo.platform}`)

    // Add error type tags
    if (error.message.includes('ENOSPC')) tags.push('disk-space')
    if (error.message.includes('EACCES')) tags.push('permissions')
    if (error.message.includes('timeout')) tags.push('timeout')
    if (error.message.includes('database')) tags.push('database')
    if (error.message.includes('migration')) tags.push('migration')

    // Add severity tag based on context
    if (context.applicationState.migrationInProgress) {
      tags.push('migration-critical')
    }

    return tags
  }

  /**
   * Generate error fingerprint for deduplication
   */
  private generateErrorFingerprint(error: Error, context: ErrorContext): string {
    const components = [
      error.name,
      error.message.replace(/\d+/g, 'N'), // Replace numbers with N
      context.phase,
      context.operation
    ]

    return components.join('|')
  }

  /**
   * Update error patterns for analysis
   */
  private updateErrorPatterns(errorLog: ComprehensiveErrorLog): void {
    const fingerprint = errorLog.fingerprint

    // Update count
    const currentCount = this.errorCounts.get(fingerprint) || 0
    this.errorCounts.set(fingerprint, currentCount + 1)

    // Update patterns
    const patterns = this.errorPatterns.get(fingerprint) || []
    patterns.push(`${errorLog.context.phase}:${errorLog.context.operation}`)
    this.errorPatterns.set(fingerprint, patterns.slice(-10)) // Keep last 10 patterns
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(breadcrumb: Omit<ErrorBreadcrumb, 'timestamp'>): void {
    const fullBreadcrumb: ErrorBreadcrumb = {
      timestamp: Date.now(),
      ...breadcrumb
    }

    this.breadcrumbs.push(fullBreadcrumb)

    // Keep only last 100 breadcrumbs
    if (this.breadcrumbs.length > 100) {
      this.breadcrumbs = this.breadcrumbs.slice(-100)
    }
  }

  /**
   * Get recent breadcrumbs
   */
  private getRecentBreadcrumbs(): ErrorBreadcrumb[] {
    return this.breadcrumbs.slice(-20) // Last 20 breadcrumbs
  }

  /**
   * Save error log to file
   */
  private async saveErrorLog(errorLog: ComprehensiveErrorLog): Promise<void> {
    try {
      // Read existing logs
      let existingLogs: ComprehensiveErrorLog[] = []
      if (fs.existsSync(this.logFilePath)) {
        const logData = fs.readFileSync(this.logFilePath, 'utf8')
        existingLogs = JSON.parse(logData)
      }

      // Add new log
      existingLogs.push(errorLog)

      // Keep only last 1000 logs
      if (existingLogs.length > 1000) {
        existingLogs = existingLogs.slice(-1000)
      }

      // Save to file
      fs.writeFileSync(this.logFilePath, JSON.stringify(existingLogs, null, 2))
    } catch (error) {
      console.error('[Comprehensive Error Logger] Failed to save error log:', error)
    }
  }

  /**
   * Mark error as resolved
   */
  async resolveError(
    errorId: string,
    resolutionMethod: string,
    resolutionNotes?: string
  ): Promise<void> {
    const errorLog = this.errorLogs.find((log) => log.id === errorId)

    if (errorLog) {
      errorLog.resolved = true
      errorLog.resolutionTime = Date.now()
      errorLog.resolutionMethod = resolutionMethod
      errorLog.resolutionNotes = resolutionNotes

      // Update resolution times for analysis
      const fingerprint = errorLog.fingerprint
      const resolutionTimes = this.resolutionTimes.get(fingerprint) || []
      const resolutionDuration = errorLog.resolutionTime - errorLog.timestamp
      resolutionTimes.push(resolutionDuration)
      this.resolutionTimes.set(fingerprint, resolutionTimes.slice(-10)) // Keep last 10

      // Save updated log
      await this.saveErrorLog(errorLog)

      console.log(`[Comprehensive Error Logger] Error ${errorId} marked as resolved`)
    }
  }

  /**
   * Generate error trends analysis
   */
  generateErrorTrends(timeframe: ErrorTrend['timeframe'] = 'day'): ErrorTrend {
    const now = Date.now()
    let timeframeDuration: number

    switch (timeframe) {
      case 'hour':
        timeframeDuration = 60 * 60 * 1000
        break
      case 'day':
        timeframeDuration = 24 * 60 * 60 * 1000
        break
      case 'week':
        timeframeDuration = 7 * 24 * 60 * 60 * 1000
        break
      case 'month':
        timeframeDuration = 30 * 24 * 60 * 60 * 1000
        break
    }

    const cutoffTime = now - timeframeDuration
    const recentErrors = this.errorLogs.filter((log) => log.timestamp >= cutoffTime)

    // Count errors by type
    const errorTypes = new Map<string, number>()
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 }
    let resolvedCount = 0
    const resolutionTimes: number[] = []

    for (const errorLog of recentErrors) {
      const type = errorLog.analysis.classification.category
      errorTypes.set(type, (errorTypes.get(type) || 0) + 1)

      severityCounts[errorLog.analysis.classification.severity]++

      if (errorLog.resolved) {
        resolvedCount++
        if (errorLog.resolutionTime) {
          resolutionTimes.push(errorLog.resolutionTime - errorLog.timestamp)
        }
      }
    }

    // Generate top errors
    const topErrors = Array.from(errorTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({
        type,
        count,
        percentage: (count / recentErrors.length) * 100
      }))

    // Calculate average resolution time
    const averageResolutionTime =
      resolutionTimes.length > 0
        ? resolutionTimes.reduce((sum, time) => sum + time, 0) / resolutionTimes.length
        : 0

    return {
      timeframe,
      errorCount: recentErrors.length,
      errorRate: recentErrors.length / (timeframeDuration / (60 * 60 * 1000)), // errors per hour
      topErrors,
      severity: severityCounts,
      resolution: {
        resolved: resolvedCount,
        unresolved: recentErrors.length - resolvedCount,
        averageResolutionTime
      }
    }
  }

  /**
   * Generate comprehensive error report
   */
  async generateComprehensiveReport(): Promise<string> {
    const trends = this.generateErrorTrends('day')
    const weeklyTrends = this.generateErrorTrends('week')

    const report = [
      '# Comprehensive Error Analysis Report',
      `Generated: ${new Date().toISOString()}`,
      `Session ID: ${this.sessionId}`,
      '',
      '## Summary',
      `- Total Errors (24h): ${trends.errorCount}`,
      `- Error Rate: ${trends.errorRate.toFixed(2)} errors/hour`,
      `- Resolved Errors: ${trends.resolution.resolved}`,
      `- Unresolved Errors: ${trends.resolution.unresolved}`,
      `- Average Resolution Time: ${(trends.resolution.averageResolutionTime / 1000 / 60).toFixed(1)} minutes`,
      '',
      '## Severity Distribution (24h)',
      `- Critical: ${trends.severity.critical}`,
      `- High: ${trends.severity.high}`,
      `- Medium: ${trends.severity.medium}`,
      `- Low: ${trends.severity.low}`,
      '',
      '## Top Error Types (24h)',
      ...trends.topErrors.map(
        (error) => `- ${error.type}: ${error.count} (${error.percentage.toFixed(1)}%)`
      ),
      '',
      '## Weekly Trends',
      `- Total Errors (7d): ${weeklyTrends.errorCount}`,
      `- Weekly Error Rate: ${weeklyTrends.errorRate.toFixed(2)} errors/hour`,
      `- Weekly Resolution Rate: ${((weeklyTrends.resolution.resolved / weeklyTrends.errorCount) * 100).toFixed(1)}%`,
      '',
      '## Error Patterns',
      ...Array.from(this.errorPatterns.entries())
        .slice(0, 10)
        .map(([fingerprint, patterns]) => `- ${fingerprint}: ${patterns.length} occurrences`),
      '',
      '## Recommendations',
      ...this.generateErrorRecommendations(trends),
      ''
    ].join('\n')

    // Save report to file
    const appDataDir = app.getPath('userData')
    const reportsDir = path.join(appDataDir, 'error_reports')

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportPath = path.join(reportsDir, `error-report-${timestamp}.md`)

    fs.writeFileSync(reportPath, report)
    console.log(`[Comprehensive Error Logger] Report saved: ${reportPath}`)

    return report
  }

  /**
   * Generate error recommendations
   */
  private generateErrorRecommendations(trends: ErrorTrend): string[] {
    const recommendations: string[] = []

    if (trends.severity.critical > 0) {
      recommendations.push('Address critical errors immediately')
    }

    if (trends.resolution.averageResolutionTime > 60 * 60 * 1000) {
      // More than 1 hour
      recommendations.push('Improve error resolution processes')
    }

    if (trends.errorRate > 10) {
      // More than 10 errors per hour
      recommendations.push('Investigate high error rate causes')
    }

    const topErrorType = trends.topErrors[0]
    if (topErrorType && topErrorType.percentage > 50) {
      recommendations.push(
        `Focus on resolving ${topErrorType.type} errors (${topErrorType.percentage.toFixed(1)}% of all errors)`
      )
    }

    if (trends.resolution.unresolved > trends.resolution.resolved) {
      recommendations.push('Improve error resolution rate')
    }

    return recommendations
  }

  /**
   * Get error logs with filtering
   */
  getErrorLogs(filter?: {
    severity?: ErrorAnalysis['classification']['severity']
    category?: string
    resolved?: boolean
    since?: number
    limit?: number
  }): ComprehensiveErrorLog[] {
    let filteredLogs = this.errorLogs

    if (filter) {
      if (filter.severity) {
        filteredLogs = filteredLogs.filter(
          (log) => log.analysis.classification.severity === filter.severity
        )
      }

      if (filter.category) {
        filteredLogs = filteredLogs.filter(
          (log) => log.analysis.classification.category === filter.category
        )
      }

      if (typeof filter.resolved === 'boolean') {
        filteredLogs = filteredLogs.filter((log) => log.resolved === filter.resolved)
      }

      if (filter.since) {
        filteredLogs = filteredLogs.filter((log) => log.timestamp >= filter.since!)
      }
    }

    // Sort by timestamp (newest first)
    filteredLogs.sort((a, b) => b.timestamp - a.timestamp)

    // Apply limit
    if (filter?.limit) {
      filteredLogs = filteredLogs.slice(0, filter.limit)
    }

    return filteredLogs
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Generate error ID
   */
  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Shutdown comprehensive error logging
   */
  async shutdown(): Promise<void> {
    console.log('[Comprehensive Error Logger] Shutting down error logging system')

    try {
      // Generate final report
      await this.generateComprehensiveReport()

      // Save final analysis
      const finalAnalysis = {
        sessionId: this.sessionId,
        startTime: Date.now(),
        errorTrends: [
          this.generateErrorTrends('hour'),
          this.generateErrorTrends('day'),
          this.generateErrorTrends('week')
        ],
        patterns: Array.from(this.errorPatterns.entries()),
        recommendations: this.generateErrorRecommendations(this.generateErrorTrends('day')),
        totalErrors: this.errorLogs.length,
        resolvedErrors: this.errorLogs.filter((log) => log.resolved).length
      }

      fs.writeFileSync(this.analysisFilePath, JSON.stringify(finalAnalysis, null, 2))

      console.log('[Comprehensive Error Logger] Shutdown completed')
    } catch (error) {
      console.error('[Comprehensive Error Logger] Shutdown failed:', error)
    }
  }
}

/**
 * Get comprehensive error logger instance
 */
export function getComprehensiveErrorLogger(): ComprehensiveErrorLogger {
  return ComprehensiveErrorLogger.getInstance()
}

/**
 * Initialize comprehensive error logging system
 */
export async function initializeComprehensiveErrorLogging(): Promise<ComprehensiveErrorLogger> {
  const errorLogger = ComprehensiveErrorLogger.getInstance()
  await errorLogger.initialize()
  return errorLogger
}
