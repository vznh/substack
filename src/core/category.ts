// category
import { Newsletter } from "./newsletter.js";
import {
  CategoryResponseSchema,
  type CategoryResponseItem,
  CategorySchema
} from "../schemas/category.js";


async function fetch_all_categories(): Promise<Array<{name: string, id: number | string}>> {
  const endpoint = "https://substack.com/api/v1/categories";
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) throw new Error(`Failed to fetch categories: ${response.status}`);

  const categories = CategorySchema.array().parse(await response.json());
  // Keep original ID format (string or number)
  return categories.map(cat => ({
    name: cat.name,
    id: cat.id
  }));
}

class Category {
  private name?: string;
  private id?: number | string;
  private newsletters_data: CategoryResponseItem[] | null = null;

  constructor(name?: string, id?: number | string) {
    if (!name && !id) {
      throw new Error("Either name or id must be provided");
    }

    this.name = name;
    this.id = id;

    if (this.name && !this.id) {
      this._get_id_from_name();
    } else if (this.id && !this.name) {
      this._get_name_from_id();
    }
  }

  toString(): string {
    return `${this.name} (${this.id})`;
  }

  private async _get_id_from_name(): Promise<void> {
    const categories = await fetch_all_categories();
    for (const cat of categories) {
      if (cat.name === this.name) {
        this.id = cat.id;
        return;
      }
    }
    throw new Error(`Category name '${this.name}' not found`);
  }

  private async _get_name_from_id(): Promise<void> {
    const categories = await fetch_all_categories();
    for (const cat of categories) {
      if (cat.id === this.id) {
        this.name = cat.name;
        return;
      }
    }
    throw new Error(`Category ID ${this.id} not found`);
  }

  private async fetch_newsletters_data(force_refresh = false): Promise<CategoryResponseItem[]> {
    if (
      this.newsletters_data &&
      !force_refresh
    ) {
      return this.newsletters_data;
    }

    const endpoint = `https://substack.com/api/v1/category/public/${this.id}/all?page=`;
    const all_newsletters = [];
    let page_number = 0;
    let more = true;

    while (more && page_number <= 20) {
      const response = await fetch(`${endpoint}${page_number}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
        },
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) throw new Error(`Failed to fetch newsletters: ${response.status}`);

      const data = CategoryResponseSchema.parse(await response.json());
      all_newsletters.push(...data.publications);
      page_number++;
      more = data.more;

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.newsletters_data = all_newsletters;
    return all_newsletters;
  }

  async get_newsletter_urls(): Promise<string[]> {
    return (await this.fetch_newsletters_data()).map(item => item.base_url);
  }

  async get_newsletters(): Promise<Newsletter[]> {
    return (await this.get_newsletter_urls()).map(url => new Newsletter(url));
  }

  async get_newsletter_metadata(): Promise<CategoryResponseItem[]> {
    return this.fetch_newsletters_data();
  }

  async refresh_data(): Promise<void> {
    await this.fetch_newsletters_data(true);
  }

  get_name(): string | undefined {
    return this.name;
  }

  get_id(): string | number | undefined {
    return this.id;
  }
}

export { Category, fetch_all_categories };
