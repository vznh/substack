// user
import { z } from "zod";
import type { Auth } from "./auth.js";
import { request, HttpError } from "./http.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36";

// Identity fields are essential and strict; everything else is optional raw
// data preserved via passthrough. Accessors for name/id never depend on
// unrelated optional fields such as subscriptions.
const UserIdentitySchema = z
  .object({
    id: z.number(),
    name: z.string(),
  })
  .passthrough();

const SubscriptionSchema = z
  .object({
    membership_state: z.string(),
    publication: z
      .object({
        id: z.number(),
        name: z.string(),
        subdomain: z.string(),
        custom_domain: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type UserData = z.infer<typeof UserIdentitySchema>;

/**
 * Resolve a potentially renamed handle by following the public profile
 * redirect. Bounded to the https://substack.com/@{handle} path; the final
 * URL origin is checked so a redirect is only accepted on substack.com.
 */
async function resolve_handle_redirect(
  old_handle: string,
  auth?: Auth
): Promise<string | null> {
  try {
    const response = await request(
      `https://substack.com/@${encodeURIComponent(old_handle)}`,
      { redirect: "follow", headers: { "User-Agent": USER_AGENT } },
      auth
    );
    const final_url = new URL(response.url);
    if (final_url.origin !== "https://substack.com") return null;
    const first_segment = final_url.pathname.split("/").filter(Boolean)[0];
    if (!first_segment || !first_segment.startsWith("@")) return null;
    const new_handle = decodeURIComponent(first_segment.slice(1));
    return new_handle && new_handle !== old_handle ? new_handle : null;
  } catch {
    // No redirect resolvable (deleted account, network failure, ...).
    return null;
  }
}

class User {
  private username: string;
  private readonly original: string;
  private readonly follow_redirects: boolean;
  private readonly auth?: Auth;
  private endpoint: string;
  private data: UserData | null = null;
  private redirect_attempted = false;
  private inFlight: Promise<UserData> | null = null;

  constructor(
    username: string,
    follow_redirects_or_auth: boolean | Auth = true,
    auth?: Auth,
  ) {
    // Tolerate handles passed with a leading '@'.
    this.username = username.startsWith("@") ? username.slice(1) : username;
    if (!this.username) throw new TypeError("User handle must not be empty");
    this.original = this.username;
    this.follow_redirects =
      typeof follow_redirects_or_auth === "boolean" ? follow_redirects_or_auth : true;
    this.auth =
      typeof follow_redirects_or_auth === "boolean"
        ? auth
        : follow_redirects_or_auth;
    this.endpoint = this.profile_endpoint(this.username);
  }

  private profile_endpoint(handle: string): string {
    return `https://substack.com/api/v1/user/${encodeURIComponent(handle)}/public_profile`;
  }

  toString(): string {
    return `User: ${this.username}`;
  }

  private is_cached(): boolean {
    return this.data !== null;
  }

  private async do_fetch(): Promise<UserData> {
    const response = await request(
      this.endpoint,
      { headers: { "User-Agent": USER_AGENT } },
      this.auth
    );
    const json = await response.json();
    const data = UserIdentitySchema.parse(json);
    this.data = data;
    return data;
  }

  private async fetch(force_refresh = false): Promise<UserData> {
    if (!force_refresh && this.is_cached()) return this.data!;

    // Return the same promise, including its rejection, to every concurrent
    // reader. Retrying after a shared failure hides the original cause and
    // duplicates requests.
    if (this.inFlight) return this.inFlight;

    const p = (async () => {
      try {
        return await this.do_fetch();
      } catch (cause) {
        // Renamed-handle recovery: a 404 may mean the handle changed.
        if (
          cause instanceof HttpError &&
          cause.status === 404 &&
          this.follow_redirects &&
          !this.redirect_attempted
        ) {
          this.redirect_attempted = true;
          const new_handle = await resolve_handle_redirect(this.username, this.auth);
          if (new_handle) {
            this.username = new_handle;
            this.endpoint = this.profile_endpoint(new_handle);
            return await this.do_fetch();
          }
        }
        // Preserve the original cause instead of replacing it with a
        // generic message.
        if (cause instanceof HttpError) throw cause;
        throw new Error(`Failed to fetch user: ${this.username}`, { cause });
      }
    })();
    this.inFlight = p;
    const cleanup = () => {
      if (this.inFlight === p) this.inFlight = null;
    };
    p.then(cleanup, cleanup);
    return p;
  }

  /** Full raw profile data (all API fields), cached like the typed accessors. */
  async get_raw_data(force_refresh = false): Promise<Record<string, unknown>> {
    return (await this.fetch(force_refresh)) as unknown as Record<string, unknown>;
  }

  async get_id(): Promise<number> {
    return (await this.fetch()).id;
  }

  async get_name(): Promise<string> {
    return (await this.fetch()).name;
  }

  get_username(): string {
    return this.username;
  }

  /** True when the original handle was redirected to a new one. */
  was_redirected(): boolean {
    return this.username !== this.original;
  }

  async get_profile_set_up_at(): Promise<string | null> {
    const data = await this.fetch();
    const value = (data as Record<string, unknown>)["profile_set_up_at"];
    return typeof value === "string" ? value : null;
  }

  async get_subscriptions(): Promise<
    Array<{
      id: number;
      publication_id: number;
      name: string;
      publication_name: string;
      domain: string;
      state: string;
      membership_state: string;
    }>
  > {
    const data = (await this.fetch()) as Record<string, unknown>;
    const raw = data["subscriptions"];
    if (raw === undefined || raw === null) return [];

    const parsed = z.array(SubscriptionSchema).safeParse(raw);
    if (!parsed.success) {
      throw new Error("User subscriptions have unexpected shape", {
        cause: parsed.error,
      });
    }

    return parsed.data.map((sub) => ({
      id: sub.publication.id,
      publication_id: sub.publication.id,
      name: sub.publication.name,
      publication_name: sub.publication.name,
      domain:
        sub.publication.custom_domain ||
        `${sub.publication.subdomain}.substack.com`,
      state: sub.membership_state,
      membership_state: sub.membership_state,
    }));
  }
}

export { User };
