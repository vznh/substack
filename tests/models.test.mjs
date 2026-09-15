import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  Category,
  Newsletter,
  Post,
  User,
} from "../dist/index.js";

const originalFetch = globalThis.fetch;

const detail = {
  id: 101,
  slug: "hello-world",
  title: "Hello world",
  canonical_url: "https://example.substack.com/p/hello-world",
  publication_id: 7,
  subtitle: null,
  body_html: "<p>Hello</p>",
  audience: "everyone",
  post_date: "2026-01-01T00:00:00.000Z",
  type: "newsletter",
  extra_wire_field: { retained: true },
};

const summary = {
  id: detail.id,
  slug: detail.slug,
  title: null,
  canonical_url: detail.canonical_url,
  publication_id: detail.publication_id,
  body_html: null,
  type: "newsletter",
};

function json(value, status = 200) {
  return Response.json(value, { status });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Post parses direct detail, preserves unknown fields, and caches", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return json(detail);
  };

  const post = new Post(detail.canonical_url);
  assert.deepEqual(await post.get_metadata(), detail);
  assert.equal(await post.get_content(), detail.body_html);
  assert.equal(await post.get_title(), detail.title);
  assert.equal(await post.is_paywalled(), false);
  assert.equal(calls, 1);
});

test("archive summaries hydrate before metadata/content and keep nullable titles", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).includes("/archive?") ? json([summary]) : json(detail);
  };

  const [post] = await new Newsletter("https://example.substack.com/archive").get_posts("new", 1);
  assert.equal(await post.get_id(), detail.id);
  assert.equal(await post.get_content(), detail.body_html);
  assert.equal((await post.get_metadata()).extra_wire_field.retained, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/api\/v1\/posts\/hello-world$/);
});

test("archive summary titles are returned without detail hydration", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return json([{ ...summary, title: "Cached archive title" }]);
  };
  const [post] = await new Newsletter("https://example.substack.com").get_posts("new", 1);
  assert.equal(await post.get_title(), "Cached archive title");
  assert.equal(calls, 1);
});

test("concurrent post failures share one rejection and one request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return json({ error: "unavailable" }, 503);
  };
  const post = new Post(detail.canonical_url);
  const results = await Promise.allSettled([
    post.get_metadata(),
    post.get_metadata(),
  ]);
  assert.equal(calls, 1);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[0].reason.status, 503);
});

test("concurrent force refreshes coalesce", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return json({ ...detail, title: `version-${calls}` });
  };
  const post = new Post(detail.canonical_url);
  await post.get_metadata();
  const [first, second] = await Promise.all([
    post.get_metadata(true),
    post.get_metadata(true),
  ]);
  assert.equal(calls, 2);
  assert.equal(first.title, second.title);
});

test("archive EOF returns available results after a short page", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).includes("offset=0") ? json([summary]) : json([]);
  };
  const posts = await new Newsletter("example.substack.com").get_posts("new", 5);
  assert.equal(posts.length, 1);
  assert.equal(calls.length, 2);
});

test("zero and negative limits have explicit behavior", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return json([summary]);
  };
  const newsletter = new Newsletter("https://example.substack.com");
  assert.deepEqual(await newsletter.get_posts("new", 0), []);
  await assert.rejects(() => newsletter.get_posts("new", -1), RangeError);
  assert.equal(calls, 0);
});

test("podcasts filter actual media metadata and accept UUID upload IDs", async () => {
  const podcast = {
    ...summary,
    id: 102,
    slug: "episode",
    canonical_url: "https://example.substack.com/p/episode",
    podcast_upload_id: "b2b17a28-dff2-4575-857c-276c937feaa6",
  };
  let requested;
  globalThis.fetch = async (url) => {
    requested = String(url);
    return json([summary, podcast]);
  };
  const posts = await new Newsletter("https://example.substack.com").get_podcasts(1);
  assert.equal(posts.length, 1);
  assert.equal(await posts[0].get_id(), podcast.id);
  assert.equal(new URL(requested).searchParams.has("type"), false);
});

test("User handles are encoded, optional profile fields do not block identity", async () => {
  let requested;
  globalThis.fetch = async (url) => {
    requested = String(url);
    return json({ id: 9, name: "A Name", extra: "raw" });
  };
  const user = new User("@name with spaces");
  assert.equal(await user.get_name(), "A Name");
  assert.deepEqual(await user.get_subscriptions(), []);
  assert.equal((await user.get_raw_data()).extra, "raw");
  assert.match(requested, /name%20with%20spaces\/public_profile$/);
});

test("concurrent User failures preserve one rejection and one request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return json({ error: "limited" }, 429);
  };
  const user = new User("rate-limited");
  const results = await Promise.allSettled([user.get_name(), user.get_id()]);
  assert.equal(calls, 1);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].reason.status, 429);
});

test("renamed users follow only a safe Substack profile redirect", async () => {
  const requested = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    requested.push(value);
    if (value.includes("/api/v1/user/old%20name/public_profile")) {
      return json({ error: "missing" }, 404);
    }
    if (value === "https://substack.com/@old%20name") {
      const response = json(null);
      Object.defineProperty(response, "url", { value: "https://substack.com/@new-name" });
      return response;
    }
    return json({ id: 10, name: "Renamed" });
  };
  const user = new User("old name");
  assert.equal(await user.get_name(), "Renamed");
  assert.equal(user.get_username(), "new-name");
  assert.equal(user.was_redirected(), true);
  assert.deepEqual(requested, [
    "https://substack.com/api/v1/user/old%20name/public_profile",
    "https://substack.com/@old%20name",
    "https://substack.com/api/v1/user/new-name/public_profile",
  ]);
});

test("Category resolves numeric IDs and preserves publication metadata", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/categories")) {
      return json([{ name: "Technology", id: 4 }, { name: "podcast", id: "podcast" }]);
    }
    return json({
      publications: [{
        id: 123,
        name: "Example",
        base_url: "https://example.substack.com",
        subdomain: "example",
        custom_domain: null,
        private_wire_field: "kept",
      }],
      more: false,
    });
  };
  const category = new Category("Technology");
  assert.equal(category.get_id(), undefined);
  const [publication] = await category.get_newsletter_metadata();
  assert.equal(category.get_id(), 4);
  assert.equal(publication.private_wire_field, "kept");
  assert.match(calls[1], /\/public\/4\/all\?page=0$/);
});

test("Category refresh joins an active load instead of racing its cache", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return json({
      publications: [{
        id: 123,
        name: "Example",
        base_url: "https://example.substack.com",
        subdomain: "example",
        custom_domain: null,
      }],
      more: false,
    });
  };
  const category = new Category("Technology", 4);
  await Promise.all([category.get_newsletter_metadata(), category.refresh_data()]);
  assert.equal(calls, 1);
});

test("URLs reject unsupported schemes and preserve explicit ports", async () => {
  assert.throws(() => new Newsletter("ftp://example.com"), /http or https/);
  assert.throws(() => new Post("mailto:test@example.com"), /http or https/);
  let requested;
  globalThis.fetch = async (url) => {
    requested = String(url);
    return json(detail);
  };
  await new Post("http://localhost:43210/p/hello-world/").get_metadata();
  assert.equal(new URL(requested).port, "43210");
});
