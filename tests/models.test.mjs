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

