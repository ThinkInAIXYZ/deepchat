export class ConcurrencyLimiter {
  private activeCount = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly limit: number = 10) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.limit) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve)
      })
    }

    this.activeCount += 1
    try {
      return await task()
    } finally {
      this.activeCount -= 1
      const next = this.queue.shift()
      if (next) {
        next()
      }
    }
  }
}
