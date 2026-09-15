# Substack SDK for TypeScript

An unofficial TypeScript SDK for reading public Substack publication data from Node.js or Bun.

## Installation

```bash
npm install @vznh/substack
```

The package targets Node.js 22 or newer and Bun. It is server-side code: browser builds are not supported because cookie-file authentication and the server transport have different requirements.

## Quickstart

```ts
import { substack } from "@vznh/substack";

const newsletter = substack.newsletter("https://venh.substack.com");
const posts = await newsletter.get_posts("new", 5);

for (const post of posts) {
  console.log(await post.get_title(), await post.get_canonical_url());
}

const metadata = await posts[0]?.get_metadata();
console.log(metadata?.body_html);
```

Methods are asynchronous. The historical snake_case method names and static `substack` facade are retained. Newsletter URLs may be full URLs or bare hostnames; paths and query strings are normalized away.

## Optional cookie authentication

Pass a browser-exported JSON cookie file through the awaited factory:

```ts
import { Auth, substack } from "@vznh/substack";

const auth = await Auth.create("./cookies.json");
const newsletter = substack.newsletter("https://your-publication.substack.com", auth);
const posts = await newsletter.get_posts("new", 5);
```

`new Auth(path)` is also supported for compatibility; the first request awaits `auth.ready()`. `authenticated` means that the local cookie file loaded successfully. It does not verify a server session, subscriber entitlement, or paid-post access. Cookies are scoped by domain, path, secure flag, and expiry through a cookie jar. Never commit cookie exports or include them in bug reports.

Authentication does not bypass Substack access controls. A paid post may still return unavailable or partial content when the supplied account is not entitled to it. No credentials are needed for public reads.

## Returned data and limits

`Post.get_metadata()` returns the post-detail JSON object, including unknown wire fields rather than silently stripping them. `Post.get_content()` returns `body_html` or `null` when the API does not provide article body HTML. Archive summaries are hydrated before metadata or content is returned.

HTTP failures throw an error with `status` and `url`. Invalid limits are rejected before a network request. Pagination stops at an empty page or an explicit safety bound; a short page alone is not treated as end-of-archive.

This SDK uses Substack endpoints that are not a promise of API stability. `get_podcasts(limit)` scans archive pages and filters client-side for actual podcast media metadata (`podcast_url` or `podcast_upload_id`); `limit` is applied after filtering. The scan is bounded at 40 pages (1,000 archive entries) and throws if that bound is reached before enough matching episodes or an empty page is found. Browser support, chat/CLI features, search indexing, durable storage, and entitlement verification are out of scope.

## Development

```bash
npm install
npm test
npm run test:bun
npm run test:consumer
npm run smoke:live                 # skips unless SUBSTACK_LIVE_URL is set
SUBSTACK_LIVE_URL=https://example.substack.com npm run smoke:live
```

`npm test` builds the package, type-checks the example, and runs fixture-backed Node tests. `test:bun` runs the same built tests under Bun. `test:consumer` packs the package, unpacks that tarball into an isolated temporary project with its runtime dependencies, compiles an external TypeScript consumer, and imports the published entry point.

## License and disclaimer

MIT-licensed; see [LICENSE](./LICENSE). This project is independent and is not affiliated with, endorsed by, or connected to Substack. Respect the publication's terms, access controls, and applicable laws when using it.
