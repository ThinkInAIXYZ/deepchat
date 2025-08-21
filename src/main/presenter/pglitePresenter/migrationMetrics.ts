/**
 * Migration Success Metrics and Reporting System
 * Implements requirements 8.4, 11.4 for migration success metrics and reporting
 * Provides comprehensive metrics collection, analysis, and reporting for migration operations
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { getDiagnosticSystem } from './diagnosticSystem'

export interface MigrationMetrics {
  migrationId: string
  sessionId: string
  startTime: number
  endTime?: number
  duration?: number
  status: 'started' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

  // Data metrics
  sourceData: {
    sqliteRecords: number
    duckdbRecords: number
    totalFiles: number
    totalSize: number
    databaseVersions: Record<string, number>
  }

  // Migration progress metrics
  progress: {
    phase: string
    percentage: number
    recordsProcessed: number
    recordsPerSecond: number
    estimatedTimeRemaining: number
    currentOperation: string
  }

  // Performance metrics
  performance: {
    memoryUsage: {
      peak: number
      average: number
      current: number
    }
    diskIO: {
      bytesRead: number
      bytesWritten: number
      operationsCount: number
    }
    queryPerformance: {
      totalQueries: number
      averageQueryTime: number
      slowestQuery: number
      fastestQuery: number
    }
  }

  // Error and warning metrics
  issues: {
    errors: MigrationError[]
    warnings: MigrationWarning[]
    recoveryActions: RecoveryActionMetric[]
    criticalIssues: number
  }

  // Success metrics
  success: {
    dataIntegrityScore: number
    migrationCompleteness: number
    performanceScore: number
    userSatisfactionScore?: number
  }

  // System metrics
  system: {
    platform: string
    architecture: string
    nodeVersion: string
    electronVersion: string
    availableMemory: number
    availableDiskSpace: number
  }

  // User interaction metrics
  userInteraction: {
    userPrompts: number
    userDecisions: UserDecision[]
    manualInterventions: number
    cancellationAttempts: number
  }
}

export interface MigrationError {
  id: string
  timestamp: number
  type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  phase: string
  resolved: boolean
  resolutionTime?: number
  resolutionMethod?: string
}

export interface MigrationWarning {
  id: string
  timestamp: number
  type: string
  message: string
  phase: string
  acknowledged: boolean
}

export interface RecoveryActionMetric {
  id: string
  timestamp: number
  errorId: string
  actionType: string
  success: boolean
  duration: number
  automated: boolean
}

export interface UserDecision {
  id: string
  timestamp: number
  prompt: string
  decision: string
  responseTime: number
}

export interface MigrationReport {
  summary: {
    migrationId: string
    status: string
    duration: number
    successRate: number
    dataIntegrityScore: number
    performanceScore: number
    overallScore: number
  }

  dataTransfer: {
    recordsMigrated: number
    filesProcessed: number
    dataIntegrityChecks: number
    validationFailures: number
    recoveredErrors: number
  }

  performance: {
    averageSpeed: number
    peakMemoryUsage: number
    diskSpaceUsed: number
    queryPerformance: string
    bottlenecks: string[]
  }

  issues: {
    totalErrors: number
    criticalErrors: number
    resolvedErrors: number
    unresolvedErrors: number
    warnings: number
    recommendations: string[]
  }

  timeline: {
    phases: PhaseMetric[]
    milestones: Milestone[]
    criticalEvents: CriticalEvent[]
  }

  recommendations: {
    immediate: string[]
    future: string[]
    systemOptimizations: string[]
  }
}

export interface PhaseMetric {
  name: string
  startTime: number
  endTime: number
  duration: number
  recordsProcessed: number
  success: boolean
  errors: number
  warnings: number
}

export interface Milestone {
  name: string
  timestamp: number
  description: string
  significance: 'low' | 'medium' | 'high'
}

export interface CriticalEvent {
  timestamp: number
  type: 'error' | 'warning' | 'recovery' | 'user_intervention'
  description: string
  impact: 'low' | 'medium' | 'high' | 'critical'
  resolution?: string
}

/**
 * Migration Metrics Collector
 * Collects and analyzes migration metrics throughout the process
 */
export class MigrationMetricsCollector {
  private metrics: MigrationMetrics
  private diagnosticSystem = getDiagnosticSystem()
  private metricsFilePath: string = ''
  private reportFilePath: string = ''

