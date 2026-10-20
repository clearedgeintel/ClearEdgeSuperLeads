// Fetch helper for /api/sites. Unlike apiRequest it keeps the error body, so
// callers can show publish-validation errors and field details.

export class SitesApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: string[] = []
  ) {
    super(message);
  }
}

export async function sitesRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : {},
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let json: { message?: string; error?: string; errors?: string[]; details?: string[] } = {};
    try {
      json = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new SitesApiError(
      json.message || json.error || `Request failed (${res.status})`,
      res.status,
      json.errors ?? json.details ?? []
    );
  }
  return res.json() as Promise<T>;
}

export interface SitesConfig {
  publicBaseUrl: string | null;
  photoUploadsEnabled: boolean;
}

export function publicSiteHref(config: SitesConfig | undefined, slug: string): string | null {
  return config?.publicBaseUrl ? `${config.publicBaseUrl}/s/${encodeURIComponent(slug)}` : null;
}

/** Fired by other tabs (e.g. the lead modal) to open a site in the Sites tab. */
export const OPEN_SITE_EVENT = 'clearedge:open-site';
export type OpenSiteDetail = { slug: string };
