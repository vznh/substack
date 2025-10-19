// examples/self
import { substack } from "../src";
import { Logger } from "@origranot/ts-logger";

const logger = new Logger();

async function fetch_self() {
  const user = substack.user("venh");
  const profile = await user.get_name();
  const subscriptions = await user.get_subscriptions();

  // grabbing user information
  logger.debug("All user information is described below.");
  logger.info(`User: ${profile}`);
  logger.info(`Subscribed to ${subscriptions.length} newsletters`);

  const newsletter = substack.newsletter("https://venh.substack.com");
  const posts = await newsletter.get_posts("new", 6);

  logger.info("Posts from venh.substack.com:");

  logger.debug("All requested posts from user is described below.");
  for (const p of posts) {
    const minimal_post_data: {
      title?: string;
      subtitle?: string | null;
      posted?: string | null | undefined;
      paywalled?: boolean;
    } = {};
    minimal_post_data.title = await p.get_title();
    minimal_post_data.subtitle = await p.get_subtitle();
    minimal_post_data.posted = await p.get_post_date();
    minimal_post_data.paywalled = await p.paywalled();

    logger.info(minimal_post_data);
  }

  logger.debug("All categorical information is described below.");

  const categories = await substack.list_all_categories();
  logger.info(`Found ${categories.length} categories.`);

  categories.slice(0, 20)
    .forEach((category) => {
    logger.info(`- ${category.name} (ID: ${category.id})`);
  });
}

fetch_self().catch((e) => {
  logger.error(e);
});
