import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterEach } from "node:test";

const { Category, Newsletter, Post, User, fetch_all_categories } = await import("../dist/index.js");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = async (name) => JSON.parse(await readFile(join(fixtureRoot, `${name}.json`), "utf8"));
const [detail, archive, user, categories, category] = await Promise.all(
  ["post", "archive", "user", "categories", "category"].map(fixture),
);

const originalFetch = globalThis.fetch;
const publication = "https://example.substack.com";
const response = (body, init) => Response.json(body, init);
const post = () => new Post(detail.canonical_url);

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
}

test("direct post metadata consumes JSON and preserves raw fields", async () => {
  mockFetch(() => response(detail));
  const metadata = await post().get_metadata();
  assert.equal(metadata.id, detail.id);
  assert.deepEqual(Object.keys(metadata).sort(), Object.keys(detail).sort());
});

test("content uses body_html from the post detail endpoint", async () => {
  const calls = mockFetch(() => response(detail));
  assert.equal(await post().get_content(), detail.body_html);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/posts\/hello-world$/);
  assert.doesNotMatch(calls[0].url, /\/html\//);
});

test("archive summaries hydrate before full metadata and content", async () => {
  const calls = mockFetch((url) => url.includes("/archive?") ? response(archive) : response(detail));
  const [summary] = await new Newsletter(publication).get_posts("new", 1);
  assert.equal(await summary.get_content(), detail.body_html);
  assert.equal((await summary.get_metadata()).extra_wire_field, detail.extra_wire_field);
  assert.equal(calls.filter((call) => call.url.includes("/api/v1/posts/")).length, 1);
});

test("detail cache avoids duplicate requests and refresh replaces data", async () => {
  let version = 0;
  const calls = mockFetch(() => response({ ...detail, title: `v${++version}` }));
  const instance = post();
  assert.equal(await instance.get_title(), "v1");
  assert.equal(await instance.get_title(), "v1");
  assert.equal(await instance.get_metadata(true).then((data) => data.title), "v2");
  assert.equal(calls.length, 2);
});

test("numeric user subscription IDs and empty subscriptions are supported", async () => {
  mockFetch(() => response(user));
  const instance = new User("@fixture");
  assert.equal(await instance.get_name(), user.name);
  assert.equal((await instance.get_subscriptions())[0].publication_id, 42);

  mockFetch(() => response({ id: 8, name: "No subscriptions" }));
  assert.deepEqual(await new User("empty").get_subscriptions(), []);
});

test("category lookup completes before the category request", async () => {
  const calls = mockFetch(async (url) => {
    if (url.endsWith("/api/v1/categories")) return response(categories);
    assert.match(url, /\/api\/v1\/category\/public\/4\/all\?page=0$/);
    return response(category);
  });
  const instance = new Category("Technology");
  const metadata = await instance.get_newsletter_metadata();
  assert.equal(instance.get_id(), 4);
  assert.equal(metadata[0].id, category.publications[0].id);
  assert.equal(metadata[0].raw_publication_field, "keep");
  assert.ok(calls[0].url.endsWith("/api/v1/categories"));
});

test("category list accepts numeric IDs", async () => {
  mockFetch(() => response(categories));
  assert.equal((await fetch_all_categories())[0].id, 4);
});

test("recommendations normalize custom domains and only fetch one archive item", async () => {
  const calls = mockFetch((url) => {
    if (url.includes("/recommendations/")) {
      return response([{ recommendedPublication: { custom_domain: "blog.example.org", subdomain: "blog" } }]);
    }
    return response(archive);
  });
  const [recommendation] = await new Newsletter(publication).get_recommendations();
  assert.equal(recommendation.get_base_url(), "https://blog.example.org");
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "1");
});

test("zero and negative limits are handled before network access", async () => {
  const calls = mockFetch(() => response(archive));
  assert.deepEqual(await new Newsletter(publication).get_posts("new", 0), []);
  await assert.rejects(() => new Newsletter(publication).get_posts("new", -1), RangeError);
  assert.equal(calls.length, 0);
});

test("archive URL paths normalize to the origin and search escapes reserved characters", async () => {
  const calls = mockFetch(() => response(archive));
  await new Newsletter(`${publication}/archive?sort=old`).search_posts("AI & ML?+日本語", 1);
  const parsed = new URL(calls[0].url);
  assert.equal(parsed.pathname, "/api/v1/archive");
  assert.equal(parsed.searchParams.get("search"), "AI & ML?+日本語");
});

test("explicit ports are preserved for post detail requests", async () => {
  const calls = mockFetch(() => response(detail));
  await new Post("http://localhost:43210/p/hello-world/").get_metadata();
  assert.equal(new URL(calls[0].url).port, "43210");
});

test("HTTP errors expose status and URL", async () => {
  const calls = mockFetch(() => response({ error: "rate limit" }, { status: 429 }));
  await assert.rejects(
    () => new Newsletter(publication).get_posts("new", 1),
    (error) => error?.status === 429 && error?.url === calls[0].url && /429/.test(error.message),
  );
});

test("short pages are not treated as EOF, while an empty page is true EOF", async () => {
  const first = { ...archive[0], id: 201, slug: "first", canonical_url: `${publication}/p/first` };
  const second = { ...archive[0], id: 202, slug: "second", canonical_url: `${publication}/p/second` };
  const third = { ...archive[0], id: 203, slug: "third", canonical_url: `${publication}/p/third` };
  let calls = mockFetch((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    if (offset === 0) return response([first]);
    if (offset === 3) return response([second, third]);
    return response([]);
  });
  assert.equal((await new Newsletter(publication).get_posts("new", 3)).length, 3);
  assert.equal(calls.length, 2);

  calls = mockFetch((url) => Number(new URL(url).searchParams.get("offset")) === 0 ? response([first]) : response([]));
  const eofResults = await new Newsletter(publication).get_posts("new", 5);
  assert.equal(eofResults.length, 1);
  assert.equal(calls.length, 2);
});
