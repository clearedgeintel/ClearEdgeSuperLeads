// Public URLs for sites. Sites are served by the public site server (Phase 3);
// until the cutover, PUBLIC_SITE_BASE_URL can point at the old Instant Site
// host, which renders the same rows from the shared database.

export function publicSiteBaseUrl(): string | null {
  const base = (process.env.PUBLIC_SITE_BASE_URL || '').trim().replace(/\/+$/, '');
  return base || null;
}

export function publicSiteUrl(slug: string): string {
  const base = publicSiteBaseUrl();
  if (!base) throw new Error('PUBLIC_SITE_BASE_URL is not set.');
  return `${base}/s/${encodeURIComponent(slug)}`;
}
