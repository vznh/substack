// Run with Bun from the repository root: `bun run examples/self.ts`.
import { substack } from "../src/index.js";

async function main(): Promise<void> {
  const newsletter = substack.newsletter("https://venh.substack.com");
  const posts = await newsletter.get_posts("new", 5);

  console.log(`Fetched ${posts.length} posts from ${newsletter.get_base_url()}`);
  for (const post of posts) {
    console.log({
      title: await post.get_title(),
      date: await post.get_post_date(),
      paywalled: await post.paywalled(),
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
