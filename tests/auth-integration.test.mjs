import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { Auth, HttpError, Newsletter, Post } from "../dist/index.js";

const tempRoots = [];
const requests = [];
let primary;
let secondary;
let primaryOrigin;
let secondaryOrigin;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function archiveItem() {
  return {
    id: 101,
    slug: "paid-post",
    canonical_url: `${primaryOrigin}/p/paid-post`,
    publication_id: 7,
    title: null,
    body_html: null,
    audience: "only_paid",
  };
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

before(async () => {
  secondary = await listen((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({ host: req.headers.host, path: url.pathname, cookie: req.headers.cookie ?? null });
    sendJson(res, 200, { redirected: true });
  });
  // Use different loopback hostnames so the redirect exercises cookie host
  // scoping while both servers remain local and deterministic.
  secondaryOrigin = secondary.origin;

  primary = await listen((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cookie = req.headers.cookie ?? "";
    requests.push({ host: req.headers.host, path: url.pathname, cookie });

    if (url.pathname === "/api/v1/archive") {
      sendJson(res, 200, [archiveItem()]);
      return;
    }
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: `${secondaryOrigin}/target` });
      res.end();
      return;
    }
    const postMatch = url.pathname.match(/^\/api\/v1\/posts\/(.+)$/);
    if (postMatch) {
      const slug = decodeURIComponent(postMatch[1]);
      if (slug === "unauthorized") {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      if (slug === "forbidden") {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      const entitled = /(?:^|;\s*)entitlement=full(?:;|$)/.test(cookie);
      sendJson(res, 200, {
        ...archiveItem(),
        slug,
        canonical_url: `${primaryOrigin}/p/${slug}`,
        title: "Synthetic paid post",
        body_html: entitled ? "<p>FULL BODY</p>" : slug === "preview-post" ? "<p>PREVIEW BODY</p>" : null,
        audience: "only_paid",
      });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
  primaryOrigin = primary.origin.replace("127.0.0.1", "localhost");
});

after(async () => {
  for (const item of [primary, secondary]) {
    if (!item) continue;
    item.server.closeAllConnections?.();
    await new Promise((resolve) => item.server.close(resolve));
  }
  while (tempRoots.length) await rm(tempRoots.pop(), { recursive: true, force: true });
});

async function cookieFile(cookies) {
  const root = await mkdtemp(join(tmpdir(), "substack-auth-integration-"));
  tempRoots.push(root);
  const path = join(root, "cookies.json");
  await writeFile(path, JSON.stringify(cookies), "utf8");
  return path;
}

describe("native loopback authentication integration", () => {
  test("the first Post request awaits cookie loading and receives synthetic full content", async () => {
    requests.length = 0;
    const path = await cookieFile([{ name: "entitlement", value: "full", domain: "localhost", path: "/" }]);
    const auth = new Auth(path);
    const content = await new Post(`${primaryOrigin}/p/paid-post`, auth).get_content();

    assert.equal(content, "<p>FULL BODY</p>");
    assert.equal(auth.authenticated, true);
    assert.match(requests.at(-1).cookie, /entitlement=full/);
  });

  test("absent and expired entitlement cookies only receive the preview/null result", async () => {
    const absentPath = await cookieFile([]);
    const absentAuth = new Auth(absentPath);
    assert.equal(await new Post(`${primaryOrigin}/p/paid-post`, absentAuth).get_content(), null);
    assert.equal(absentAuth.authenticated, true);

    const expiredPath = await cookieFile([{ name: "entitlement", value: "full", domain: "localhost", expirationDate: 0 }]);
    const expiredAuth = new Auth(expiredPath);
    assert.equal(await new Post(`${primaryOrigin}/p/paid-post`, expiredAuth).get_content(), null);
    // Local loading succeeded; this is deliberately not treated as proof of entitlement.
    assert.equal(expiredAuth.authenticated, true);
  });

  test("a nonempty preview body and authenticated flag do not establish paid access", async () => {
    const path = await cookieFile([]);
    const auth = new Auth(path);
    const content = await new Post(`${primaryOrigin}/p/preview-post`, auth).get_content();

    assert.equal(content, "<p>PREVIEW BODY</p>");
    assert.equal(auth.authenticated, true);
    assert.notEqual(content, "<p>FULL BODY</p>");
  });

  test("Newsletter archive-created Posts retain Auth and hydrate full detail", async () => {
    requests.length = 0;
    const path = await cookieFile([{ name: "entitlement", value: "full", domain: "localhost", path: "/" }]);
    const auth = new Auth(path);
    const [post] = await new Newsletter(primaryOrigin, auth).get_posts("new", 1);

    assert.equal(await post.get_content(), "<p>FULL BODY</p>");
    assert.ok(requests.some((entry) => entry.path === "/api/v1/archive" && entry.cookie.includes("entitlement=full")));
    assert.ok(requests.some((entry) => entry.path === "/api/v1/posts/paid-post" && entry.cookie.includes("entitlement=full")));
  });

  test("401 and 403 detail responses preserve HttpError status and URL", async () => {
    const unauthorized = new Post(`${primaryOrigin}/p/unauthorized`);
    await assert.rejects(unauthorized.get_content(), (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 401);
      assert.equal(error.url, `${primaryOrigin}/api/v1/posts/unauthorized`);
      return true;
    });

    const forbidden = new Post(`${primaryOrigin}/p/forbidden`);
    await assert.rejects(forbidden.get_content(), (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.equal(error.url, `${primaryOrigin}/api/v1/posts/forbidden`);
      return true;
    });
  });

  test("host-only cookies are not forwarded by a native cross-host redirect", async () => {
    requests.length = 0;
    const path = await cookieFile([{ name: "session", value: "local-only" }]);
    const auth = new Auth(path, { defaultDomain: "localhost" });
    await auth.get(`${primaryOrigin}/redirect`);

    const redirected = requests.find((entry) => entry.host?.startsWith("127.0.0.1:") && entry.path === "/target");
    assert.ok(redirected, "redirect target should be reached");
    assert.equal(redirected.cookie, null);
  });
});
