import type { Auth } from "./auth.js";
import { HttpError } from "./errors.js";

export { HttpError };

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface RequestOptions extends RequestInit {
  /** Per-attempt deadline. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Opt-in retry count for GET/HEAD responses with 429 or 5xx statuses. */
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Safari/537.36",
  accept: "application/json",
  "content-type": "application/json",
};

let baseFetch: FetchLike = dynamicGlobalFetch;

function dynamicGlobalFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init);
}

/** Replace the anonymous transport fetch; intended for deterministic tests. */
export function setFetch(impl?: FetchLike): void {
  baseFetch = impl ?? dynamicGlobalFetch;
}

function buildHeaders(extra?: RequestInit["headers"]): Headers {
  const headers = new Headers(extra);
  for (const [name, value] of Object.entries(DEFAULT_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return headers;
}

function validateOptions(
  options: RequestOptions,
): { timeoutMs: number; retries: number } {
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  ) {
    throw new RangeError("timeoutMs must be a positive integer no greater than 2147483647");
  }
  const retries = options.retries === undefined ? 0 : options.retries;
  if (
    typeof retries !== "number" ||
    !Number.isSafeInteger(retries) ||
    retries < 0 ||
    retries > MAX_RETRIES
  ) {
    throw new RangeError(`retries must be an integer from 0 to ${MAX_RETRIES}`);
  }
  return { timeoutMs, retries };
}

function abortReason(signal?: AbortSignal | null): unknown {
  return signal?.reason ?? new Error("The operation was aborted");
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw abortReason(signal);
}

function combinedSignal(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  throwIfAborted(signal);
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter.trim());
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  return 250 * 2 ** attempt;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      // Abort may race with listener registration.
      if (signal.aborted) onAbort();
    }
  });
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already being discarded. Preserve the original HTTP
    // result rather than replacing it with a stream cancellation failure.
  }
}

/**
 * Request an absolute URL. Auth readiness is awaited and HTTP errors retain
 * status plus the final response URL. Retries are deliberately opt-in.
 */
export async function request(
  url: string,
  options: RequestOptions = {},
  auth?: Auth,
): Promise<Response> {
  throwIfAborted(options.signal);
  if (auth) await auth.ready();
  throwIfAborted(options.signal);

  const { timeoutMs, retries } = validateOptions(options);
  const method = (options.method ?? "GET").toUpperCase();
  const retriable = method === "GET" || method === "HEAD";
  const { timeoutMs: _timeoutMs, retries: _retries, ...requestInit } = options;
  const initialHeaders = buildHeaders(options.headers);

  const fetchFn = auth ? auth.cookieFetch : baseFetch;
  let attempt = 0;
  let response: Response;
  for (;;) {
    throwIfAborted(options.signal);
    response = await fetchFn(url, {
      ...requestInit,
      method,
      // fetch-cookie mutates Headers while adding/removing cookies during a
      // redirect. Give each attempt a fresh copy to prevent cookie buildup.
      headers: new Headers(initialHeaders),
      signal: combinedSignal(options.signal, timeoutMs),
    });

    if (retriable && attempt < retries && RETRYABLE_STATUS.has(response.status)) {
      const delay = retryDelayMs(response, attempt);
      // Retry-After is authoritative. If it cannot fit one configured
      // attempt's deadline, return the HTTP error instead of retrying early.
      if (delay <= timeoutMs) {
        await cancelBody(response);
        await sleep(delay, options.signal);
        attempt++;
        continue;
      }
    }
    break;
  }

  if (response.status >= 400) {
    await cancelBody(response);
    throw new HttpError(response.status, response.url || url, response.statusText);
  }
  return response;
}
