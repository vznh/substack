import type { Auth } from "./auth.js";
import { request } from "./http.js";
import { Post } from "./post.js";
import { User } from "./user.js";
import {
  ArchiveResponseSchema,
  AuthorsSchema,
  RecommendationSchema,
  type ArchiveResponseItem,
} from "../schemas/newsletter.js";

// Bounds make incomplete upstream pagination explicit instead of truncating.
const MAX_ARCHIVE_PAGES = 1000;
// The upstream type=podcast filter is not honored, so scan archive metadata.
const PODCAST_SCAN_PAGES = 40;
const PAGE_DELAY_MS = 500;

class Newsletter {
  private readonly auth?: Auth;
  private readonly base: string;

  constructor(url: string, auth?: Auth) {
    // Tolerate bare hostnames ("venh.substack.com") as well as full URLs and
    // URLs carrying paths such as "/archive?sort=new"; all normalize to the
    // origin (preserving any explicit port).
    const value = url.trim();
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) {
      throw new TypeError(`Newsletter URL must use http or https: ${url}`);
    }
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(normalized);
    this.base = parsed.origin;
    this.auth = auth;
  }

  private async request(endpoint: string): Promise<Response> {
    return request(endpoint, {}, this.auth);
  }

  private async fetch_paginated_posts(
    params: Record<string, string>,
    limit?: number,
    page_size = 25,
    options?: {
      filter?: (item: ArchiveResponseItem) => boolean;
      max_pages?: number;
    },
  ): Promise<Array<ArchiveResponseItem>> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new RangeError("limit must be a nonnegative integer");
    }
    if (limit === 0) return [];

    const filter = options?.filter;
    const max_pages = options?.max_pages ?? MAX_ARCHIVE_PAGES;
    const results: ArchiveResponseItem[] = [];
    const seen = new Set<number>();
    let offset = 0;

    for (let page = 0; page < max_pages; page++) {
      // A short page is not proof of exhaustion; continue until an empty page,
      // the requested limit, or the explicit bound.
      const requested =
        filter
          ? page_size
          : limit === undefined
            ? page_size
            : Math.min(page_size, limit - results.length);

      const query = new URLSearchParams({
        ...params,
        offset: offset.toString(),
        limit: requested.toString(),
      });
      const endpoint = `${this.base}/api/v1/archive?${query}`;
      const response = await this.request(endpoint);
      const items = ArchiveResponseSchema.parse(await response.json());

      if (items.length === 0) return results; // true end of archive

      let new_items = 0;
      let reached_limit = false;
      for (const item of items) {
        if (seen.has(item.id)) continue; // dedupe repeats
        seen.add(item.id);
        new_items++;
        // Rewrite /home/post/ URLs (e.g. cross-pinned posts) to this origin.
        if (item.canonical_url.includes("substack.com/home/post/")) {
          item.canonical_url = `${this.base}/p/${item.slug}`;
        }
        if (!filter || filter(item)) {
          results.push(item);
          if (limit !== undefined && results.length >= limit) {
            reached_limit = true;
            break;
          }
        }
      }

      if (reached_limit) return results.slice(0, limit);
      offset += requested;

      if (new_items === 0) {
        // Nonempty page with no progress: server is repeating itself.
        throw new Error(
          `Archive pagination made no progress at offset ${offset} (repeated items); aborting to avoid duplicates or silent truncation.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }

    throw new Error(
      `Archive pagination hit the ${max_pages}-page bound at offset ${offset} with ${results.length}${limit === undefined ? "" : `/${limit}`} results; aborting instead of returning silently truncated results.`,
    );
  }

  async get_posts(sorting = "new", limit?: number): Promise<Post[]> {
    return (await this.fetch_paginated_posts({ sort: sorting }, limit)).map(
      (item) => new Post(item.canonical_url, this.auth, item),
    );
  }

  async search_posts(query: string, limit?: number): Promise<Post[]> {
    return (
      await this.fetch_paginated_posts({ sort: "new", search: query }, limit)
    ).map((item) => new Post(item.canonical_url, this.auth, item));
  }

  /**
   * Get podcast episodes from the newsletter.
   *
   * The server's `type=podcast` query is not honored (verified live: it
   * returns ordinary newsletter posts with null audio fields), so episodes
   * are found by scanning archive pages and filtering client-side on actual
   * podcast media fields (podcast_url / podcast_upload_id). `limit` is
   * applied AFTER filtering. The scan is bounded; if the bound is reached
   * before the archive ends, an explicit error names the bound.
   */
  async get_podcasts(limit?: number): Promise<Post[]> {
    const is_podcast = (item: ArchiveResponseItem): boolean =>
      (typeof item.podcast_url === "string" && item.podcast_url.length > 0) ||
      item.podcast_upload_id != null;

    return (
      await this.fetch_paginated_posts(
        { sort: "new" },
        limit,
        25,
        { filter: is_podcast, max_pages: PODCAST_SCAN_PAGES },
      )
    ).map((item) => new Post(item.canonical_url, this.auth, item));
  }

  async get_recommendations(): Promise<Newsletter[]> {
    // One archive post is enough to resolve the publication id; the archive
    // summary already carries publication_id, so no detail request is needed.
    const posts = await this.get_posts("new", 1);
    if (!posts.length) return [];

    const publication_id = await posts[0].get_publication_id();
    const endpoint = `${this.base}/api/v1/recommendations/from/${publication_id}`;

    const response = await this.request(endpoint);
    const recommendations = RecommendationSchema.array().parse(
      await response.json(),
    );
    const urls = recommendations.map((rec) => {
      const pub = rec.recommendedPublication;
      // Custom domains arrive bare; they must become usable https URLs.
      return normalizePublicationUrl(pub.custom_domain ?? pub.subdomain + ".substack.com");
    });

    return urls.map((url) => new Newsletter(url, this.auth));
  }

  async get_authors(): Promise<User[]> {
    const endpoint = `${this.base}/api/v1/publication/users/ranked?public=true`;
    const response = await this.request(endpoint);
    const authors = AuthorsSchema.parse(await response.json());

    return authors.map((author) => new User(author.handle, true, this.auth));
  }

  get_base_url(): string {
    return this.base;
  }

  toString(): string {
    return `Newsletter: ${this.base}`;
  }
}

function normalizePublicationUrl(domain: string): string {
  const value = domain.trim();
  if (!value) throw new TypeError("Recommendation publication has an empty domain");
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) {
    throw new TypeError(`Recommendation publication has an unsupported URL: ${domain}`);
  }
  const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`Recommendation publication has an unsupported URL: ${domain}`);
  }
  return `https://${parsed.host}`;
}

export { Newsletter };
