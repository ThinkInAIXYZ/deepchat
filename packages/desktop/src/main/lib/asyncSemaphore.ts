export class AsyncSemaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Semaphore capacity must be a positive integer')
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  get activeCount(): number {
    return this.active
  }

  get pendingCount(): number {
    return this.waiters.length
  }

  private acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.active -= 1
    const next = this.waiters.shift()
    if (next) next()
  }
}
