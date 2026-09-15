import { Auth } from "./auth.js";
import { Category, fetch_all_categories } from "./category.js";
import { Newsletter } from "./newsletter.js";
import { User } from "./user.js";
import { Post } from "./post.js";

class Substack {
  static Auth = Auth;
  static Category = Category;
  static Newsletter = Newsletter;
  static User = User;
  static Post = Post;

  static list_all_categories = fetch_all_categories;

  static user(
    username: string,
    follow_redirects_or_auth: boolean | Auth = true,
    auth?: Auth,
  ) {
    return new User(username, follow_redirects_or_auth, auth);
  }

  static newsletter(
    url: string,
    auth?: Auth
  ) {
    return new Newsletter(url, auth);
  }

  static post(
    url: string,
    auth?: Auth
  ) {
    return new Post(url, auth);
  }

  static category(
    name?: string,
    id?: number | string,
    auth?: Auth,
  ) {
    return new Category(name, id, auth);
  }
}

export { Substack };
