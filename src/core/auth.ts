/**
 * Cookie-file authentication for Node and Bun.
 *
 * `authenticated` means that the local cookie export was loaded into the
 * jar. It does not verify a server session or entitlement. All operations
 * await `ready()` before making a request.
 */
import { readFile } from "node:fs/promises";
import { Cookie as JarCookie, CookieJar } from "tough-cookie";
import makeFetchCookie from "fetch-cookie";
import { request, type FetchLike, type RequestOptions } from "./http.js";
import { AuthError } from "./errors.js";

/** A cookie in a common browser-export JSON format. */
export type Cookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  hostOnly?: boolean;
  expires?: number | string;
  expirationDate?: number;
  session?: boolean;
  sameSite?: "none" | "lax" | "strict" | "no_restriction" | "unspecified";
};

export interface AuthOptions {
  /** Base fetch used by the cookie-aware wrapper. */
  fetch?: FetchLike;
  /** Hostname or HTTP(S) origin for cookies with no domain. */
  defaultDomain?: string;
}

const COOKIE_NAME = /^[^\u0000-\u001f\u007f\s();,=]+$/;
// RFC 6265 cookie-octet: no controls, whitespace, quotes, comma, semicolon,
// or backslash. Object-based Cookie construction otherwise skips this check.
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
const INVALID_DOMAIN_CHARS = /[\u0000-\u0020\u007f\/@?#:]/;
const INVALID_PATH_CHARS = /[\u0000-\u001f\u007f;]/;

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(index: number, detail: string, path: string): never {
  throw new AuthError(`invalid cookie at index ${index}: ${detail} (${path})`, { path });
}

function normalizeDomain(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty hostname`);
  }

  let candidate = value.trim().toLowerCase();
  if (candidate.startsWith(".")) candidate = candidate.slice(1);

  if (candidate.includes("://")) {
    const authority = candidate.slice(candidate.indexOf("://") + 3).split(/[/?#]/, 1)[0];
    if (authority.includes("@") || authority.includes(":")) {
      throw new TypeError(`${label} must not include credentials or a port`);
    }
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new TypeError(`${label} must be a valid hostname or HTTP(S) origin`);
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.port || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new TypeError(`${label} must not include credentials, a port, a path or query`);
    }
    candidate = parsed.hostname.toLowerCase();
  }

  if (candidate === "" || candidate.endsWith(".") || INVALID_DOMAIN_CHARS.test(candidate)) {
    throw new TypeError(`${label} must be a valid hostname`);
  }
  try {
    const parsed = new URL(`https://${candidate}`);
    if (parsed.hostname !== candidate || parsed.pathname !== "/") throw new Error("invalid hostname");
  } catch {
    throw new TypeError(`${label} must be a valid hostname`);
  }
  return candidate;
}

function sameSiteOf(value: unknown, index: number, path: string): "none" | "lax" | "strict" | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(index, "sameSite must be a string", path);
  switch (value.toLowerCase()) {
    case "none":
    case "no_restriction":
    case "no-restriction":
      return "none";
    case "lax":
      return "lax";
    case "strict":
      return "strict";
    case "unspecified":
      return undefined;
    default:
      fail(index, "sameSite has an unsupported value", path);
  }
}

function expiryDate(value: unknown, index: number, path: string): Date | "Infinity" | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(index, "expiry must be finite", path);
    // Chrome/Selenium use -1 for a session cookie. Zero is an expired cookie.
    if (value === -1) return "Infinity";
    if (value <= 0) return null;
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime())) fail(index, "expiry is outside the supported date range", path);
    return date;
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) fail(index, "expiry is not a valid date", path);
    return new Date(timestamp);
  }
  fail(index, "expiry must be a number or date string", path);
}

export class Auth {
  /** True after local cookie loading succeeds; not server authentication. */
  authenticated = false;
  /** The live jar, including cookies received in responses and redirects. */
  readonly jar: CookieJar;
  /** Internal cookie-aware fetch used by the shared transport. */
  readonly cookieFetch: FetchLike;

  private readonly cookiesPath: string;
  private readonly defaultDomain: string;
  private initPromise: Promise<void> | null = null;

