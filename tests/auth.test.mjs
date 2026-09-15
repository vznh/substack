import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { Auth, AuthError } from "../dist/index.js";

const roots = [];

afterEach(async () => {
  while (roots.length) await rm(roots.pop(), { recursive: true, force: true });
});

async function cookieFile(cookies) {
  const root = await mkdtemp(join(tmpdir(), "substack-auth-test-"));
  roots.push(root);
  const path = join(root, "cookies.json");
  await writeFile(path, JSON.stringify(cookies), "utf8");
  return path;
}

function response(body = "{}", init = {}, url) {
  const result = new Response(body, init);
  Object.defineProperty(result, "url", { value: url ?? init.url ?? "" });
  return result;
}

function recorder(handler = () => response()) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    calls.push({ url: String(url), init, headers });
    return handler(String(url), init, headers, calls);
  };
  return { fetch, calls };
}

describe("Auth cookie loading and scoping", () => {
  test("awaits the first request, supports browser envelopes, and preserves Headers/POST", async () => {
    const path = await cookieFile({ cookies: [{ name: "session", value: "FAKE", domain: "substack.com", secure: true }] });
    const seen = recorder();
    const auth = new Auth(path, { fetch: seen.fetch });

    assert.equal(auth.authenticated, false);
    const getResponse = await auth.get("https://substack.com/api", {
      headers: new Headers({ "x-audit": "present" }),
    });
    assert.equal(getResponse.status, 200);
    assert.equal(auth.authenticated, true);
    assert.equal(seen.calls[0].headers.get("cookie"), "session=FAKE");
    assert.equal(seen.calls[0].headers.get("x-audit"), "present");

    await auth.post("https://substack.com/api", {
      headers: [["x-tuple", "present"]],
      body: "{}",
    });
    assert.equal(seen.calls[1].init.method, "POST");
    assert.equal(seen.calls[1].headers.get("cookie"), "session=FAKE");
    assert.equal(seen.calls[1].headers.get("x-tuple"), "present");
  });

  test("enforces secure, path, host-only, and domain-cookie rules", async () => {
    const path = await cookieFile([
      { name: "defaultHost", value: "base", secure: false },
      { name: "secure", value: "yes", domain: "substack.com", secure: true },
      { name: "private", value: "yes", domain: "substack.com", hostOnly: true, path: "/private" },
      { name: "exact", value: "yes", domain: "substack.com", hostOnly: true },
      { name: "wide", value: "yes", domain: "substack.com", hostOnly: false },
    ]);
    const seen = recorder();
    const auth = await Auth.create(path, { fetch: seen.fetch });

    await auth.get("https://substack.com/private/document");
    assert.equal(seen.calls.at(-1).headers.get("defaultHost"), null);
    assert.match(seen.calls.at(-1).headers.get("cookie"), /defaultHost=base/);
    assert.match(seen.calls.at(-1).headers.get("cookie"), /secure=yes/);
    assert.match(seen.calls.at(-1).headers.get("cookie"), /private=yes/);

    await auth.get("https://substack.com/public");
    assert.doesNotMatch(seen.calls.at(-1).headers.get("cookie"), /private=yes/);

    await auth.get("http://substack.com/private/document");
    assert.doesNotMatch(seen.calls.at(-1).headers.get("cookie"), /secure=yes/);

    await auth.get("https://child.substack.com/");
    const subdomainCookie = seen.calls.at(-1).headers.get("cookie") ?? "";
    assert.doesNotMatch(subdomainCookie, /defaultHost=base/);
    assert.doesNotMatch(subdomainCookie, /exact=yes/);
    assert.match(subdomainCookie, /wide=yes/);

    await auth.get("https://unrelated.invalid/");
    assert.equal(seen.calls.at(-1).headers.get("cookie"), null);
  });

  test("respects session, expirationDate, expires, and sameSite none", async () => {
    const path = await cookieFile([
      { name: "session", value: "yes", domain: "substack.com", expirationDate: -1, sameSite: "no_restriction" },
      { name: "sessionFlag", value: "yes", domain: "substack.com", session: true, expirationDate: 0 },
      { name: "future", value: "yes", domain: "substack.com", expirationDate: Math.floor(Date.now() / 1000) + 3600 },
      { name: "expiredZero", value: "no", domain: "substack.com", expirationDate: 0 },
      { name: "expiredDate", value: "no", domain: "substack.com", expires: "2000-01-01T00:00:00Z" },
    ]);
    const seen = recorder();
    const auth = await Auth.create(path, { fetch: seen.fetch });
    await auth.get("https://substack.com/");
    const cookie = seen.calls[0].headers.get("cookie") ?? "";
    assert.match(cookie, /session=yes/);
    assert.match(cookie, /sessionFlag=yes/);
    assert.match(cookie, /future=yes/);
    assert.doesNotMatch(cookie, /expiredZero=/);
    assert.doesNotMatch(cookie, /expiredDate=/);
    assert.equal(auth.jar.getCookiesSync("https://substack.com/").find((item) => item.key === "session")?.sameSite, "none");
  });

  test("stores response rotation and does not forward cookies across a host redirect", async () => {
    const path = await cookieFile([{ name: "session", value: "FAKE", domain: "substack.com", secure: true }]);
    const seen = recorder((url) => {
      if (url === "https://substack.com/start") {
        return response("", {
          status: 302,
          headers: {
            location: "https://unrelated.invalid/finish",
            "set-cookie": "rotated=NEW; Domain=substack.com; Path=/; Secure",
          },
        }, url);
      }
      return response("{}", {}, url);
    });
    const auth = await Auth.create(path, { fetch: seen.fetch });
    await auth.get("https://substack.com/start");

    assert.equal(seen.calls.length, 2);
    assert.equal(seen.calls[0].headers.get("cookie"), "session=FAKE");
    assert.equal(seen.calls[1].url, "https://unrelated.invalid/finish");
    assert.equal(seen.calls[1].headers.get("cookie"), null);
    assert.match(auth.jar.getCookieStringSync("https://substack.com/"), /rotated=NEW/);

    await auth.get("https://substack.com/next");
    assert.match(seen.calls.at(-1).headers.get("cookie"), /rotated=NEW/);
  });

  test("uses a safe host-only default for domain-less cookies", async () => {
    const path = await cookieFile([{ name: "session", value: "FAKE", secure: true }]);
    const seen = recorder();
    const auth = await Auth.create(path, { fetch: seen.fetch });
    await auth.get("https://substack.com/");
    assert.match(seen.calls.at(-1).headers.get("cookie"), /session=FAKE/);
    await auth.get("https://child.substack.com/");
    assert.equal(seen.calls.at(-1).headers.get("cookie"), null);
  });
});

