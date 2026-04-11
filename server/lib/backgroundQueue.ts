/**
 * Simple in-memory queue with concurrency limit.
 * Used to throttle background AI/enrichment tasks so we don't
 * overwhelm rate limits or memory when 20+ leads come in at once.
 */
export class BackgroundQueue {
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private concurrency = 3) {}

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    this.tryRunNext();
  }

  private tryRunNext(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running++;

      task()
        .catch(err => console.error('[Queue] Task failed:', err))
        .finally(() => {
          this.running--;
          this.tryRunNext();
        });
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }
}

// Single shared queue for AI analysis tasks. 2 concurrent keeps us
// well under Anthropic's rate limits and avoids memory pressure.
export const aiQueue = new BackgroundQueue(2);
