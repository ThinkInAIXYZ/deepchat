import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'

export interface DimProviderGrant {
  nativeProviderId: string
  providerId: string
  modelId: string
  reference: string
  connectionFingerprint: string
}

/** Non-secret authorization for the native credential-reference callback. */
export class DimProviderGrantsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'dim_provider_grants')
  }
  getCreateTableSQL(): string {
    return `CREATE TABLE IF NOT EXISTS dim_provider_grants (
      native_provider_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
      reference TEXT NOT NULL, connection_fingerprint TEXT NOT NULL
    );`
  }
  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }
  get(nativeProviderId: string): DimProviderGrant | null {
    const row = this.db
      .prepare(`SELECT native_provider_id AS nativeProviderId, provider_id AS providerId, model_id AS modelId,
      reference, connection_fingerprint AS connectionFingerprint FROM dim_provider_grants WHERE native_provider_id = ?`)
      .get(nativeProviderId)
    return (row as DimProviderGrant | undefined) ?? null
  }
  put(grant: DimProviderGrant): void {
    const previous = this.get(grant.nativeProviderId)
    if (
      previous &&
      (previous.providerId !== grant.providerId ||
        previous.modelId !== grant.modelId ||
        previous.reference !== grant.reference ||
        previous.connectionFingerprint !== grant.connectionFingerprint)
    )
      throw new Error('Native provider grant cannot be repointed')
    this.db
      .prepare(`INSERT OR IGNORE INTO dim_provider_grants
      (native_provider_id, provider_id, model_id, reference, connection_fingerprint) VALUES (?, ?, ?, ?, ?)`)
      .run(
        grant.nativeProviderId,
        grant.providerId,
        grant.modelId,
        grant.reference,
        grant.connectionFingerprint
      )
  }
}
