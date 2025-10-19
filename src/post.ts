// posts
import { z } from "zod";
import { Auth } from "./auth";

const PostSchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  body_html: z.string().nullable(),
  publish_date: z.string().optional(),
  post_date: z.string().nullable().optional(),
  audience: z.enum(["everyone", "only_paid"]).optional(),
  comments_count: z.number().optional(),
  comment_count: z.number().optional(),
  canonical_url: z.string(),
  publication_id: z.number()
});

const ResponseSchema = z.object({
  type: z.literal("post"),
  post: PostSchema
});

export type PostData = z.infer<typeof PostSchema>;

export class Post {
  private readonly url: string;
  private readonly auth?: Auth;
  private readonly base: string;
  private readonly slug: string;
  private readonly endpoint: string;
  private post_data: PostData | null = null;

  constructor(
    url: string,
    auth?: Auth,
    initialData?: PostData
  ) {
    this.url = url;
    this.auth = auth;
    this.post_data = initialData || null;

    const parsed = new URL(url);
    this.base = `${parsed.protocol}//${parsed.hostname}`;
    const parts = parsed.pathname.replace(/^\//, "").split("/");
    this.slug = parts[parts.length - 1] || "";

    if (!this.slug) throw new Error(`Couldn't extract slug from ${url}.`);

    this.endpoint = `${this.base}/api/v1/posts/${this.slug}`;
  }

  private async fetch_post_data(
    forced_refresh: boolean = false
  ): Promise<PostData> {
    if (this.post_data && !forced_refresh) {
      return this.post_data;
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
    };
    let response: Response;

    if (this.auth?.authenticated) {
      response = await this.auth.get(this.endpoint, { headers });
    } else {
      response = await fetch(this.endpoint, {
        headers,
        signal: AbortSignal.timeout(30000)
      });
    }

    if (!response.ok) throw new Error(`HTTP error encountered; status is ${response.status}.`);

    const json = await response.json();
    const validated = ResponseSchema.parse(json);
    this.post_data = validated.post;

    return this.post_data;
  }

  async get_metadata(
    force_refresh = false
  ): Promise<PostData> {
    return this.fetch_post_data(force_refresh);
  }

  async get_content(
    force_refresh = false
  ): Promise<string | null> {
    const data = await this.fetch_post_data(force_refresh);
    const content = data.body_html;

    if (
      !content &&
      !this.auth &&
      data.audience === "only_paid"
    ) {
      console.warn("This post is paywalled. Provide authentication to access full content.");
    }

    return content;
  }

  toString() {
    return `Post: ${this.url}`;
  }

  async paywalled(): Promise<boolean> {
    return (await this.fetch_post_data()).audience === "only_paid";
  }

  async get_id(): Promise<number> {
    return (await this.fetch_post_data()).id;
  }

  async get_title(): Promise<string> {
    return (await this.fetch_post_data()).title;
  }

  async get_subtitle(): Promise<string | null> {
    return (await this.fetch_post_data()).subtitle;
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
