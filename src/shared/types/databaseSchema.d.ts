export type DatabaseSchemaIssueKind =
  | 'missing_table'
  | 'missing_column'
  | 'missing_index'
  | 'column_type_mismatch'

export interface DatabaseSchemaIssue {
  kind: DatabaseSchemaIssueKind
  table: string
  name: string
  repairable: boolean
  message: string
  expectedType?: string | null
  actualType?: string | null
}

export interface DatabaseSchemaDiagnosis {
  checkedAt: number
  isHealthy: boolean
  issues: DatabaseSchemaIssue[]
  repairableIssues: DatabaseSchemaIssue[]
  manualIssues: DatabaseSchemaIssue[]
}

export type DatabaseRepairStatus = 'healthy' | 'repaired' | 'manual-action-required'

export interface DatabaseRepairReport {
  startedAt: number
  finishedAt: number
  status: DatabaseRepairStatus
  backupPath: string | null
  diagnosisBeforeRepair: DatabaseSchemaDiagnosis
  diagnosisAfterRepair: DatabaseSchemaDiagnosis
  repairedIssues: DatabaseSchemaIssue[]
  remainingIssues: DatabaseSchemaIssue[]
}

export interface DatabaseRepairSuggestedPayload {
  title: string
  message: string
  reason: string
  dedupeKey: string
}
