// ---------------------------------------------------------------------------
// YouTube API client (channel analytics, Phase 3). Every outbound YouTube call
// the sync engine makes goes through fetchYoutubeJson so route tests can stub
// global.fetch with canned payloads (see routes/channel-analytics.test.ts).
//
// The OAuth token lifecycle (exchange / refresh / revoke) stays in
// channels/oauth.ts; this module only consumes an already-fresh access token.
// ---------------------------------------------------------------------------

export const YOUTUBE_API_ROOT = "https://www.googleapis.com";

/** Raised when Google returns a non-2xx — carries the status + raw body so the
 *  sync engine can degrade to stored partials + an ERROR state instead of 500s. */
export class YoutubeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "YoutubeApiError";
  }
}

/**
 * GET a YouTube Data API (`youtube/v3/…`) or Analytics API
 * (`youtubeAnalytics/v2/…`) endpoint with a Bearer access token.
 */
export async function fetchYoutubeJson<T>(
  path: string,
  accessToken: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const separator = path.includes("?") ? "&" : "?";
  const url = `${YOUTUBE_API_ROOT}/${path}${query.size > 0 ? separator + query.toString() : ""}`;

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON error body — keep null
    }
    throw new YoutubeApiError(`YouTube API ${response.status} for ${path}`, response.status, body);
  }
  return (await response.json()) as T;
}

/** The `{ columnHeaders, rows }` shape every Analytics API report returns. */
export interface YoutubeReportPayload {
  columnHeaders?: Array<{ name: string; columnType?: string; dataType?: string }>;
  rows?: Array<Array<string | number | null>>;
}

/**
 * Normalize an Analytics API report into an array of row objects keyed by
 * column name (nulls kept) — the shape stored in tandem_analytics_reports.
 */
export function normalizeReportRows(payload: YoutubeReportPayload): Array<Record<string, string | number | null>> {
  const headers = (payload.columnHeaders ?? []).map((h) => h.name);
  return (payload.rows ?? []).map((row) => {
    const entry: Record<string, string | number | null> = {};
    headers.forEach((name, index) => {
      entry[name] = row[index] ?? null;
    });
    return entry;
  });
}