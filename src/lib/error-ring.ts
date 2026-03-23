/**
 * In-memory ring buffer for tracking recent errors
 * Used by /system/health endpoint to expose recent error history
 */

export interface ErrorEntry {
  timestamp: string
  service: string
  message: string
  statusCode?: number
  method?: string
  url?: string
}

class ErrorRing {
  private buffer: ErrorEntry[] = []
  private maxSize: number

  constructor(maxSize = 5) {
    this.maxSize = maxSize
  }

  /**
   * Add an error to the ring buffer
   * Automatically evicts oldest entry when buffer is full
   */
  add(entry: ErrorEntry): void {
    this.buffer.push(entry)
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift()
    }
  }

  /**
   * Get all recent errors (newest first)
   */
  getRecent(): ErrorEntry[] {
    return [...this.buffer].reverse()
  }

  /**
   * Clear all errors
   */
  clear(): void {
    this.buffer = []
  }

  /**
   * Get current buffer size
   */
  size(): number {
    return this.buffer.length
  }
}

// Singleton instance
export const errorRing = new ErrorRing(5)