  constructor(cookiesPath: string, options: AuthOptions = {}) {
    if (typeof cookiesPath !== "string" || cookiesPath.trim() === "") {
      throw new TypeError("cookie file path must be a non-empty string");
    }
    this.cookiesPath = cookiesPath;
    this.defaultDomain = normalizeDomain(options.defaultDomain ?? "substack.com", "defaultDomain");
    this.jar = new CookieJar();

    // Keep globalThis.fetch dynamic so a test/runtime can install fetch after
    // constructing Auth. An injected fetch remains stable by design.
    const baseFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url as Parameters<typeof globalThis.fetch>[0], init));
    this.cookieFetch = makeFetchCookie(baseFetch, this.jar) as unknown as FetchLike;
  }

  /** Construct and fully initialize an Auth instance. */
  static async create(cookiesPath: string, options: AuthOptions = {}): Promise<Auth> {
    const auth = new Auth(cookiesPath, options);
    await auth.ready();
    return auth;
  }

  /** Await the one shared initialization attempt. */
  ready(): Promise<void> {
    if (this.initPromise === null) this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const entries = await this.readCookieFile();
    await this.importCookies(entries);
    this.authenticated = true;
  }

  private async readCookieFile(): Promise<unknown[]> {
    let text: string;
    try {
      text = await readFile(this.cookiesPath, "utf8");
    } catch (cause) {
      throw new AuthError(`failed to read cookie file: ${this.cookiesPath}`, { path: this.cookiesPath, cause });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AuthError(`cookie file is not valid JSON: ${this.cookiesPath}`, { path: this.cookiesPath });
    }
    if (Array.isArray(parsed)) return parsed;
    if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { cookies?: unknown }).cookies)) {
      return (parsed as { cookies: unknown[] }).cookies;
    }
    throw new AuthError(`cookie file must contain a JSON array or {cookies: []}: ${this.cookiesPath}`, { path: this.cookiesPath });
  }

  private async importCookies(entries: unknown[]): Promise<void> {
    for (let index = 0; index < entries.length; index++) {
      const cookie = this.toJarCookie(entries[index], index);
      if (cookie === null) continue;
      const url = `https://${cookie.domain}${cookie.path ?? "/"}`;
      try {
        const stored = await this.jar.setCookie(cookie, url);
        if (!stored) fail(index, "cookie was rejected by the cookie jar", this.cookiesPath);
      } catch (cause) {
        if (cause instanceof AuthError) throw cause;
        throw new AuthError(`invalid cookie at index ${index} (${this.cookiesPath})`, { path: this.cookiesPath });
      }
    }
  }

  private toJarCookie(entry: unknown, index: number): JarCookie | null {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return fail(index, "entry must be an object", this.cookiesPath);
    }
    const raw = entry as Record<string, unknown>;
    const name = hasOwn(raw, "name") ? raw.name : raw.key;
    if (typeof name !== "string" || name.length === 0 || !COOKIE_NAME.test(name)) {
      return fail(index, "name is invalid", this.cookiesPath);
    }
    if (typeof raw.value !== "string" || !COOKIE_VALUE.test(raw.value)) return fail(index, "value contains invalid cookie characters", this.cookiesPath);

    for (const key of ["secure", "httpOnly", "hostOnly", "session"]) {
      if (hasOwn(raw, key) && typeof raw[key] !== "boolean") return fail(index, `${key} must be boolean`, this.cookiesPath);
    }
    if (hasOwn(raw, "name") && hasOwn(raw, "key") && raw.key !== undefined && raw.key !== name) {
      return fail(index, "name and key disagree", this.cookiesPath);
    }

    const hasDomain = hasOwn(raw, "domain");
    if (hasDomain && typeof raw.domain !== "string") return fail(index, "domain must be a string", this.cookiesPath);
    const rawDomain = hasDomain ? (raw.domain as string).trim().toLowerCase() : undefined;
    if (hasDomain && rawDomain === "") return fail(index, "domain must not be empty", this.cookiesPath);
    let domain: string;
    try {
      domain = normalizeDomain(rawDomain ?? this.defaultDomain, "cookie domain");
    } catch {
      return fail(index, "domain is invalid", this.cookiesPath);
    }
    if (rawDomain !== undefined && (rawDomain.startsWith("..") || rawDomain.includes("/"))) {
      return fail(index, "domain is invalid", this.cookiesPath);
    }

    // A domain-less browser export has no safe URL context. Bind it to the
    // explicit default host and force host-only semantics.
    const hostOnly = hasDomain ? (raw.hostOnly === undefined ? !rawDomain!.startsWith(".") : raw.hostOnly as boolean) : true;
    if (!hasDomain && raw.hostOnly === false) return fail(index, "domain-less cookies must be host-only", this.cookiesPath);

    if (hasOwn(raw, "path") && typeof raw.path !== "string") return fail(index, "path must be a string", this.cookiesPath);
    const cookiePath = raw.path === undefined || raw.path === "" ? "/" : raw.path as string;
    if (!cookiePath.startsWith("/") || INVALID_PATH_CHARS.test(cookiePath)) return fail(index, "path is invalid", this.cookiesPath);

    if (hasOwn(raw, "sameSite")) sameSiteOf(raw.sameSite, index, this.cookiesPath);
    for (const key of ["expirationDate", "expires"]) {
      if (hasOwn(raw, key) && raw[key] !== undefined && typeof raw[key] !== "number" && typeof raw[key] !== "string") {
        return fail(index, `${key} must be a number or date string`, this.cookiesPath);
      }
    }

    let expires: Date | "Infinity" | undefined;
    const expiryValue = hasOwn(raw, "expirationDate") ? raw.expirationDate : raw.expires;
    if (expiryValue !== undefined) {
      const parsedExpiry = expiryDate(expiryValue, index, this.cookiesPath);
      if (raw.session === true) return this.toJarCookie({ ...raw, expirationDate: undefined, expires: undefined }, index);
      if (parsedExpiry === null) return null;
      if (parsedExpiry !== "Infinity" && parsedExpiry.getTime() <= Date.now()) return null;
      expires = parsedExpiry;
    }

    const sameSite = sameSiteOf(raw.sameSite, index, this.cookiesPath);
    try {
      return new JarCookie({
        key: name,
        value: raw.value,
        domain,
        hostOnly,
        path: cookiePath,
        secure: raw.secure === true,
        httpOnly: raw.httpOnly === true,
        ...(expires !== undefined ? { expires } : {}),
        ...(sameSite !== undefined ? { sameSite } : {}),
      });
    } catch {
      return fail(index, "cookie attributes are invalid", this.cookiesPath);
    }
  }

  async get(url: string, options: RequestOptions = {}): Promise<Response> {
    return request(url, { ...options, method: "GET" }, this);
  }

  async post(url: string, options: RequestOptions = {}): Promise<Response> {
    return request(url, { ...options, method: "POST" }, this);
  }
}
