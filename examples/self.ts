// examples/self
import { Newsletter, Post, User } from "../src";
import { Logger } from "@origranot/ts-logger";

const logger = new Logger();

async function fetch_self() {
  const user = new User("venh");
  const profile = await user.get_name();
  const subscriptions = await user.get_subscriptions();

  logger.info(`User: ${profile}`);
  logger.info(`Subscribed to ${subscriptions.length} newsletters`);

  const newsletter = new Newsletter("https://venh.substack.com");
  const posts = await newsletter.get_posts("new", 6);

  logger.info("Posts from venh.substack.com:");
  for (const post of posts) {
    const title = await post.get_title();
    const paywalled = await post.paywalled();
    console.log(`- ${title} ${paywalled ? "(paywalled)" : ""}`);
  }

  /*
  for (const p of posts) {
    const title = await p.get_title();
    const paywalled = await p.paywalled();
    console.log(`${title} — ${paywalled ? "is paywalled" : "can be viewed"}`)
  }
  */
  // const post = new Post(`https://venh.substack.com/p/post-slug`);
}

fetch_self().catch((e) => {
  logger.error(e);
});
