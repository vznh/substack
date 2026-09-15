// category
import type { Auth } from "./auth.js";
import { request } from "./http.js";
import { Newsletter } from "./newsletter.js";
import {
  CategoryResponseSchema,
  CategorySchema,
  type CategoryResponseItem,
} from "../schemas/category.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36";

// Safety bound. Reaching it while the server still reports `more: true`
// raises an explicit error instead of silently truncating results.
const MAX_CATEGORY_PAGES = 100;
const PAGE_DELAY_MS = 500;

/**
 * Get name / id representations of all newsletter categories.
 */
async function fetch_all_categories(auth?: Auth): Promise<
  Array<{ name: string; id: number | string }>
> {
  const endpoint = "https://substack.com/api/v1/categories";
  const response = await request(endpoint, {
    headers: { "User-Agent": USER_AGENT },
  }, auth);
  const categories = CategorySchema.array().parse(await response.json());
  // Keep original ID format (numeric on the wire).
  return categories.map((cat) => ({ name: cat.name, id: cat.id }));
}

class Category {
  private name?: string;
  private id?: number | string;
  private newsletters_data: CategoryResponseItem[] | null = null;
  private dataPromise: Promise<CategoryResponseItem[]> | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly auth?: Auth;

  constructor(name?: string, id?: number | string, auth?: Auth) {
    if (name === undefined && id === undefined) {
      throw new Error("Either name or id must be provided");
    }
    this.name = name;
    this.id = id;
    this.auth = auth;
  }

  toString(): string {
    return `${this.name} (${this.id})`;
  }

  /**
   * Resolve the missing name/id counterpart. Constructors cannot await, so
   * lookups are lazy and shared; every public operation awaits this first.
   * A failed lookup clears the promise so a later call can retry.
   */
  private initialize(): Promise<void> {
    if (this.id !== undefined && this.name !== undefined) {
      return Promise.resolve();
    }
    if (!this.initPromise) {
      const p = (async () => {
        if (this.id === undefined) await this._get_id_from_name();
        else if (this.name === undefined) await this._get_name_from_id();
      })();
      this.initPromise = p;
      this.initPromise.catch(() => {
        if (this.initPromise === p) this.initPromise = null;
      });
    }
    const p = this.initPromise;
    return p;
  }

  /** Awaitable readiness; resolves once name/id lookups have completed. */
  async ready(): Promise<this> {
    await this.initialize();
    return this;
  }

  /** Async factory: constructs the category and awaits its initialization. */
  static async create(
    name?: string,
    id?: number | string,
    auth?: Auth,
  ): Promise<Category> {
    return new Category(name, id, auth).ready();
  }

  private async _get_id_from_name(): Promise<void> {
    const categories = await fetch_all_categories(this.auth);
    for (const cat of categories) {
      if (cat.name === this.name) {
        this.id = cat.id;
        return;
      }
    }
    throw new Error(`Category name '${this.name}' not found`);
  }

  private async _get_name_from_id(): Promise<void> {
    const categories = await fetch_all_categories(this.auth);
    // Lookup keys may arrive as string or number; compare normalized.
    for (const cat of categories) {
      if (String(cat.id) === String(this.id)) {
        this.name = cat.name;
        return;
      }
    }
    throw new Error(`Category ID ${this.id} not found`);
  }

  private async fetch_newsletters_data(
    force_refresh = false
  ): Promise<CategoryResponseItem[]> {
    if (this.newsletters_data && !force_refresh) return this.newsletters_data;
    // Refreshes also join an active request. Otherwise an older request can
    // finish after refresh and overwrite the fresh cache with stale data.
    if (this.dataPromise) return this.dataPromise;

    const p = (async () => {
      await this.initialize();

      const endpoint = `https://substack.com/api/v1/category/public/${encodeURIComponent(String(this.id))}/all?page=`;
      const all_newsletters: CategoryResponseItem[] = [];
      const seen = new Set<number>();
      let page_number = 0;

      while (true) {
        if (page_number >= MAX_CATEGORY_PAGES) {
          throw new Error(
            `Category pagination hit the ${MAX_CATEGORY_PAGES}-page bound at page ${page_number} while the server still reported more results; aborting instead of returning silently truncated results.`,
          );
        }

        const response = await request(`${endpoint}${page_number}`, {
          headers: { "User-Agent": USER_AGENT },
        }, this.auth);
        const data = CategoryResponseSchema.parse(await response.json());
        for (const pub of data.publications) {
          if (seen.has(pub.id)) continue;
          seen.add(pub.id);
          all_newsletters.push(pub);
        }
        page_number++;

        if (!data.more) break; // server-declared completion

        await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
      }

      this.newsletters_data = all_newsletters;
      return all_newsletters;
    })();
    this.dataPromise = p;
    const cleanup = () => {
      if (this.dataPromise === p) this.dataPromise = null;
    };
    p.then(cleanup, cleanup);
    return p;
  }

  async get_newsletter_urls(): Promise<string[]> {
    return (await this.fetch_newsletters_data()).map((item) => item.base_url);
  }

  async get_newsletters(): Promise<Newsletter[]> {
    return (await this.get_newsletter_urls()).map((url) => new Newsletter(url, this.auth));
  }

  async get_newsletter_metadata(): Promise<CategoryResponseItem[]> {
    return this.fetch_newsletters_data();
  }

  async refresh_data(): Promise<void> {
    await this.fetch_newsletters_data(true);
  }

  /** Sync accessors: undefined until initialization has completed. */
  get_name(): string | undefined {
    return this.name;
  }

  get_id(): string | number | undefined {
    return this.id;
  }
}

export { Category, fetch_all_categories };
