// Small LRU for rendered site HTML. Keys include the site's updated_at, so an
// edit naturally misses the cache; stale entries age out by recency.

export class HtmlCache {
  private map = new Map<string, string>();

  constructor(private max = 500) {}

  static key(siteId: string, updatedAt: string, variant: string): string {
    return `${siteId}|${updatedAt}|${variant}`;
  }

  get(key: string): string | undefined {
    const html = this.map.get(key);
    if (html !== undefined) {
      // Refresh recency.
      this.map.delete(key);
      this.map.set(key, html);
    }
    return html;
  }

  set(key: string, html: string): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, html);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
