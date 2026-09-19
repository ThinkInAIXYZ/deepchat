const DEFAULT_MAX_PENDING_SNAPSHOTS = 8
const DEFAULT_MAX_PENDING_SOURCE_BYTES = 120 * 1024 * 1024

export class OcrSourceSnapshotBudget {
  private reservedSnapshots = 0
  private reservedBytes = 0

  constructor(
    private readonly maxSnapshots = DEFAULT_MAX_PENDING_SNAPSHOTS,
    private readonly maxBytes = DEFAULT_MAX_PENDING_SOURCE_BYTES
  ) {
    if (!Number.isSafeInteger(maxSnapshots) || maxSnapshots <= 0) {
      throw new Error('maxSnapshots must be a positive integer')
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error('maxBytes must be a positive integer')
    }
  }

  reserve(byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
      throw new Error('OCR source snapshot byte length must be a positive integer')
    }
    if (
      this.reservedSnapshots >= this.maxSnapshots ||
      this.reservedBytes + byteLength > this.maxBytes
    ) {
      throw new OcrSourceSnapshotBudgetError()
    }
    this.reservedSnapshots += 1
    this.reservedBytes += byteLength
  }

  release(byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) return
    this.reservedSnapshots = Math.max(0, this.reservedSnapshots - 1)
    this.reservedBytes = Math.max(0, this.reservedBytes - byteLength)
  }

  getStatus(): { reservedSnapshots: number; reservedBytes: number } {
    return {
      reservedSnapshots: this.reservedSnapshots,
      reservedBytes: this.reservedBytes
    }
  }
}

export class OcrSourceSnapshotBudgetError extends Error {
  constructor() {
    super('OCR extraction queue has reached its source snapshot limit')
    this.name = 'OcrSourceSnapshotBudgetError'
  }
}
