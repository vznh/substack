import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { Auth, HttpError, request, setFetch } from "../dist/index.js";

const roots = [];

afterEach(async () => {
  setFetch();
  while (roots.length) await rm(roots.pop(), { recursive: true, force: true });
});

function response(body = "{}", init = {}, url = "") {
  const result = new Response(body, init);
  Object.defineProperty(result, "url", { value: url });
  return result;
}

async function authFile(cookies = []) {
  const root = await mkdtemp(join(tmpdir(), "substack-http-test-"));
  roots.push(root);
  const path = join(root, "cookies.json");
  await writeFile(path, JSON.stringify(cookies), "utf8");
  return path;
}

describe("shared request transport", () => {
  test("preserves Headers and tuple headers while adding defaults", async () => {
    const calls = [];
    setFetch(async (url, init) => {
      calls.push({ url: String(url), init, headers: new Headers(init.headers) });
      return response("{}", {}, String(url));
    });
    await request("https://substack.com/test", { headers: new Headers({ "x-headers": "yes" }) });
    await request("https://substack.com/test", { headers: [["x-tuples", "yes"]] });
    assert.equal(calls[0].headers.get("x-headers"), "yes");
    assert.equal(calls[1].headers.get("x-tuples"), "yes");
    assert.equal(calls[0].headers.get("accept"), "application/json");
    assert.equal(calls[0].headers.get("user-agent") !== null, true);
  });

  test("awaits Auth readiness before the first request", async () => {
    const path = await authFile([{ name: "session", value: "FAKE", domain: "substack.com", secure: true }]);
    const calls = [];
    const auth = new Auth(path, {
      fetch: async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init.headers) });
        return response("{}", {}, String(url));
      },
    });
    await request("https://substack.com/test", {}, auth);
    assert.equal(auth.authenticated, true);
    assert.equal(calls[0].headers.get("cookie"), "session=FAKE");
  });

  test("throws HttpError with status and final URL", async () => {
    setFetch(async (url) => response("secret response body", { status: 429, statusText: "Too Many Requests" }, "https://final.invalid/limit"));
    await assert.rejects(request("https://initial.invalid/limit"), (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 429);
      assert.equal(error.url, "https://final.invalid/limit");
      assert.match(error.message, /429/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  });

  test("retries only opted-in GET/HEAD requests and cancels discarded bodies", async () => {
    let calls = 0;
    let canceled = false;
    setFetch(async (url) => {
      calls++;
      if (calls === 1) {
        const body = new ReadableStream({
          pull(controller) { controller.enqueue(new TextEncoder().encode("retry")); },
          cancel() { canceled = true; },
        });
        return response(body, { status: 503, headers: { "retry-after": "0" } }, String(url));
      }
      return response("{}", {}, String(url));
    });
    await request("https://substack.com/retry", { retries: 1 });
    assert.equal(calls, 2);
    assert.equal(canceled, true);

    calls = 0;
    await assert.rejects(request("https://substack.com/retry", { method: "POST", retries: 1 }), HttpError);
    assert.equal(calls, 1);
  });

  test("does not retry early when Retry-After exceeds the configured budget", async () => {
    let calls = 0;
    setFetch(async (url) => {
      calls++;
      return response("", { status: 429, headers: { "retry-after": "60" } }, String(url));
    });
    await assert.rejects(request("https://substack.com/slow", { retries: 1, timeoutMs: 10 }), HttpError);
    assert.equal(calls, 1);
  });

  test("cleans up retry sleep on caller abort and rejects pre-aborted signals", async () => {
    const controller = new AbortController();
    let calls = 0;
    setFetch(async (url) => {
      calls++;
      return response("", { status: 503, headers: { "retry-after": "1" } }, String(url));
    });
    const pending = request("https://substack.com/abort", { retries: 1, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("caller cancelled")), 10);
    await assert.rejects(pending, /caller cancelled/);
    assert.equal(calls, 1);

    const preAborted = new AbortController();
    preAborted.abort(new Error("already cancelled"));
    await assert.rejects(request("https://substack.com/pre", { signal: preAborted.signal }), /already cancelled/);
  });

  test("validates timeout and retry options", async () => {
    setFetch(async (url) => response("{}", {}, String(url)));
    await assert.rejects(request("https://substack.com/test", { timeoutMs: 0 }), RangeError);
    await assert.rejects(request("https://substack.com/test", { timeoutMs: 1.5 }), RangeError);
    await assert.rejects(request("https://substack.com/test", { retries: -1 }), RangeError);
    await assert.rejects(request("https://substack.com/test", { retries: 4 }), RangeError);
  });
});
