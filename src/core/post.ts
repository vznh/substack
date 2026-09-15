import { z } from "zod";
import type { Auth } from "./auth.js";
import { request } from "./http.js";
import { ArchiveResponseSchema } from "../schemas/newsletter.js";

// The detail endpoint returns a direct object. Keep unknown fields so callers
// can access metadata the SDK does not model yet.
const PostSchema = ArchiveResponseSchema.element.extend({ title: z.string() });

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

export class Post {
  private readonly url: string;
  private readonly auth?: Auth;
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
    this.post_data = initialData ?? null;

    // origin preserves an explicit port and drops any path such as /archive?...
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      throw new TypeError(`Post URL must use http or https: ${url}`);
    }
    const parsed = new URL(value);
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    const rawSlug = parts[parts.length - 1] || "";
    let slug: string;
    try {
      slug = decodeURIComponent(rawSlug);
    } catch (cause) {
      throw new TypeError(`Post URL contains an invalid slug: ${url}`, { cause });
    }

    if (!slug) throw new Error(`Couldn't extract slug from ${url}.`);

    this.endpoint = `${parsed.origin}/api/v1/posts/${encodeURIComponent(slug)}`;
  }

  toString() {
    return `Post: ${this.url}`;
  }

  private start_fetch(): Promise<PostData> {
    const p = (async () => {
      const response = await request(this.endpoint, {}, this.auth);
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

  /** Read cached data or hydrate an archive summary from the detail endpoint. */
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
    if (!forced_refresh && this.post_data !== null && (!require_full || this.has_full_data)) {
      return this.post_data;
    }

    // Share concurrent reads, including force-refresh calls.
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
    // Archive titles are usable when present; otherwise hydrate the detail.
    const cached_title = (await this.fetch_post_data()).title;
    if (typeof cached_title === "string") return cached_title;

    return (await this.fetch_post_data(false, true)).title;
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
