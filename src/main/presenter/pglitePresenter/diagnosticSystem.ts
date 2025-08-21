/**
 * Comprehensive Diagnostic and Monitoring System for PGlite Migration
 * Implements requirements 8.4, 11.4 for comprehensive error logging and diagnostic capabilities
 * Provides real-time monitoring, performance metrics, and detailed diagnostics
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { EventEmitter } from 'events'

export interface DiagnosticMetrics {
  timestamp: number
  memoryUsage: NodeJS.MemoryUsage
  cpuUsage: NodeJS.CpuUsage
  diskSpace: {
    free: number
    total: number
    used: number
  }
  databaseMetrics: {
    connectionCount: number
    queryCount: number
    averageQueryTime: number
    errorCount: number
  }
  migrationMetrics: {
    phase: string
    progress: number
    recordsProcessed: number
    recordsPerSecond: number
    estimatedTimeRemaining: number
  }
}

export interface DiagnosticEvent {
  id: string
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical'
  category: 'migration' | 'database' | 'system' | 'performance' | 'user'
  message: string
  details?: any
  context?: {
    phase?: string
    operation?: string
    userId?: string
    sessionId?: string
  }
  metrics?: Partial<DiagnosticMetrics>
  stackTrace?: string
}

export interface PerformanceProfile {
  operationName: string
  startTime: number
  endTime: number
  duration: number
  memoryBefore: NodeJS.MemoryUsage
  memoryAfter: NodeJS.MemoryUsage
  cpuBefore: NodeJS.CpuUsage
  cpuAfter: NodeJS.CpuUsage
  success: boolean
  errorMessage?: string
}

export interface SystemHealthReport {
  timestamp: number
  overallHealth: 'healthy' | 'warning' | 'critical'
  systemMetrics: DiagnosticMetrics
  recentErrors: DiagnosticEvent[]
  performanceIssues: string[]
  recommendations: string[]
  migrationStatus: {
    isActive: boolean
    phase?: string
    progress?: number
    estimatedCompletion?: number
  }
}

/**
 * Comprehensive Diagnostic System
 * Provides monitoring, logging, and performance analysis for the migration system
 */
export class DiagnosticSystem extends EventEmitter {
  private static instance: DiagnosticSystem | null = null
  private isInitialized: boolean = false
  private logFilePath: string = ''
  private metricsFilePath: string = ''
  private events: DiagnosticEvent[] = []
  private performanceProfiles: PerformanceProfile[] = []
  private metricsHistory: DiagnosticMetrics[] = []
  private monitoringInterval: NodeJS.Timeout | null = null
  private sessionId: string = ''
  private startTime: number = Date.now()

  // Performance tracking
  private queryCount: number = 0
  private totalQueryTime: number = 0
  private errorCount: number = 0
  private connectionCount: number = 0

  // Migration tracking
  private migrationPhase: string = 'idle'
  private migrationProgress: number = 0
  private recordsProcessed: number = 0
  private migrationStartTime: number = 0

