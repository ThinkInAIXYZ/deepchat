export class SearchHistory {
  private history: string[] = []
  private currentIndex: number = -1
  maxHistorySize: number = 100 // Limit the size of the history
  constructor(maxHistorySize = 100) {
    // Initialize with some default values if needed
    this.history = []
    this.currentIndex = 0
    this.maxHistorySize = maxHistorySize // Set a maximum size for the history
  }

  addSearch(query: string) {
    if (query && query !== this.history[this.history.length - 1]) {
      if (this.history.length >= this.maxHistorySize) {
        this.history.shift() // Remove the oldest search
      }
      this.history.push(query)
      this.currentIndex = this.history.length // Reset index to the end
    }
  }

  getPrevious() {
    if (this.currentIndex > 0) {
      this.currentIndex--
      return this.history[this.currentIndex]
    }
    return null
  }

  getNext() {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++
      return this.history[this.currentIndex]
    }
    return null
  }
  // 将 currentIndex 重置为 history 的长度
  resetIndex() {
    this.currentIndex = this.history.length
  }
  clearHistory() {
    this.history.length = 0 // Clear the history array
    this.currentIndex = -1 // Reset index when clearing history
    console.log('Search history cleared')
  }

  insertAtCurrent(query: string) {
    if (!query || query.trim() === '') return

    const trimmedQuery = query.trim()

    // 如果当前索引在历史记录末尾，直接添加
    if (this.currentIndex >= this.history.length) {
      this.addSearch(trimmedQuery)
      return
    }

    // 检查是否与当前位置的内容相同，避免重复
    if (this.history[this.currentIndex] === trimmedQuery) {
      return
    }

    // 检查是否与最后一条记录相同，避免重复
    if (this.history[this.history.length - 1] === trimmedQuery) {
      return
    }

    // 如果 history 已经满了，移除最旧的记录
    if (this.history.length >= this.maxHistorySize) {
      this.history.shift()
      this.currentIndex = Math.max(0, this.currentIndex - 1)
    }

    // 在当前索引位置插入新内容
    this.history.splice(this.currentIndex, 0, trimmedQuery)
    this.currentIndex = this.history.length // 重置索引到末尾

    console.log('Search history inserted at current position:', this.history)
  }
}

export const searchHistory = new SearchHistory(100) // Create a new instance with a maximum size of 100
