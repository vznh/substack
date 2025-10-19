// substack
import { Auth } from "./auth";
import { Category, fetch_all_categories } from "./category";
import { Newsletter } from "./newsletter";
import { User } from "./user";
import { Post } from "./post";

class Substack {
  static Auth = Auth;
  static Category = Category;
  static Newsletter = Newsletter;
  static User = User;
  static Post = Post;

  static list_all_categories = fetch_all_categories;

  static user(
    username: string
  ) {
    return new User(username);
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
    id?: number | string
  ) {
    return new Category(name, id);
  }
}

export { Substack };
