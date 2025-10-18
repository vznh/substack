// examples/self
import { Newsletter, Post, User, type PostData } from "../src";
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
  // logger.info(posts);

  for (const p of posts) {
    const minimal_post_data: { title?: string, subtitle?: string | null, posted?: string | null | undefined, paywalled?: boolean } = {};
    minimal_post_data.title = await p.get_title();
    minimal_post_data.subtitle = await p.get_subtitle();
    minimal_post_data.posted = await p.get_post_date();
    minimal_post_data.paywalled = await p.paywalled();

    logger.info(minimal_post_data);
  }
}

fetch_self().catch((e) => {
  logger.error(e);
});
