// newsletter
import type { Auth } from "./auth.js";
import { Post } from "./post.js";
import { User } from "./user.js";
import {
  ArchiveResponseSchema,
  RecommendationSchema,
  type ArchiveResponseItem,
} from "./schemas/newsletter";

class Newsletter {
  private readonly url: string;
  private readonly auth?: Auth;
  private readonly base?: string;

  constructor(url: string, auth?: Auth) {
    this.url = url;
    this.auth = auth;

    const parsed = new URL(url);
    this.base = `${parsed.protocol}//${parsed.hostname}`;
  }

  private async fetch_paginated_posts(
    params: Record<string, string>,
    limit?: number,
    page_size = 25,
  ): Promise<Array<ArchiveResponseItem>> {
    const results = [];
    let offset = 0;
    let more = true;

    while (more) {
      const current = new URLSearchParams({
        ...params,
        offset: offset.toString(),
        limit: page_size.toString(),
      });

      const endpoint = `${this.url}/api/v1/archive?${current}`;
      const response = await this.request(endpoint);
      const items = ArchiveResponseSchema.parse(await response.json());

      if (items?.length === 0) break;

      // handle /home/
      for (const item of items) {
        if (item.canonical_url.includes("substack.com/home/post/")) {
          const slug = item.slug;
          item.canonical_url = `${this.url}/p/${slug}`;
        }
      }
      results.push(...items);
      offset += page_size;

      if (limit && results.length >= limit) {
        return results.slice(0, limit);
      }

      if (items.length < page_size) {
        more = false;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  }

  private async request(endpoint: string): Promise<Response> {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36",
    };

    if (this.auth?.authenticated) {
      return this.auth.get(endpoint, { headers });
    }

    return fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
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

  // implement podcasts?

  async get_recommendations(): Promise<Newsletter[]> {
    const posts = await this.get_posts();
    if (!posts.length) return [];

    const metadata = await posts[0]?.get_metadata();
    const endpoint = `${this.base}/api/v1/recommendations/from/${metadata?.publication_id}`;

    const response = await this.request(endpoint);
    const recommendations = RecommendationSchema.array().parse(
      await response.json(),
    );
    const urls = recommendations.map(rec => {
      const pub = rec.recommendedPublication;
      return pub.custom_domain || `https://${pub.subdomain}.substack.com`;
    });

    return urls.map(url => new Newsletter(url, this.auth));
  }

  async get_authors(): Promise<User[]> {
    const endpoint = `${this.base}/api/v1/publication/users/ranked?public=true`;
    const response = await this.request(endpoint);
    const authors = await response.json() as Array<{ handle: string }>;

    return authors.map((author: { handle: string }) => new User(author.handle));
  }

  get_base_url(): string {
    return this.base ?? "";
  }

  // override
  toString(): string {
    return `Newsletter: ${this.url}`;
  }

}

export { Newsletter };
