/** Errors raised by the SDK transport and cookie authentication. */

/** Raised by the shared transport when a response has an HTTP error status. */
export class HttpError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;
  /** Final URL of the failed response (after any redirects). */
  readonly url: string;
  /** HTTP status text, when the runtime supplies one. */
  readonly statusText: string;

  constructor(status: number, url: string, statusText = "", message?: string) {
    super(message ?? `HTTP ${status}${statusText ? ` ${statusText}` : ""} for ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.statusText = statusText;
  }
}

/** Raised when cookie credentials are missing, unreadable or malformed. */
export class AuthError extends Error {
  /** File path the cookies were loaded from, when applicable. */
  readonly path?: string;

  constructor(message: string, options?: { path?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AuthError";
    if (options?.path !== undefined) this.path = options.path;
  }
}
