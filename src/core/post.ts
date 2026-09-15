// posts
import { z } from "zod";
import type { Auth } from "./auth.js";
import { request } from "./http.js";

// Validate the direct post-detail JSON object (no wrapper). Only identity
// fields are strict; all other metadata is optional and unknown fields are
// preserved via passthrough so raw API data is never silently dropped.
const PostSchema = z
  .object({
    id: z.number(),
    slug: z.string(),
    title: z.string(),
    canonical_url: z.string(),
    publication_id: z.number(),
    subtitle: z.string().nullish(),
    body_html: z.string().nullish(),
    publish_date: z.string().nullish(),
    post_date: z.string().nullish(),
    audience: z.string().nullish(),
    type: z.string().nullish(),
    comment_count: z.number().nullish(),
    comments_count: z.number().nullish(),
    podcast_url: z.string().nullish(),
    podcast_upload_id: z.union([z.string(), z.number()]).nullish(),
    podcast_duration: z.number().nullish(),
  })
  .passthrough();

export type PostData = z.infer<typeof PostSchema>;

/**
 * The subset of post data commonly returned by the archive endpoint. Archive
 * records may omit or null out title, so they must not be treated as hydrated
 * PostData until the detail endpoint has been read.
 */
export type PostSummaryData = {
  id: number;
  slug: string;
  title?: string | null;
  canonical_url: string;
  publication_id: number;
  subtitle?: string | null;
  body_html?: string | null;
  audience?: string | null;
  post_date?: string | null;
  [key: string]: unknown;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36";

export class Post {
  private readonly url: string;
  private readonly auth?: Auth;
  private readonly base: string;
  private readonly slug: string;
  private readonly endpoint: string;
  /** Cached data; may be an archive summary (incomplete) or full detail. */
  private post_data: PostData | PostSummaryData | null = null;
  /** True once a full /api/v1/posts/{slug} detail response has been cached. */
  private has_full_data = false;
  /** Shared in-flight request so concurrent readers coalesce into one call. */
  private inFlight: Promise<PostData> | null = null;

  constructor(
    url: string,
    auth?: Auth,
    initialData?: PostData | PostSummaryData
  ) {
    this.url = url;
    this.auth = auth;
    this.post_data = initialData || null;

    // origin preserves an explicit port and drops any path such as /archive?...
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      throw new TypeError(`Post URL must use http or https: ${url}`);
    }
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(`Post URL must use http or https: ${url}`);
    }
    this.base = parsed.origin;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    const rawSlug = parts[parts.length - 1] || "";
    try {
      this.slug = decodeURIComponent(rawSlug);
    } catch (cause) {
      throw new TypeError(`Post URL contains an invalid slug: ${url}`, { cause });
    }

    if (!this.slug) throw new Error(`Couldn't extract slug from ${url}.`);

    this.endpoint = `${this.base}/api/v1/posts/${encodeURIComponent(this.slug)}`;
  }

  toString() {
    return `Post: ${this.url}`;
  }

  private is_cached(require_full: boolean): boolean {
    return this.post_data !== null && (!require_full || this.has_full_data);
  }

  private start_fetch(): Promise<PostData> {
    const p = (async () => {
      const response = await request(
        this.endpoint,
        { headers: { "User-Agent": USER_AGENT } },
        this.auth
      );
      const json = await response.json();
      const data = PostSchema.parse(json);
      this.post_data = data;
      this.has_full_data = true;
      return data;
    })();
    this.inFlight = p;
    const cleanup = () => {
      if (this.inFlight === p) this.inFlight = null;
    };
    p.then(cleanup, cleanup);
    return p;
  }

  /**
   * Fetch (or read from cache) post data.
   * @param forced_refresh ignore and replace any cache
   * @param require_full only accept full detail data; archive summaries
   *   (body_html = null) are hydrated from the post endpoint first
   */
  private fetch_post_data(
    forced_refresh: boolean,
    require_full: true,
  ): Promise<PostData>;
  private fetch_post_data(
    forced_refresh?: boolean,
    require_full?: false,
  ): Promise<PostData | PostSummaryData>;
  private async fetch_post_data(
    forced_refresh = false,
    require_full = false,
  ): Promise<PostData | PostSummaryData> {
    if (!forced_refresh && this.is_cached(require_full)) {
      return this.post_data!;
    }

    // Every caller shares the same request, including force-refresh callers.
    // Returning the rejection is important: a failed request must not turn
    // into an unbounded retry storm for concurrent readers.
    if (this.inFlight) return this.inFlight;

    return this.start_fetch();
  }

  async get_metadata(
    force_refresh = false
  ): Promise<PostData> {
    return this.fetch_post_data(force_refresh, true);
  }

  async get_content(
    force_refresh = false
  ): Promise<string | null> {
    // Content comes from body_html of the post detail endpoint. A null body
    // on an only_paid post without auth usually means paywalled content.
    const data = await this.fetch_post_data(force_refresh, true);
    return data.body_html ?? null;
  }

  async paywalled(): Promise<boolean> {
    return (await this.fetch_post_data()).audience === "only_paid";
  }

  /** Alias matching the historical Python API name. */
  async is_paywalled(): Promise<boolean> {
    return this.paywalled();
  }

  async get_id(): Promise<number> {
    return (await this.fetch_post_data()).id;
  }

  async get_title(): Promise<string> {
    // Archive summaries often contain a usable title. Preserve that cache
    // optimization, but hydrate when it is absent/null because PostData
    // requires a real detail title.
    const cached_title = (await this.fetch_post_data()).title;
    if (typeof cached_title === "string") return cached_title;

    const title = (await this.fetch_post_data(false, true)).title;
    if (typeof title !== "string") {
      throw new Error("Post detail response did not include a title");
    }
    return title;
  }

  async get_subtitle(): Promise<string | null> {
    return (await this.fetch_post_data()).subtitle ?? null;
  }

  async get_post_date(): Promise<string | null | undefined> {
    return (await this.fetch_post_data()).post_date;
  }

  async get_canonical_url(): Promise<string> {
    return (await this.fetch_post_data()).canonical_url;
  }

  async get_publication_id(): Promise<number> {
    return (await this.fetch_post_data()).publication_id;
  }
}