describe("Auth validation and readiness errors", () => {
  test("requires a non-empty path and reports missing/malformed files without cookie causes", async () => {
    assert.throws(() => new Auth(""), TypeError);
    const missing = new Auth(join(tmpdir(), "substack-cookie-file-does-not-exist"));
    await assert.rejects(missing.ready(), (error) => error instanceof AuthError && error.cause?.code === "ENOENT");

    const badPath = await mkdtemp(join(tmpdir(), "substack-auth-bad-"));
    roots.push(badPath);
    const malformed = join(badPath, "malformed.json");
    await writeFile(malformed, '{"session":"SECRET",', "utf8");
    await assert.rejects(new Auth(malformed).ready(), (error) => error instanceof AuthError && error.cause === undefined && !error.message.includes("SECRET"));
  });

  test("rejects malformed cookie shapes and unsafe domain/path values", async () => {
    const cases = [
      { value: [{ name: "a", value: "b", secure: "yes" }], label: "secure" },
      { value: [{ name: "a", value: "b", domain: "https://evil.invalid" }], label: "domain" },
      { value: [{ name: "a", value: "b", path: "private" }], label: "path" },
      { value: [{ name: "a", value: "b", sameSite: "mystery" }], label: "sameSite" },
      { value: [{ name: "a", value: "b", expirationDate: Number.POSITIVE_INFINITY }], label: "expiry" },
      { value: [{ name: "a", value: 42 }], label: "value" },
      { value: [{ name: "a", value: "secret; injected=1" }], label: "semicolon value" },
      { value: [{ name: "a", value: "secret\r\ninjected" }], label: "control value" },
    ];
    for (const item of cases) {
      const path = await cookieFile(item.value);
      await assert.rejects(new Auth(path).ready(), (error) => error instanceof AuthError && !error.message.includes("secret") && !error.message.includes("injected"), item.label);
    }
  });
});
