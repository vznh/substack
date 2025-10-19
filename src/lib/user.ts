// user
import { z } from "zod";

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  profile_set_up_at: z.string(),
  subscriptions: z.array(
    z.object({
      membership_state: z.string(),
      publication: z.object({
        id: z.string(),
        name: z.string(),
        subdomain: z.string(),
        custom_domain: z.string().nullable(),
      }),
    }),
  ),
});

class User {
  private readonly username: string;
  private readonly original: string;
  private endpoint: string;
  private data: any = null;
  private redirected = false;

  constructor(username: string) {
    this.username = username;
    this.original = username;
    this.endpoint = `https://substack.com/api/v1/user/${username}/public_profile`;
  }

  toString(): string {
    return `User: ${this.username}`;
  }

  private async fetch() {
    if (this.data) return this.data;

    try {
      const res = await fetch(this.endpoint, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      this.data = UserSchema.parse(await res.json());
      return this.data;
    } catch {
      throw new Error(`Failed to fetch user: ${this.username}`);
    }
  }

  async get_id(): Promise<number> {
    return (await this.fetch()).id;
  }

  async get_name(): Promise<string> {
    return (await this.fetch()).name;
  }

  async get_subscriptions() {
    const data = await this.fetch();
    return data.subscriptions.map((sub: any) => ({
      id: sub.publication.id,
      name: sub.publication.name,
      domain:
        sub.publication.custom_domain ||
        `${sub.publication.subdomain}.substack.com`,
      state: sub.membership_state,
    }));
  }
}

export { User }
