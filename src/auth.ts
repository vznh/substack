// auth

type Cookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
}

class Auth {
  private cookies_path: string;
  private cookies: Cookie[] = [];
  private headers: Record<string, string>;
  authenticated: boolean;

  constructor(cookies_path: string) {
    this.cookies_path = cookies_path;
    this.authenticated = false;
    this.cookies = [];
    this.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36",
      "Accept": "application/json",
      "Content-Type": "application/json"
    };
    this.load_cookies();
  }

  private async load_cookies(): Promise<boolean> {
    try {
      const file = Bun.file(this.cookies_path);
      const cookies = await file.json() as Cookie[];
      this.cookies = cookies;
      this.authenticated = true;
      return true;
    } catch {
      this.authenticated = false;
      return false;
    }
  }

  async get(
    url: string,
    options?: RequestInit
  ): Promise<Response> {
    return fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options?.headers,
        Cookie: this.cookies.map(c => `${c.name}=${c.value}`).join("; ")
      }
    })
  }

  async post(
    url: string,
    options?: RequestInit
  ): Promise<Response> {
    return fetch(url, {
      ...options,
      method: "POST",
      headers: {
        ...this.headers,
        ...options?.headers,
        Cookie: this.cookies.map(c => `${c.name} = ${c.value}`).join("; ")
      }
    })
  }
}

export { Auth, type Cookie };
