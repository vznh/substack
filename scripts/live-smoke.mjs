const target = process.env.SUBSTACK_LIVE_URL;
if (!target) {
  console.log("live smoke skipped: set SUBSTACK_LIVE_URL to opt in");
  process.exit(0);
}

const { substack } = await import("../dist/index.js");
const newsletter = substack.newsletter(target);
const posts = await newsletter.get_posts("new", 1);
if (posts.length > 0) {
  await posts[0].get_metadata();
}
console.log(`live smoke passed: ${newsletter.get_base_url()} (${posts.length} post)`);