  private constructor() {
    super()
    this.sessionId = this.generateSessionId()
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DiagnosticSystem {
    if (!DiagnosticSystem.instance) {
      DiagnosticSystem.instance = new DiagnosticSystem()
    }
    return DiagnosticSystem.instance
  }

  /**
   * Initialize diagnostic system
   * Supports requirement 8.4 for comprehensive error logging
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    console.log('[Diagnostic System] Initializing diagnostic and monitoring system')

    try {
      // Setup log files
      await this.setupLogFiles()

      // Start monitoring
      this.startMonitoring()

      // Log initialization
      await this.logEvent({
        level: 'info',
        category: 'system',
        message: 'Diagnostic system initialized',
        details: {
          sessionId: this.sessionId,
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron
        }
      })

      this.isInitialized = true
      console.log('[Diagnostic System] Initialization completed')
    } catch (error) {
      console.error('[Diagnostic System] Initialization failed:', error)
      throw error
    }
  }

  /**
   * Setup log files and directories
   */
  private async setupLogFiles(): Promise<void> {
    const appDataDir = app.getPath('userData')
    const logsDir = path.join(appDataDir, 'logs')
    const metricsDir = path.join(appDataDir, 'metrics')

    // Create directories
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }

    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true })
    }

    // Setup log files with timestamps
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.logFilePath = path.join(logsDir, `migration-${timestamp}.log`)
    this.metricsFilePath = path.join(metricsDir, `metrics-${timestamp}.json`)

    // Initialize log files
    fs.writeFileSync(this.logFilePath, `# Migration Diagnostic Log - ${new Date().toISOString()}\n`)
    fs.writeFileSync(this.metricsFilePath, '[]')
  }

  /**
   * Start system monitoring
   */
  private startMonitoring(): void {
    // Collect metrics every 5 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics()
        this.metricsHistory.push(metrics)

        // Keep only last 1000 metrics (about 1.4 hours at 5-second intervals)
        if (this.metricsHistory.length > 1000) {
          this.metricsHistory = this.metricsHistory.slice(-1000)
        }

        // Save metrics to file periodically
        if (this.metricsHistory.length % 12 === 0) {
          // Every minute
          await this.saveMetricsToFile()
        }

        // Check for performance issues
        await this.checkPerformanceIssues(metrics)

        this.emit('metrics', metrics)
      } catch (error) {
        console.error('[Diagnostic System] Monitoring error:', error)
      }
    }, 5000)
  }

  /**
   * Collect comprehensive system metrics
   */
  private async collectMetrics(): Promise<DiagnosticMetrics> {
    const memoryUsage = process.memoryUsage()
    const cpuUsage = process.cpuUsage()

    // Get disk space information
    const diskSpace = await this.getDiskSpaceInfo()

    // Calculate database metrics
    const averageQueryTime = this.queryCount > 0 ? this.totalQueryTime / this.queryCount : 0

    // Calculate migration metrics
    const migrationDuration = this.migrationStartTime > 0 ? Date.now() - this.migrationStartTime : 0
    const recordsPerSecond =
      migrationDuration > 0 ? this.recordsProcessed / (migrationDuration / 1000) : 0
    const estimatedTimeRemaining =
      this.migrationProgress > 0 && this.migrationProgress < 100
        ? (migrationDuration / this.migrationProgress) * (100 - this.migrationProgress)
        : 0

    return {
      timestamp: Date.now(),
      memoryUsage,
      cpuUsage,
      diskSpace,
      databaseMetrics: {
        connectionCount: this.connectionCount,
        queryCount: this.queryCount,
        averageQueryTime,
        errorCount: this.errorCount
      },
      migrationMetrics: {
        phase: this.migrationPhase,
        progress: this.migrationProgress,
        recordsProcessed: this.recordsProcessed,
        recordsPerSecond,
        estimatedTimeRemaining
      }
    }
  }

  /**
   * Get disk space information
   */
  private async getDiskSpaceInfo(): Promise<{ free: number; total: number; used: number }> {
    try {
      // This is a simplified implementation
      // In a real implementation, you would use a library like 'check-disk-space'
      const total = 1024 * 1024 * 1024 * 100 // 100GB placeholder
      const free = total * 0.7 // 70% free placeholder
      const used = total - free

      return { free, total, used }
    } catch (error) {
      return { free: 0, total: 0, used: 0 }
    }
  }

  /**
   * Check for performance issues and alert
   */
  private async checkPerformanceIssues(metrics: DiagnosticMetrics): Promise<void> {
    const issues: string[] = []

    // Check memory usage
    const memoryUsageMB = metrics.memoryUsage.heapUsed / 1024 / 1024
    if (memoryUsageMB > 500) {
      // 500MB threshold
      issues.push(`High memory usage: ${memoryUsageMB.toFixed(2)} MB`)
    }

    // Check disk space
    const diskUsagePercent = (metrics.diskSpace.used / metrics.diskSpace.total) * 100
    if (diskUsagePercent > 90) {
      issues.push(`Low disk space: ${diskUsagePercent.toFixed(1)}% used`)
    }

    // Check query performance
    if (metrics.databaseMetrics.averageQueryTime > 1000) {
      // 1 second threshold
      issues.push(
        `Slow database queries: ${metrics.databaseMetrics.averageQueryTime.toFixed(0)}ms average`
      )
    }

    // Check error rate
    const recentErrorRate = this.calculateRecentErrorRate()
    if (recentErrorRate > 0.1) {
      // 10% error rate threshold
      issues.push(`High error rate: ${(recentErrorRate * 100).toFixed(1)}%`)
    }

    // Log performance issues
    for (const issue of issues) {
      await this.logEvent({
        level: 'warn',
        category: 'performance',
        message: issue,
        metrics
      })
    }
  }

  /**
   * Calculate recent error rate
   */
  private calculateRecentErrorRate(): number {
    const recentEvents = this.events.filter(
      (e) =>
        e.timestamp > Date.now() - 60000 && // Last minute
        (e.level === 'error' || e.level === 'critical')
    )

    const totalRecentEvents = this.events.filter((e) => e.timestamp > Date.now() - 60000)

    return totalRecentEvents.length > 0 ? recentEvents.length / totalRecentEvents.length : 0
  }

  /**
   * Log diagnostic event
   * Supports requirement 8.4 for comprehensive error logging
   */
  async logEvent(event: Omit<DiagnosticEvent, 'id' | 'timestamp'>): Promise<void> {
    const diagnosticEvent: DiagnosticEvent = {
      id: this.generateEventId(),
      timestamp: Date.now(),
      ...event
    }

    // Add to events array
    this.events.push(diagnosticEvent)

    // Keep only last 10000 events
    if (this.events.length > 10000) {
      this.events = this.events.slice(-10000)
    }

    // Write to log file
    await this.writeToLogFile(diagnosticEvent)

    // Emit event for real-time monitoring
    this.emit('event', diagnosticEvent)

    // Handle critical events
    if (event.level === 'critical') {
      this.emit('critical', diagnosticEvent)
    }
  }

  /**
   * Write event to log file
   */
  private async writeToLogFile(event: DiagnosticEvent): Promise<void> {
    try {
      const logEntry = [
        `[${new Date(event.timestamp).toISOString()}]`,
        `[${event.level.toUpperCase()}]`,
        `[${event.category}]`,
        event.message
      ].join(' ')

      const detailsEntry = event.details
        ? `\nDetails: ${JSON.stringify(event.details, null, 2)}`
        : ''
      const contextEntry = event.context
        ? `\nContext: ${JSON.stringify(event.context, null, 2)}`
        : ''
      const stackEntry = event.stackTrace ? `\nStack: ${event.stackTrace}` : ''

      const fullEntry = `${logEntry}${detailsEntry}${contextEntry}${stackEntry}\n\n`

      fs.appendFileSync(this.logFilePath, fullEntry)
    } catch (error) {
      console.error('[Diagnostic System] Failed to write to log file:', error)
    }
  }

  /**
   * Save metrics to file
   */
  private async saveMetricsToFile(): Promise<void> {
    try {
      const metricsData = JSON.stringify(this.metricsHistory, null, 2)
      fs.writeFileSync(this.metricsFilePath, metricsData)
    } catch (error) {
      console.error('[Diagnostic System] Failed to save metrics:', error)
    }
  }

  /**
   * Start performance profiling for an operation
   */
  startPerformanceProfile(operationName: string): string {
    const profileId = this.generateEventId()
    const profile: Partial<PerformanceProfile> = {
      operationName,
      startTime: Date.now(),
      memoryBefore: process.memoryUsage(),
      cpuBefore: process.cpuUsage()
    }

    // Store partial profile for completion later
    this.performanceProfiles.push(profile as PerformanceProfile)

    return profileId
  }

  /**
   * End performance profiling for an operation
   */
  async endPerformanceProfile(success: boolean, errorMessage?: string): Promise<void> {
    const profileIndex = this.performanceProfiles.findIndex(
      (p) => p.startTime && Date.now() - p.startTime < 300000 // Within 5 minutes
    )

    if (profileIndex === -1) {
      return
    }

    const profile = this.performanceProfiles[profileIndex]
    profile.endTime = Date.now()
    profile.duration = profile.endTime - profile.startTime
    profile.memoryAfter = process.memoryUsage()
    profile.cpuAfter = process.cpuUsage(profile.cpuBefore)
    profile.success = success
    profile.errorMessage = errorMessage

    // Log performance profile
    await this.logEvent({
      level: success ? 'info' : 'warn',
      category: 'performance',
      message: `Operation ${profile.operationName} completed in ${profile.duration}ms`,
      details: {
        operationName: profile.operationName,
        duration: profile.duration,
        success: profile.success,
        memoryDelta: profile.memoryAfter.heapUsed - profile.memoryBefore.heapUsed,
        cpuTime: profile.cpuAfter.user + profile.cpuAfter.system,
        errorMessage: profile.errorMessage
      }
    })

    // Keep only last 1000 profiles
    if (this.performanceProfiles.length > 1000) {
      this.performanceProfiles = this.performanceProfiles.slice(-1000)
    }
  }

  /**
   * Track database operation
   */
  trackDatabaseOperation(queryTime: number, success: boolean): void {
    this.queryCount++
    this.totalQueryTime += queryTime

    if (!success) {
      this.errorCount++
    }
  }

  /**
   * Track database connection
   */
  trackDatabaseConnection(connected: boolean): void {
    if (connected) {
      this.connectionCount++
    } else {
      this.connectionCount = Math.max(0, this.connectionCount - 1)
    }
  }

  /**
   * Update migration status
   */
  updateMigrationStatus(phase: string, progress: number, recordsProcessed: number): void {
    this.migrationPhase = phase
    this.migrationProgress = progress
    this.recordsProcessed = recordsProcessed

    if (this.migrationStartTime === 0 && phase !== 'idle') {
      this.migrationStartTime = Date.now()
    }

    if (phase === 'completed' || phase === 'failed') {
      this.migrationStartTime = 0
    }
  }

  /**
   * Generate system health report
   */
  async generateHealthReport(): Promise<SystemHealthReport> {
    const currentMetrics = await this.collectMetrics()

    // Get recent errors (last hour)
    const recentErrors = this.events
      .filter(
        (e) => e.timestamp > Date.now() - 3600000 && (e.level === 'error' || e.level === 'critical')
      )
      .slice(-10) // Last 10 errors

    // Identify performance issues
    const performanceIssues: string[] = []

    if (currentMetrics.memoryUsage.heapUsed > 500 * 1024 * 1024) {
      performanceIssues.push('High memory usage detected')
    }

    if (currentMetrics.databaseMetrics.averageQueryTime > 1000) {
      performanceIssues.push('Slow database queries detected')
    }

    if (currentMetrics.diskSpace.free < 1024 * 1024 * 1024) {
      // Less than 1GB
      performanceIssues.push('Low disk space detected')
    }

    // Generate recommendations
    const recommendations: string[] = []

    if (performanceIssues.length > 0) {
      recommendations.push('Consider optimizing system resources')
    }

    if (recentErrors.length > 5) {
      recommendations.push('Investigate recent error patterns')
    }

    if (currentMetrics.migrationMetrics.recordsPerSecond < 100 && this.migrationPhase !== 'idle') {
      recommendations.push('Migration performance may be suboptimal')
    }

    // Determine overall health
    let overallHealth: 'healthy' | 'warning' | 'critical' = 'healthy'

    if (recentErrors.some((e) => e.level === 'critical') || performanceIssues.length > 2) {
      overallHealth = 'critical'
    } else if (recentErrors.length > 0 || performanceIssues.length > 0) {
      overallHealth = 'warning'
    }

    return {
      timestamp: Date.now(),
      overallHealth,
      systemMetrics: currentMetrics,
      recentErrors,
      performanceIssues,
      recommendations,
      migrationStatus: {
        isActive: this.migrationPhase !== 'idle',
        phase: this.migrationPhase !== 'idle' ? this.migrationPhase : undefined,
        progress: this.migrationPhase !== 'idle' ? this.migrationProgress : undefined,
        estimatedCompletion:
          currentMetrics.migrationMetrics.estimatedTimeRemaining > 0
            ? Date.now() + currentMetrics.migrationMetrics.estimatedTimeRemaining
            : undefined
      }
    }
  }

  /**
   * Get diagnostic events with filtering
   */
  getEvents(filter?: {
    level?: DiagnosticEvent['level']
    category?: DiagnosticEvent['category']
    since?: number
    limit?: number
  }): DiagnosticEvent[] {
    let filteredEvents = this.events

    if (filter) {
      if (filter.level) {
        filteredEvents = filteredEvents.filter((e) => e.level === filter.level)
      }

      if (filter.category) {
        filteredEvents = filteredEvents.filter((e) => e.category === filter.category)
      }

      if (filter.since) {
        filteredEvents = filteredEvents.filter((e) => e.timestamp >= filter.since!)
      }
    }

    // Sort by timestamp (newest first)
    filteredEvents.sort((a, b) => b.timestamp - a.timestamp)

    // Apply limit
    if (filter?.limit) {
      filteredEvents = filteredEvents.slice(0, filter.limit)
    }

    return filteredEvents
  }

  /**
   * Get performance profiles
   */
  getPerformanceProfiles(operationName?: string): PerformanceProfile[] {
    let profiles = this.performanceProfiles.filter((p) => p.endTime) // Only completed profiles

    if (operationName) {
      profiles = profiles.filter((p) => p.operationName === operationName)
    }

    return profiles.sort((a, b) => b.startTime - a.startTime)
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(since?: number): DiagnosticMetrics[] {
    let metrics = this.metricsHistory

    if (since) {
      metrics = metrics.filter((m) => m.timestamp >= since)
    }

    return metrics.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Export diagnostic data
   */
  async exportDiagnosticData(): Promise<{
    events: DiagnosticEvent[]
    metrics: DiagnosticMetrics[]
    profiles: PerformanceProfile[]
    systemInfo: any
  }> {
    return {
      events: this.events,
      metrics: this.metricsHistory,
      profiles: this.performanceProfiles,
      systemInfo: {
        sessionId: this.sessionId,
        startTime: this.startTime,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        uptime: Date.now() - this.startTime
      }
    }
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Generate event ID
   */
  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Shutdown diagnostic system
   */
  async shutdown(): Promise<void> {
    console.log('[Diagnostic System] Shutting down diagnostic system')

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }

    // Save final metrics
    await this.saveMetricsToFile()

    // Log shutdown
    await this.logEvent({
      level: 'info',
      category: 'system',
      message: 'Diagnostic system shutdown',
      details: {
        sessionDuration: Date.now() - this.startTime,
        totalEvents: this.events.length,
        totalMetrics: this.metricsHistory.length,
        totalProfiles: this.performanceProfiles.length
      }
    })

    this.isInitialized = false
    console.log('[Diagnostic System] Shutdown completed')
  }
}

/**
 * Get diagnostic system instance
 */
export function getDiagnosticSystem(): DiagnosticSystem {
  return DiagnosticSystem.getInstance()
}

/**
 * Initialize diagnostic system
 */
export async function initializeDiagnosticSystem(): Promise<DiagnosticSystem> {
  const diagnosticSystem = DiagnosticSystem.getInstance()
  await diagnosticSystem.initialize()
  return diagnosticSystem
}
