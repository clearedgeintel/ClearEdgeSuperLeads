// Resolve a user's input — a Google Maps URL (full or short link) or a bare
// "Business Name, City ST" string — into hints the enrichment provider can use.
//
// The thing the React artifact could NOT do and this MUST: follow
// `maps.app.goo.gl` / `goo.gl/maps` redirects to recover the real `/place/Name`
// URL before research (spec §3, §8).

export interface ResolvedInput {
  /** Best-guess business name to research. */
  nameHint: string;
  /** Location/disambiguation hint (caller hint + parsed coords), if any. */
  locHint?: string;
  /** The resolved Maps URL if the input was a URL, else null. */
  mapsUrl: string | null;
  /** Parsed coordinates, if present in the URL. */
  coords?: { lat: number; lng: number };
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<{ url: string }>;

const SHORT_LINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "app.goo.gl"]);

export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

/** True for Google short links that must be expanded before parsing. */
export function isMapsShortLink(input: string): boolean {
  if (!looksLikeUrl(input)) return false;
  try {
    const u = new URL(input.trim());
    return SHORT_LINK_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Pure parse of a (already-expanded) Google Maps URL. Extracts the `/place/NAME`
 * segment and `@lat,lng` coordinates. Falls back to the `q=` query param.
 */
export function parseMapsUrl(url: string): { nameHint: string; coords?: { lat: number; lng: number } } {
  let nameHint = "";
  let coords: { lat: number; lng: number } | undefined;

  // Coordinates: `@30.2672,-97.7431,15z`
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    coords = { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  }

  try {
    const u = new URL(url);

    // `/maps/place/Joe's+Roofing/@.../` — capture the place segment.
    const placeMatch = u.pathname.match(/\/place\/([^/@]+)/);
    if (placeMatch) {
      nameHint = decodePlaceSegment(placeMatch[1]);
    }

    // Fallback: `?q=Name` or `?q=lat,lng` (ignore the pure-coordinate form).
    if (!nameHint) {
      const q = u.searchParams.get("q");
      if (q && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(q.trim())) {
        nameHint = q.trim();
      }
    }
  } catch {
    // Not a parseable URL — leave nameHint empty; caller decides.
  }

  return { nameHint, coords };
}

function decodePlaceSegment(raw: string): string {
  // Maps encodes spaces as `+`; decode that before percent-decoding.
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).trim();
  } catch {
    return raw.replace(/\+/g, " ").trim();
  }
}

/** Follow redirects on a short link and return the final resolved URL. */
async function expandShortLink(url: string, fetchImpl: FetchImpl): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: controller.signal });
    return res.url || url;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ResolveOptions {
  /** Caller-supplied location hint (e.g. "Austin, TX"). */
  locHint?: string;
  /** Injectable fetch (defaults to global fetch) for testing redirect expansion. */
  fetchImpl?: FetchImpl;
}

/**
 * Resolve raw input into research hints. Expands short links, parses place name
 * and coordinates, and merges any caller location hint with parsed coordinates.
 */
export async function resolveMapsInput(input: string, opts: ResolveOptions = {}): Promise<ResolvedInput> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Please paste a Google Maps link or a business name and city.");
  }

  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);

  // Not a URL: treat the whole thing as the business name hint.
  if (!looksLikeUrl(trimmed)) {
    return {
      nameHint: trimmed,
      locHint: opts.locHint,
      mapsUrl: null,
    };
  }

  let resolvedUrl = trimmed;
  if (isMapsShortLink(trimmed)) {
    resolvedUrl = await expandShortLink(trimmed, fetchImpl);
  }

  const { nameHint, coords } = parseMapsUrl(resolvedUrl);

  if (!nameHint) {
    throw new Error(
      "Could not find a business name in that link. Paste the full Google Maps place URL, or just type the business name and city."
    );
  }

  return {
    nameHint,
    locHint: buildLocHint(opts.locHint, coords),
    mapsUrl: resolvedUrl,
    coords,
  };
}

function buildLocHint(callerHint: string | undefined, coords?: { lat: number; lng: number }): string | undefined {
  const parts: string[] = [];
  if (callerHint && callerHint.trim()) parts.push(callerHint.trim());
  if (coords) parts.push(`coordinates ${coords.lat},${coords.lng}`);
  return parts.length ? parts.join(" — ") : undefined;
}