  constructor(migrationId: string, sessionId: string) {
    this.metrics = this.initializeMetrics(migrationId, sessionId)
    this.setupMetricsFiles()
  }

  /**
   * Initialize metrics structure
   */
  private initializeMetrics(migrationId: string, sessionId: string): MigrationMetrics {
    return {
      migrationId,
      sessionId,
      startTime: Date.now(),
      status: 'started',

      sourceData: {
        sqliteRecords: 0,
        duckdbRecords: 0,
        totalFiles: 0,
        totalSize: 0,
        databaseVersions: {}
      },

      progress: {
        phase: 'initialization',
        percentage: 0,
        recordsProcessed: 0,
        recordsPerSecond: 0,
        estimatedTimeRemaining: 0,
        currentOperation: 'Starting migration'
      },

      performance: {
        memoryUsage: {
          peak: 0,
          average: 0,
          current: process.memoryUsage().heapUsed
        },
        diskIO: {
          bytesRead: 0,
          bytesWritten: 0,
          operationsCount: 0
        },
        queryPerformance: {
          totalQueries: 0,
          averageQueryTime: 0,
          slowestQuery: 0,
          fastestQuery: Number.MAX_SAFE_INTEGER
        }
      },

      issues: {
        errors: [],
        warnings: [],
        recoveryActions: [],
        criticalIssues: 0
      },

      success: {
        dataIntegrityScore: 0,
        migrationCompleteness: 0,
        performanceScore: 0
      },

      system: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron || 'unknown',
        availableMemory: 0,
        availableDiskSpace: 0
      },

      userInteraction: {
        userPrompts: 0,
        userDecisions: [],
        manualInterventions: 0,
        cancellationAttempts: 0
      }
    }
  }

  /**
   * Setup metrics files
   */
  private setupMetricsFiles(): void {
    const appDataDir = app.getPath('userData')
    const metricsDir = path.join(appDataDir, 'migration_metrics')

    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.metricsFilePath = path.join(metricsDir, `migration-metrics-${timestamp}.json`)
    this.reportFilePath = path.join(metricsDir, `migration-report-${timestamp}.md`)
  }

  /**
   * Update source data metrics
   */
  updateSourceData(data: Partial<MigrationMetrics['sourceData']>): void {
    Object.assign(this.metrics.sourceData, data)
    this.saveMetrics()
  }

  /**
   * Update migration progress
   */
  updateProgress(progress: Partial<MigrationMetrics['progress']>): void {
    Object.assign(this.metrics.progress, progress)
    this.metrics.status = 'in_progress'
    this.saveMetrics()

    // Log progress to diagnostic system
    this.diagnosticSystem.updateMigrationStatus(
      progress.phase || this.metrics.progress.phase,
      progress.percentage || this.metrics.progress.percentage,
      progress.recordsProcessed || this.metrics.progress.recordsProcessed
    )
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(): void {
    const currentMemory = process.memoryUsage().heapUsed

    // Update memory metrics
    this.metrics.performance.memoryUsage.current = currentMemory
    this.metrics.performance.memoryUsage.peak = Math.max(
      this.metrics.performance.memoryUsage.peak,
      currentMemory
    )

    // Calculate average memory usage
    const samples = this.metrics.performance.memoryUsage.average || currentMemory
    this.metrics.performance.memoryUsage.average = (samples + currentMemory) / 2

    this.saveMetrics()
  }

  /**
   * Record query performance
   */
  recordQueryPerformance(queryTime: number): void {
    const perf = this.metrics.performance.queryPerformance

    perf.totalQueries++
    perf.averageQueryTime =
      (perf.averageQueryTime * (perf.totalQueries - 1) + queryTime) / perf.totalQueries
    perf.slowestQuery = Math.max(perf.slowestQuery, queryTime)
    perf.fastestQuery = Math.min(perf.fastestQuery, queryTime)

    this.saveMetrics()
  }

  /**
   * Record disk I/O operation
   */
  recordDiskIO(bytesRead: number, bytesWritten: number): void {
    this.metrics.performance.diskIO.bytesRead += bytesRead
    this.metrics.performance.diskIO.bytesWritten += bytesWritten
    this.metrics.performance.diskIO.operationsCount++

    this.saveMetrics()
  }

  /**
   * Record migration error
   */
  recordError(error: Omit<MigrationError, 'id' | 'timestamp'>): void {
    const migrationError: MigrationError = {
      id: this.generateId(),
      timestamp: Date.now(),
      ...error
    }

    this.metrics.issues.errors.push(migrationError)

    if (error.severity === 'critical') {
      this.metrics.issues.criticalIssues++
    }

    this.saveMetrics()

    // Log to diagnostic system
    this.diagnosticSystem.logEvent({
      level: error.severity === 'critical' ? 'critical' : 'error',
      category: 'migration',
      message: error.message,
      details: { errorId: migrationError.id, phase: error.phase }
    })
  }

  /**
   * Record migration warning
   */
  recordWarning(warning: Omit<MigrationWarning, 'id' | 'timestamp'>): void {
    const migrationWarning: MigrationWarning = {
      id: this.generateId(),
      timestamp: Date.now(),
      ...warning
    }

    this.metrics.issues.warnings.push(migrationWarning)
    this.saveMetrics()

    // Log to diagnostic system
    this.diagnosticSystem.logEvent({
      level: 'warn',
      category: 'migration',
      message: warning.message,
      details: { warningId: migrationWarning.id, phase: warning.phase }
    })
  }

  /**
   * Record recovery action
   */
  recordRecoveryAction(action: Omit<RecoveryActionMetric, 'id' | 'timestamp'>): void {
    const recoveryAction: RecoveryActionMetric = {
      id: this.generateId(),
      timestamp: Date.now(),
      ...action
    }

    this.metrics.issues.recoveryActions.push(recoveryAction)
    this.saveMetrics()

    // Log to diagnostic system
    this.diagnosticSystem.logEvent({
      level: action.success ? 'info' : 'warn',
      category: 'migration',
      message: `Recovery action ${action.actionType} ${action.success ? 'succeeded' : 'failed'}`,
      details: { actionId: recoveryAction.id, errorId: action.errorId }
    })
  }

  /**
   * Record user decision
   */
  recordUserDecision(decision: Omit<UserDecision, 'id' | 'timestamp'>): void {
    const userDecision: UserDecision = {
      id: this.generateId(),
      timestamp: Date.now(),
      ...decision
    }

    this.metrics.userInteraction.userDecisions.push(userDecision)
    this.metrics.userInteraction.userPrompts++

    this.saveMetrics()
  }

  /**
   * Record manual intervention
   */
  recordManualIntervention(): void {
    this.metrics.userInteraction.manualInterventions++
    this.saveMetrics()
  }

  /**
   * Record cancellation attempt
   */
  recordCancellationAttempt(): void {
    this.metrics.userInteraction.cancellationAttempts++
    this.saveMetrics()
  }

  /**
   * Mark error as resolved
   */
  resolveError(errorId: string, resolutionMethod: string): void {
    const error = this.metrics.issues.errors.find((e) => e.id === errorId)
    if (error) {
      error.resolved = true
      error.resolutionTime = Date.now()
      error.resolutionMethod = resolutionMethod
      this.saveMetrics()
    }
  }

  /**
   * Acknowledge warning
   */
  acknowledgeWarning(warningId: string): void {
    const warning = this.metrics.issues.warnings.find((w) => w.id === warningId)
    if (warning) {
      warning.acknowledged = true
      this.saveMetrics()
    }
  }

  /**
   * Complete migration and calculate final scores
   */
  completeMigration(status: 'completed' | 'failed' | 'cancelled'): void {
    this.metrics.status = status
    this.metrics.endTime = Date.now()
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime

    // Calculate success scores
    this.calculateSuccessScores()

    this.saveMetrics()

    // Log completion to diagnostic system
    this.diagnosticSystem.logEvent({
      level: status === 'completed' ? 'info' : 'error',
      category: 'migration',
      message: `Migration ${status}`,
      details: {
        migrationId: this.metrics.migrationId,
        duration: this.metrics.duration,
        recordsProcessed: this.metrics.progress.recordsProcessed
      }
    })
  }

  /**
   * Calculate success scores based on metrics
   */
  private calculateSuccessScores(): void {
    // Data integrity score (0-100)
    const totalErrors = this.metrics.issues.errors.length
    const resolvedErrors = this.metrics.issues.errors.filter((e) => e.resolved).length
    const criticalErrors = this.metrics.issues.criticalIssues

    let dataIntegrityScore = 100
    dataIntegrityScore -= (totalErrors - resolvedErrors) * 5 // -5 points per unresolved error
    dataIntegrityScore -= criticalErrors * 20 // -20 points per critical error
    this.metrics.success.dataIntegrityScore = Math.max(0, dataIntegrityScore)

    // Migration completeness score (0-100)
    const targetRecords =
      this.metrics.sourceData.sqliteRecords + this.metrics.sourceData.duckdbRecords
    const processedRecords = this.metrics.progress.recordsProcessed
    this.metrics.success.migrationCompleteness =
      targetRecords > 0 ? Math.min(100, (processedRecords / targetRecords) * 100) : 100

    // Performance score (0-100)
    let performanceScore = 100
    const avgQueryTime = this.metrics.performance.queryPerformance.averageQueryTime
    if (avgQueryTime > 1000) performanceScore -= 20 // Slow queries
    if (avgQueryTime > 5000) performanceScore -= 30 // Very slow queries

    const peakMemoryMB = this.metrics.performance.memoryUsage.peak / (1024 * 1024)
    if (peakMemoryMB > 500) performanceScore -= 10 // High memory usage
    if (peakMemoryMB > 1000) performanceScore -= 20 // Very high memory usage

    this.metrics.success.performanceScore = Math.max(0, performanceScore)
  }

  /**
   * Generate comprehensive migration report
   */
  generateReport(): MigrationReport {
    const duration = this.metrics.duration || Date.now() - this.metrics.startTime
    const totalErrors = this.metrics.issues.errors.length
    const resolvedErrors = this.metrics.issues.errors.filter((e) => e.resolved).length

    const report: MigrationReport = {
      summary: {
        migrationId: this.metrics.migrationId,
        status: this.metrics.status,
        duration,
        successRate: totalErrors > 0 ? (resolvedErrors / totalErrors) * 100 : 100,
        dataIntegrityScore: this.metrics.success.dataIntegrityScore,
        performanceScore: this.metrics.success.performanceScore,
        overallScore:
          (this.metrics.success.dataIntegrityScore +
            this.metrics.success.migrationCompleteness +
            this.metrics.success.performanceScore) /
          3
      },

      dataTransfer: {
        recordsMigrated: this.metrics.progress.recordsProcessed,
        filesProcessed: this.metrics.sourceData.totalFiles,
        dataIntegrityChecks: this.metrics.performance.queryPerformance.totalQueries,
        validationFailures: this.metrics.issues.errors.filter((e) => e.type === 'validation')
          .length,
        recoveredErrors: resolvedErrors
      },

      performance: {
        averageSpeed: this.metrics.progress.recordsPerSecond,
        peakMemoryUsage: this.metrics.performance.memoryUsage.peak,
        diskSpaceUsed: this.metrics.performance.diskIO.bytesWritten,
        queryPerformance: this.formatQueryPerformance(),
        bottlenecks: this.identifyBottlenecks()
      },

      issues: {
        totalErrors,
        criticalErrors: this.metrics.issues.criticalIssues,
        resolvedErrors,
        unresolvedErrors: totalErrors - resolvedErrors,
        warnings: this.metrics.issues.warnings.length,
        recommendations: this.generateRecommendations()
      },

      timeline: {
        phases: this.generatePhaseMetrics(),
        milestones: this.generateMilestones(),
        criticalEvents: this.generateCriticalEvents()
      },

      recommendations: {
        immediate: this.generateImmediateRecommendations(),
        future: this.generateFutureRecommendations(),
        systemOptimizations: this.generateSystemOptimizations()
      }
    }

    return report
  }

  /**
   * Format query performance summary
   */
  private formatQueryPerformance(): string {
    const perf = this.metrics.performance.queryPerformance
    if (perf.totalQueries === 0) return 'No queries recorded'

    return (
      `Avg: ${perf.averageQueryTime.toFixed(0)}ms, ` +
      `Fastest: ${perf.fastestQuery.toFixed(0)}ms, ` +
      `Slowest: ${perf.slowestQuery.toFixed(0)}ms, ` +
      `Total: ${perf.totalQueries}`
    )
  }

  /**
   * Identify performance bottlenecks
   */
  private identifyBottlenecks(): string[] {
    const bottlenecks: string[] = []

    if (this.metrics.performance.queryPerformance.averageQueryTime > 1000) {
      bottlenecks.push('Slow database queries')
    }

    if (this.metrics.performance.memoryUsage.peak > 500 * 1024 * 1024) {
      bottlenecks.push('High memory usage')
    }

    if (this.metrics.progress.recordsPerSecond < 100) {
      bottlenecks.push('Slow data processing')
    }

    if (this.metrics.issues.criticalIssues > 0) {
      bottlenecks.push('Critical errors causing delays')
    }

    return bottlenecks
  }

  /**
   * Generate recommendations based on metrics
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = []

    if (this.metrics.issues.criticalIssues > 0) {
      recommendations.push('Address critical errors before next migration')
    }

    if (this.metrics.performance.queryPerformance.averageQueryTime > 1000) {
      recommendations.push('Optimize database queries for better performance')
    }

    if (this.metrics.performance.memoryUsage.peak > 500 * 1024 * 1024) {
      recommendations.push('Consider increasing available memory')
    }

    if (this.metrics.userInteraction.manualInterventions > 3) {
      recommendations.push('Automate manual intervention steps')
    }

    return recommendations
  }

  /**
   * Generate phase metrics
   */
  private generatePhaseMetrics(): PhaseMetric[] {
    // This would be populated during actual migration phases
    // For now, return a basic structure
    return [
      {
        name: 'Detection',
        startTime: this.metrics.startTime,
        endTime: this.metrics.startTime + 30000,
        duration: 30000,
        recordsProcessed: 0,
        success: true,
        errors: 0,
        warnings: 0
      }
    ]
  }

  /**
   * Generate milestones
   */
  private generateMilestones(): Milestone[] {
    const milestones: Milestone[] = [
      {
        name: 'Migration Started',
        timestamp: this.metrics.startTime,
        description: 'Migration process initiated',
        significance: 'high'
      }
    ]

    if (this.metrics.endTime) {
      milestones.push({
        name: 'Migration Completed',
        timestamp: this.metrics.endTime,
        description: `Migration ${this.metrics.status}`,
        significance: 'high'
      })
    }

    return milestones
  }

  /**
   * Generate critical events
   */
  private generateCriticalEvents(): CriticalEvent[] {
    const events: CriticalEvent[] = []

    // Add critical errors as events
    for (const error of this.metrics.issues.errors.filter((e) => e.severity === 'critical')) {
      events.push({
        timestamp: error.timestamp,
        type: 'error',
        description: error.message,
        impact: 'critical',
        resolution: error.resolved ? error.resolutionMethod : undefined
      })
    }

    // Add manual interventions as events
    if (this.metrics.userInteraction.manualInterventions > 0) {
      events.push({
        timestamp: Date.now(),
        type: 'user_intervention',
        description: `${this.metrics.userInteraction.manualInterventions} manual interventions required`,
        impact: 'medium'
      })
    }

    return events.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Generate immediate recommendations
   */
  private generateImmediateRecommendations(): string[] {
    const recommendations: string[] = []

    const unresolvedErrors = this.metrics.issues.errors.filter((e) => !e.resolved)
    if (unresolvedErrors.length > 0) {
      recommendations.push(`Resolve ${unresolvedErrors.length} unresolved errors`)
    }

    if (this.metrics.success.dataIntegrityScore < 90) {
      recommendations.push('Verify data integrity before proceeding')
    }

    return recommendations
  }

  /**
   * Generate future recommendations
   */
  private generateFutureRecommendations(): string[] {
    const recommendations: string[] = []

    if (this.metrics.performance.queryPerformance.averageQueryTime > 500) {
      recommendations.push('Consider database indexing improvements')
    }

    if (this.metrics.userInteraction.userPrompts > 5) {
      recommendations.push('Implement more automated decision making')
    }

    return recommendations
  }

  /**
   * Generate system optimization recommendations
   */
  private generateSystemOptimizations(): string[] {
    const optimizations: string[] = []

    if (this.metrics.performance.memoryUsage.peak > 1024 * 1024 * 1024) {
      optimizations.push('Increase system memory allocation')
    }

    if (this.metrics.progress.recordsPerSecond < 50) {
      optimizations.push('Optimize disk I/O performance')
    }

    return optimizations
  }

  /**
   * Save metrics to file
   */
  private saveMetrics(): void {
    try {
      const metricsData = JSON.stringify(this.metrics, null, 2)
      fs.writeFileSync(this.metricsFilePath, metricsData)
    } catch (error) {
      console.error('[Migration Metrics] Failed to save metrics:', error)
    }
  }

  /**
   * Save report to markdown file
   */
  async saveReport(): Promise<void> {
    try {
      const report = this.generateReport()
      const markdown = this.generateMarkdownReport(report)
      fs.writeFileSync(this.reportFilePath, markdown)

      console.log(`[Migration Metrics] Report saved to: ${this.reportFilePath}`)
    } catch (error) {
      console.error('[Migration Metrics] Failed to save report:', error)
    }
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(report: MigrationReport): string {
    const markdown = [
      '# Migration Report',
      `Generated: ${new Date().toISOString()}`,
      `Migration ID: ${report.summary.migrationId}`,
      '',
      '## Summary',
      `- **Status**: ${report.summary.status}`,
      `- **Duration**: ${(report.summary.duration / 1000).toFixed(2)} seconds`,
      `- **Success Rate**: ${report.summary.successRate.toFixed(1)}%`,
      `- **Data Integrity Score**: ${report.summary.dataIntegrityScore.toFixed(1)}/100`,
      `- **Performance Score**: ${report.summary.performanceScore.toFixed(1)}/100`,
      `- **Overall Score**: ${report.summary.overallScore.toFixed(1)}/100`,
      '',
      '## Data Transfer',
      `- **Records Migrated**: ${report.dataTransfer.recordsMigrated.toLocaleString()}`,
      `- **Files Processed**: ${report.dataTransfer.filesProcessed.toLocaleString()}`,
      `- **Data Integrity Checks**: ${report.dataTransfer.dataIntegrityChecks.toLocaleString()}`,
      `- **Validation Failures**: ${report.dataTransfer.validationFailures}`,
      `- **Recovered Errors**: ${report.dataTransfer.recoveredErrors}`,
      '',
      '## Performance',
      `- **Average Speed**: ${report.performance.averageSpeed.toFixed(1)} records/second`,
      `- **Peak Memory Usage**: ${(report.performance.peakMemoryUsage / 1024 / 1024).toFixed(2)} MB`,
      `- **Disk Space Used**: ${(report.performance.diskSpaceUsed / 1024 / 1024).toFixed(2)} MB`,
      `- **Query Performance**: ${report.performance.queryPerformance}`,
      '',
      '### Performance Bottlenecks',
      report.performance.bottlenecks.length > 0
        ? report.performance.bottlenecks.map((b) => `- ${b}`).join('\n')
        : '- None identified',
      '',
      '## Issues',
      `- **Total Errors**: ${report.issues.totalErrors}`,
      `- **Critical Errors**: ${report.issues.criticalErrors}`,
      `- **Resolved Errors**: ${report.issues.resolvedErrors}`,
      `- **Unresolved Errors**: ${report.issues.unresolvedErrors}`,
      `- **Warnings**: ${report.issues.warnings}`,
      '',
      '### Recommendations',
      report.issues.recommendations.length > 0
        ? report.issues.recommendations.map((r) => `- ${r}`).join('\n')
        : '- None',
      '',
      '## Timeline',
      '### Critical Events',
      report.timeline.criticalEvents.length > 0
        ? report.timeline.criticalEvents
            .map(
              (e) =>
                `- **${new Date(e.timestamp).toISOString()}**: ${e.description} (${e.impact} impact)`
            )
            .join('\n')
        : '- None',
      '',
      '## Recommendations',
      '',
      '### Immediate Actions',
      report.recommendations.immediate.length > 0
        ? report.recommendations.immediate.map((r) => `- ${r}`).join('\n')
        : '- None',
      '',
      '### Future Improvements',
      report.recommendations.future.length > 0
        ? report.recommendations.future.map((r) => `- ${r}`).join('\n')
        : '- None',
      '',
      '### System Optimizations',
      report.recommendations.systemOptimizations.length > 0
        ? report.recommendations.systemOptimizations.map((r) => `- ${r}`).join('\n')
        : '- None',
      ''
    ].join('\n')

    return markdown
  }

  /**
   * Get current metrics
   */
  getMetrics(): MigrationMetrics {
    return { ...this.metrics }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

/**
 * Migration Success Analyzer
 * Analyzes migration metrics and provides insights
 */
export class MigrationSuccessAnalyzer {
  /**
   * Analyze migration success based on metrics
   */
  static analyzeSuccess(metrics: MigrationMetrics): {
    overallSuccess: boolean
    successScore: number
    criticalIssues: string[]
    recommendations: string[]
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
  } {
    const scores = metrics.success
    const issues = metrics.issues

    // Calculate overall success score
    const overallScore =
      (scores.dataIntegrityScore + scores.migrationCompleteness + scores.performanceScore) / 3

    // Determine success threshold
    const overallSuccess = overallScore >= 80 && issues.criticalIssues === 0

    // Identify critical issues
    const criticalIssues: string[] = []
    if (scores.dataIntegrityScore < 90) {
      criticalIssues.push('Data integrity concerns detected')
    }
    if (scores.migrationCompleteness < 95) {
      criticalIssues.push('Incomplete migration detected')
    }
    if (issues.criticalIssues > 0) {
      criticalIssues.push(`${issues.criticalIssues} critical errors occurred`)
    }

    // Generate recommendations
    const recommendations: string[] = []
    if (scores.performanceScore < 70) {
      recommendations.push('Performance optimization needed')
    }
    if (issues.errors.filter((e) => !e.resolved).length > 0) {
      recommendations.push('Resolve remaining errors')
    }
    if (metrics.userInteraction.manualInterventions > 2) {
      recommendations.push('Consider automation improvements')
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low'
    if (issues.criticalIssues > 0) {
      riskLevel = 'critical'
    } else if (scores.dataIntegrityScore < 80) {
      riskLevel = 'high'
    } else if (scores.dataIntegrityScore < 90 || scores.performanceScore < 70) {
      riskLevel = 'medium'
    }

    return {
      overallSuccess,
      successScore: overallScore,
      criticalIssues,
      recommendations,
      riskLevel
    }
  }

  /**
   * Compare migration metrics with historical data
   */
  static compareWithHistorical(
    current: MigrationMetrics,
    historical: MigrationMetrics[]
  ): {
    performanceTrend: 'improving' | 'stable' | 'declining'
    reliabilityTrend: 'improving' | 'stable' | 'declining'
    recommendations: string[]
  } {
    if (historical.length === 0) {
      return {
        performanceTrend: 'stable',
        reliabilityTrend: 'stable',
        recommendations: ['No historical data available for comparison']
      }
    }

    // Calculate averages from historical data
    const avgPerformanceScore =
      historical.reduce((sum, m) => sum + m.success.performanceScore, 0) / historical.length
    const avgDataIntegrityScore =
      historical.reduce((sum, m) => sum + m.success.dataIntegrityScore, 0) / historical.length
    const avgCriticalIssues =
      historical.reduce((sum, m) => sum + m.issues.criticalIssues, 0) / historical.length

    // Determine trends
    const performanceTrend =
      current.success.performanceScore > avgPerformanceScore + 5
        ? 'improving'
        : current.success.performanceScore < avgPerformanceScore - 5
          ? 'declining'
          : 'stable'

    const reliabilityTrend =
      current.success.dataIntegrityScore > avgDataIntegrityScore + 5 &&
      current.issues.criticalIssues < avgCriticalIssues
        ? 'improving'
        : current.success.dataIntegrityScore < avgDataIntegrityScore - 5 ||
            current.issues.criticalIssues > avgCriticalIssues
          ? 'declining'
          : 'stable'

    // Generate trend-based recommendations
    const recommendations: string[] = []
    if (performanceTrend === 'declining') {
      recommendations.push('Performance has declined compared to historical average')
    }
    if (reliabilityTrend === 'declining') {
      recommendations.push('Reliability has decreased compared to previous migrations')
    }
    if (performanceTrend === 'improving' && reliabilityTrend === 'improving') {
      recommendations.push('Migration system is showing consistent improvement')
    }

    return {
      performanceTrend,
      reliabilityTrend,
      recommendations
    }
  }
}
